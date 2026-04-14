import { XMLParser } from 'fast-xml-parser';
import { Env, Source, ArticleInput, ScraperProfileConfig, ListingProfileConfig } from '../types';
import { resolveStaticProfile, SiteProfile } from './site-profiles';
import { generateListingProfile, generateScraperProfile } from '../ai/scraper-profile';

/** Chuẩn hoá mọi định dạng ngày (RFC 2822, ISO 8601…) về ISO 8601 UTC. */
function normalizeDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function nodeText(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const t = nodeText(item);
      if (t) return t;
    }
    return '';
  }
  if (typeof value === 'object') {
    if (typeof value._text === 'string') return value._text.trim();
    if (typeof value['#text'] === 'string') return value['#text'].trim();
  }
  return '';
}

function extractItemLink(item: any): string {
  const link = item?.link;
  if (!link) return '';

  if (typeof link === 'string') return link;
  if (Array.isArray(link)) {
    for (const part of link) {
      if (typeof part === 'string' && part) return part;
      if (part && typeof part === 'object') {
        if (part['@_rel'] === 'alternate' && part['@_href']) return String(part['@_href']);
        if (part['@_href']) return String(part['@_href']);
      }
    }
    return '';
  }
  if (typeof link === 'object' && link['@_href']) return String(link['@_href']);

  return '';
}

function parseRssOrAtom(xml: string): { items: any[]; format: 'rss' | 'atom' } | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    textNodeName: '_text',
  });
  let result: any;
  try {
    result = parser.parse(xml);
  } catch {
    return null;
  }

  if (result?.rss?.channel) {
    const raw = result.rss.channel.item;
    const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return { items, format: 'rss' };
  }

  if (result?.feed) {
    const raw = result.feed.entry;
    const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return { items, format: 'atom' };
  }

  return null;
}

function isLikelyHtml(contentType: string, text: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html')) return true;
  const sample = text.slice(0, 800).toLowerCase();
  return sample.includes('<!doctype html') || sample.includes('<html');
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function slugToTitle(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean).pop() || '';
  const withoutExt = seg.replace(/\.[a-z0-9]+$/i, '');
  const text = withoutExt.replace(/[-_]+/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isLikelyArticlePath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (!p || p === '/' || p === '/blog') return false;
  if (/\.(xml|json|png|jpg|jpeg|webp|svg|gif|ico|pdf|zip)$/i.test(p)) return false;
  if (/\/(tag|tags|category|categories|author|authors|about|careers|privacy|terms|contact|search)\b/.test(p)) return false;
  if (/\/page\/\d+\/?$/.test(p)) return false;
  const segments = p.split('/').filter(Boolean);
  return segments.length >= 1;
}

function isLikelyVercelBlogArticle(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (!p.startsWith('/blog/')) return false;
  if (/^\/blog\/?$/.test(p)) return false;
  if (/^\/blog\/(tag|tags|category|categories|author|authors)\b/.test(p)) return false;
  return p.split('/').filter(Boolean).length >= 2;
}

export async function fetchSource(source: Source, env: Env): Promise<ArticleInput[]> {
  const type = source.type;
  if (type === 'reddit') {
    return fetchReddit(source);
  } else if (type === 'youtube') {
    return fetchYouTube(source, env.YOUTUBE_API_KEY);
  } else if (type === 'rss') {
    return fetchRSS(source);
  } else if (type === 'voz') {
    return fetchVoz(source);
  } else if (type === 'github-trending') {
    return fetchGitHubTrending(source);
  } else {
    // Basic fallback for HTML or unknown
    return fetchUnknown(source, env);
  }
}

async function fetchReddit(source: Source): Promise<ArticleInput[]> {
  const url = source.url.endsWith('/') ? `${source.url}hot.json?limit=15` : `${source.url}/hot.json?limit=15`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'NewsDigest/1.0 (news aggregation bot)' }
  });
  if (!response.ok) throw new Error(`Reddit API failed: ${response.status}`);
  
  const data: any = await response.json();
  const children = data?.data?.children || [];
  
  return children
    .filter((item: any) => !item.data.stickied) // Skip pinned posts
    .filter((item: any) => {
      const d = item.data;
      // Lọc bài ít tương tác: cần ít nhất 50 upvotes HOẶC 15 comments
      return d.score >= 50 || d.num_comments >= 15;
    })
    .map((item: any) => {
      const d = item.data;
      const postedAt = new Date(d.created_utc * 1000).toISOString();
      const meta = `⬆${d.score} 💬${d.num_comments} r/${d.subreddit} 📅${postedAt.slice(0, 10)}`;
      return {
        url: `https://www.reddit.com${d.permalink}`,
        title: d.title,
        description: d.selftext
          ? `${meta}\n${d.selftext.slice(0, 300)}`
          : meta,
        // Dùng thời gian fetch (now) thay vì created_utc
        // → bài hot hôm nay sẽ luôn hiện khi lọc theo "hôm nay"
        published_at: new Date().toISOString(),
        reddit_score: d.score,
        reddit_comments: d.num_comments,
      };
    });
}

async function fetchYouTube(source: Source, apiKey: string): Promise<ArticleInput[]> {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured.");
  
  let playlistId = "";
  let handleMatch = source.url.match(/@([a-zA-Z0-9_\\-]+)/);
  if (handleMatch) {
    const handle = handleMatch[1];
    const channelRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${handle}&key=${apiKey}`);
    const channelData: any = await channelRes.json();
    if (channelData.items && channelData.items.length > 0) {
      playlistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;
    }
  }

  if (!playlistId) {
    throw new Error(`Could not find uploads playlist for YouTube source ${source.url}`);
  }

  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=5&key=${apiKey}`);
  const data: any = await res.json();
  const items = data.items || [];

  // Chỉ lấy video trong 3 ngày gần nhất
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  return items
    .filter((item: any) => {
      const publishedAt = new Date(item.snippet.publishedAt);
      return publishedAt >= threeDaysAgo;
    })
    .slice(0, 2) // Giới hạn tối đa 2 video
    .map((item: any) => {
      const snippet = item.snippet;
      return {
        url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
        title: snippet.title,
        description: snippet.description,
        published_at: normalizeDate(snippet.publishedAt)
      };
    });
}

async function fetchRSS(source: Source): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' }
  });
  if (!response.ok) throw new Error(`RSS feed failed: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  const xml = await response.text();
  if (isLikelyHtml(contentType, xml)) {
    throw new Error(`RSS feed returned HTML for ${source.url}. Please use feed URL (XML).`);
  }

  const parsed = parseRssOrAtom(xml);
  if (!parsed) {
    throw new Error(`Invalid RSS/Atom payload for ${source.url}`);
  }

  const mapped = parsed.items.slice(0, 20).map((item: any) => {
    let link = extractItemLink(item);
    if (link && !/^https?:\/\//i.test(link)) {
      try {
        link = new URL(link, source.url).toString();
      } catch {
        link = '';
      }
    }

    const title = nodeText(item.title);
    const desc = nodeText(item.description) || nodeText(item.content) || nodeText(item.summary);
    const published = item.pubDate || item.published || item.updated || item.dc?.date;

    return {
      url: link,
      title,
      description: desc,
      published_at: normalizeDate(published),
    };
  });

  const valid = mapped.filter(item => item.url && item.title);
  console.log(`[scraper] RSS ${source.url}: parsed ${parsed.items.length} items, valid ${valid.length}`);
  return valid;
}

async function fetchVoz(source: Source): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' }
  });
  if (!response.ok) throw new Error(`VOZ failed: ${response.status}`);

  const results: ArticleInput[] = [];
  let currentTitle = "";
  let currentUrl = "";

  class TitleHandler {
    text(text: Text) {
      if (text.text.trim()) {
         currentTitle += text.text;
      }
    }
  }
  
  class LinkHandler {
    element(element: Element) {
      const href = element.getAttribute("href");
      if (href && href.startsWith('/t/')) {
        currentUrl = `https://voz.vn${href}`;
      }
    }
  }

  class ItemHandler {
    element(element: Element) {
      if (currentTitle && currentUrl) {
        results.push({
          title: currentTitle.trim(),
          url: currentUrl,
          published_at: new Date().toISOString()
        });
      }
      currentTitle = "";
      currentUrl = "";
    }
  }

  const rewriter = new HTMLRewriter()
    .on('.structItem-title a', new LinkHandler())
    .on('.structItem-title a', new TitleHandler())
    .on('.structItem', new ItemHandler());
    
  await rewriter.transform(response).text();

  if (currentTitle && currentUrl && !results.find(r => r.url === currentUrl)) {
    results.push({
      title: currentTitle.trim(),
      url: currentUrl,
      published_at: new Date().toISOString()
    });
  }

  return results.filter(r => r.url && r.title);
}

async function fetchGitHubTrending(source: Source): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub Trending failed: ${response.status}`);

  const results: ArticleInput[] = [];
  let currentRepo = '';
  let currentDesc = '';
  let currentStars = '';
  let currentStarsToday = '';
  let inRepoLink = false;
  let inDesc = false;
  let inStarsToday = false;

  const rewriter = new HTMLRewriter()
    // Mỗi article.Box-row là 1 trending repo row
    .on('article.Box-row', {
      element() {
        // Flush previous repo
        if (currentRepo) {
          const repoUrl = `https://github.com${currentRepo.trim()}`;
          const repoName = currentRepo.trim().replace(/^\//, '');
          const stars = currentStars.trim();
          const todayStars = currentStarsToday.trim();
          const desc = currentDesc.trim();
          const meta = `⭐${stars}${todayStars ? ` 📈${todayStars}` : ''}`;
          results.push({
            url: repoUrl,
            title: repoName,
            description: desc ? `${meta}\n${desc}` : meta,
            published_at: new Date().toISOString(),
          });
        }
        currentRepo = '';
        currentDesc = '';
        currentStars = '';
        currentStarsToday = '';
      }
    })
    // Repo link: h2 > a with href like /owner/repo
    .on('article.Box-row h2 a', {
      element(el: Element) {
        const href = el.getAttribute('href');
        if (href && href.match(/^\/[^/]+\/[^/]+$/)) {
          currentRepo = href;
          inRepoLink = true;
        }
      },
      text(text: Text) {
        if (inRepoLink && text.lastInTextNode) {
          inRepoLink = false;
        }
      }
    })
    // Description paragraph
    .on('article.Box-row p', {
      element() {
        inDesc = true;
        currentDesc = '';
      },
      text(text: Text) {
        if (inDesc) {
          currentDesc += text.text;
        }
        if (text.lastInTextNode) {
          inDesc = false;
        }
      }
    })
    // Total star count (first a with /stargazers href)
    .on('article.Box-row a[href$="/stargazers"]', {
      text(text: Text) {
        currentStars += text.text.trim();
      }
    })
    // Stars today (span.d-inline-block.float-sm-right)
    .on('article.Box-row span.d-inline-block.float-sm-right', {
      element() {
        inStarsToday = true;
        currentStarsToday = '';
      },
      text(text: Text) {
        if (inStarsToday) {
          currentStarsToday += text.text;
        }
        if (text.lastInTextNode) {
          inStarsToday = false;
        }
      }
    });

  await rewriter.transform(response).text();

  // Flush last repo
  if (currentRepo) {
    const repoUrl = `https://github.com${currentRepo.trim()}`;
    const repoName = currentRepo.trim().replace(/^\//, '');
    const stars = currentStars.trim();
    const todayStars = currentStarsToday.trim();
    const desc = currentDesc.trim();
    const meta = `⭐${stars}${todayStars ? ` 📈${todayStars}` : ''}`;
    results.push({
      url: repoUrl,
      title: repoName,
      description: desc ? `${meta}\n${desc}` : meta,
      published_at: new Date().toISOString(),
    });
  }

  console.log(`[scraper] GitHub Trending: found ${results.length} repos`);
  return results.filter(r => r.url && r.title).slice(0, 15);
}

export function normalizeListingProfile(profile: ListingProfileConfig): {
  linkSelectors: string[];
  removeSelectors: string[];
} {
  return {
    linkSelectors: profile.linkSelectors,
    removeSelectors: profile.removeSelectors,
  };
}

function scoreListingHref(href: string, sourceHost: string): number {
  if (sourceHost === 'vercel.com' && href.includes('/blog/')) return 100;
  return href.startsWith('/') ? 60 : 40;
}

export function buildListingArticles(
  candidates: Map<string, { title: string; score: number }>
): ArticleInput[] {
  return [...candidates.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].title.length - a[1].title.length)
    .slice(0, 20)
    .map(([url, value]) => ({
      url,
      title: value.title,
      published_at: new Date().toISOString(),
    }));
}

function isLikelyListingUrl(pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/blog' || path === '/news' || path === '/stories') return true;
    if (/(^|\/)(category|categories|tag|tags|author|authors|topics|topic)(\/|$)/.test(path)) return true;
    if (/\/page\/\d+\/?$/.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

function validateStoredListingProfile(config: any): ListingProfileConfig | null {
  const linkSelectors = Array.isArray(config?.linkSelectors)
    ? config.linkSelectors.filter((v: unknown) => typeof v === 'string' && v.trim()).slice(0, 10)
    : [];
  if (linkSelectors.length === 0) return null;

  const removeSelectors = Array.isArray(config?.removeSelectors)
    ? config.removeSelectors.filter((v: unknown) => typeof v === 'string' && v.trim()).slice(0, 20)
    : [];

  const confidence = Number.isFinite(Number(config?.confidence))
    ? Math.max(0, Math.min(1, Number(config.confidence)))
    : 0.5;
  const sampleUrl = typeof config?.sampleUrl === 'string' ? config.sampleUrl : '';
  const updatedAt = typeof config?.updatedAt === 'string' ? config.updatedAt : new Date().toISOString();

  return {
    linkSelectors,
    removeSelectors,
    confidence,
    source: 'ai',
    sampleUrl,
    updatedAt,
  };
}

async function loadStoredListingProfile(domain: string, env: Env): Promise<ListingProfileConfig | null> {
  const { results } = await env.DB.prepare(
    'SELECT config_json FROM scraper_configs WHERE domain = ? AND mode = ? LIMIT 1'
  ).bind(domain, 'listing').all<{ config_json: string }>();

  if (!results || results.length === 0) return null;
  const row = results[0];
  if (!row?.config_json) return null;

  try {
    return validateStoredListingProfile(JSON.parse(row.config_json));
  } catch {
    return null;
  }
}

async function saveListingProfile(domain: string, profile: ListingProfileConfig, env: Env): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    linkSelectors: profile.linkSelectors,
    removeSelectors: profile.removeSelectors,
    confidence: profile.confidence ?? 0.5,
    source: 'ai' as const,
    sampleUrl: profile.sampleUrl,
    updatedAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO scraper_configs (domain, mode, config_json, learned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(domain, mode) DO UPDATE SET
       config_json = excluded.config_json,
       learned_at = excluded.learned_at`
  ).bind(domain, 'listing', JSON.stringify(payload), now).run();
}

function pushListingCandidate(
  candidates: Map<string, { title: string; score: number }>,
  rawHref: string,
  rawTitle: string,
  score: number,
  finalUrl: string,
  sourceHost: string
) {
  const href = (rawHref || '').trim();
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;

  let normalized: URL;
  try {
    normalized = new URL(href, finalUrl);
  } catch {
    return;
  }

  const hostname = normalized.hostname.replace(/^www\./, '').toLowerCase();
  if (!(hostname === sourceHost || hostname.endsWith(`.${sourceHost}`) || sourceHost.endsWith(`.${hostname}`))) return;

  normalized.hash = '';
  normalized.search = '';
  const pathname = normalized.pathname.replace(/\/+$/, '') || '/';

  let isArticle = isLikelyArticlePath(pathname);
  if (sourceHost === 'vercel.com') {
    isArticle = isLikelyVercelBlogArticle(pathname);
  }
  if (!isArticle) return;

  const title = cleanText(rawTitle) || slugToTitle(pathname);
  if (!title) return;

  const key = normalized.toString();
  const prev = candidates.get(key);
  if (!prev || score > prev.score || title.length > prev.title.length) {
    candidates.set(key, { title, score });
  }
}

export async function extractListingWithSelectorSet(
  html: string,
  selectors: { linkSelectors: string[]; removeSelectors: string[] },
  finalUrl: string,
  sourceHost: string
): Promise<Map<string, { title: string; score: number }>> {
  const candidates = new Map<string, { title: string; score: number }>();
  let currentHref = '';
  let currentText = '';

  let rewriter = new HTMLRewriter();
  const removeSelector = selectors.removeSelectors.join(', ');
  if (removeSelector) {
    rewriter = rewriter.on(removeSelector, {
      element(el: Element) {
        el.remove();
      },
    });
  }

  const linkSelector = selectors.linkSelectors.join(', ');
  if (!linkSelector) return candidates;

  rewriter = rewriter.on(linkSelector, {
    element(el: Element) {
      const href = el.getAttribute('href') || '';
      currentHref = href;
      currentText = '';
      el.onEndTag(() => {
        pushListingCandidate(
          candidates,
          currentHref,
          currentText,
          scoreListingHref(currentHref, sourceHost),
          finalUrl,
          sourceHost
        );
        currentHref = '';
        currentText = '';
      });
    },
    text(text: Text) {
      currentText += ` ${text.text}`;
    },
  });

  await rewriter.transform(new Response(html)).text();
  return candidates;
}

function defaultListingSelectors(sourceHost: string): { linkSelectors: string[]; removeSelectors: string[] } {
  if (sourceHost === 'vercel.com') {
    return {
      linkSelectors: ['a[href^="/blog/"]', 'a[href*="://vercel.com/blog/"]'],
      removeSelectors: [],
    };
  }
  return {
    linkSelectors: ['a[href]'],
    removeSelectors: [],
  };
}

function shouldAcceptListingCandidate(
  candidate: ArticleInput[],
  baseline: ArticleInput[]
): boolean {
  if (candidate.length < 3) return false;
  if (baseline.length === 0) return true;
  return candidate.length >= Math.max(3, Math.floor(baseline.length * 0.5));
}

async function fetchUnknown(source: Source, env: Env): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTML source failed: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error(`HTML source is not text/html: ${contentType || 'unknown'}`);
  }

  const finalUrl = response.url || source.url;
  const pageHost = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
  const sourceHost = new URL(source.url).hostname.replace(/^www\./, '').toLowerCase();
  const html = await response.text();
  const learnedProfile = await loadStoredListingProfile(pageHost, env);

  let activeSelectors = defaultListingSelectors(sourceHost);
  let profileUsed = 'heuristic_default';
  if (learnedProfile) {
    activeSelectors = normalizeListingProfile(learnedProfile);
    profileUsed = 'd1_listing';
    console.log(`[scraper] listing_profile_hit domain=${pageHost} source=d1`);
  } else {
    console.log(`[scraper] listing_profile_miss domain=${pageHost}`);
  }

  let candidates = await extractListingWithSelectorSet(html, activeSelectors, finalUrl, sourceHost);
  let result = buildListingArticles(candidates);

  if (learnedProfile && result.length < 3) {
    const fallbackCandidates = await extractListingWithSelectorSet(
      html,
      defaultListingSelectors(sourceHost),
      finalUrl,
      sourceHost
    );
    const fallbackResult = buildListingArticles(fallbackCandidates);
    if (fallbackResult.length > result.length) {
      result = fallbackResult;
      profileUsed = 'fallback_heuristic';
      console.log(`[scraper] fallback_used domain=${pageHost} reason=weak_listing_profile`);
    }
  }

  if (!learnedProfile && isLikelyListingUrl(finalUrl)) {
    const listingProfile = await generateListingProfile(pageHost, finalUrl, sanitizeHtmlForAi(html), env);
    if (listingProfile) {
      const learnedCandidates = await extractListingWithSelectorSet(
        html,
        normalizeListingProfile(listingProfile),
        finalUrl,
        sourceHost
      );
      const learnedResult = buildListingArticles(learnedCandidates);
      if (shouldAcceptListingCandidate(learnedResult, result)) {
        await saveListingProfile(pageHost, listingProfile, env);
        console.log(
          `[scraper] listing_profile_learned domain=${pageHost} confidence=${(listingProfile.confidence ?? 0).toFixed(2)} count=${learnedResult.length}`
        );
        if (learnedResult.length >= result.length) {
          result = learnedResult;
          profileUsed = 'learned_now';
        } else {
          console.log(`[scraper] fallback_used domain=${pageHost} reason=listing_baseline_better`);
        }
      } else {
        console.log(`[scraper] listing_profile_rejected domain=${pageHost} reason=quality_gate`);
      }
    }
  } else if (!learnedProfile) {
    console.log(`[scraper] listing_profile_learning_skipped domain=${pageHost} reason=non_listing_url`);
  }

  console.log(
    `[scraper] HTML ${pageHost}: extracted ${result.length} listing items from ${source.url} profile=${profileUsed}`
  );
  return result;
}

interface ExtractResult {
  text: string;
  paragraphs: number;
  anyContentSelectorMatched: boolean;
}

const MAX_CONTENT_CHARS = 25000;


export function normalizeProfile(profile: ScraperProfileConfig): SiteProfile {
  return {
    contentSelectors: profile.contentSelectors,
    removeSelectors: profile.removeSelectors,
    minLength: profile.minLength ?? 40,
  };
}

function sanitizeHtmlForAi(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec)));
}

function isLikelyNoisyContent(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  const noiseMarkers = [
    'cookie',
    'privacy policy',
    'subscribe',
    'advertisement',
    'all rights reserved',
    'sign in',
    'log in',
    'newsletter',
  ];
  let hits = 0;
  for (const marker of noiseMarkers) {
    if (lower.includes(marker)) hits++;
  }
  return hits >= 4;
}

export async function extractFromHtmlWithProfile(html: string, profile: SiteProfile): Promise<ExtractResult> {
  const minLen = profile.minLength ?? 40;
  const paragraphs: string[] = [];
  let currentParagraph = '';
  let totalLen = 0;
  let contentDepth = 0;
  let anyContentSelectorMatched = false;

  function flushParagraph() {
    if (totalLen >= MAX_CONTENT_CHARS) return;
    if (currentParagraph.trim()) {
      const clean = decodeEntities(currentParagraph.trim());
      if (clean.length >= minLen) {
        paragraphs.push(clean);
        totalLen += clean.length;
      }
    }
    currentParagraph = '';
  }

  let rewriter = new HTMLRewriter();
  const removeSelector = profile.removeSelectors.join(', ');
  if (removeSelector) {
    rewriter = rewriter.on(removeSelector, {
      element(el: Element) {
        el.remove();
      },
    });
  }

  const contentSelector = profile.contentSelectors.join(', ');
  rewriter = rewriter.on(contentSelector, {
    element(el: Element) {
      contentDepth++;
      anyContentSelectorMatched = true;
      flushParagraph();
      el.onEndTag(() => {
        flushParagraph();
        contentDepth = Math.max(0, contentDepth - 1);
      });
    },
  });

  rewriter = rewriter.on('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, div, section, article', {
    element() {
      flushParagraph();
    },
  });

  rewriter = rewriter.on('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, td, th, span, a, em, strong, b, i, code', {
    text(text: Text) {
      if (totalLen >= MAX_CONTENT_CHARS) return;
      if (contentDepth <= 0) return;
      const t = text.text.trim();
      if (t) currentParagraph += ' ' + t;
    },
  });

  await rewriter.transform(new Response(html)).text();
  flushParagraph();

  if (!anyContentSelectorMatched && paragraphs.length === 0) {
    return { text: '', paragraphs: 0, anyContentSelectorMatched: false };
  }

  const text = paragraphs
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CONTENT_CHARS);

  return { text, paragraphs: paragraphs.length, anyContentSelectorMatched };
}

function validateStoredProfile(config: any): ScraperProfileConfig | null {
  const contentSelectors = Array.isArray(config?.contentSelectors)
    ? config.contentSelectors.filter((v: unknown) => typeof v === 'string' && v.trim()).slice(0, 8)
    : [];
  if (contentSelectors.length === 0) return null;

  const removeSelectors = Array.isArray(config?.removeSelectors)
    ? config.removeSelectors.filter((v: unknown) => typeof v === 'string' && v.trim()).slice(0, 20)
    : [];

  const minLength = Number.isFinite(Number(config?.minLength))
    ? Math.max(20, Math.min(300, Number(config.minLength)))
    : 40;
  const confidence = Number.isFinite(Number(config?.confidence))
    ? Math.max(0, Math.min(1, Number(config.confidence)))
    : 0.5;
  const sampleUrl = typeof config?.sampleUrl === 'string' ? config.sampleUrl : '';
  const updatedAt = typeof config?.updatedAt === 'string' ? config.updatedAt : new Date().toISOString();

  return {
    contentSelectors,
    removeSelectors,
    minLength,
    confidence,
    source: 'ai',
    sampleUrl,
    updatedAt,
  };
}

async function loadStoredProfile(domain: string, env: Env): Promise<ScraperProfileConfig | null> {
  const { results } = await env.DB.prepare(
    'SELECT config_json FROM scraper_configs WHERE domain = ? AND mode = ? LIMIT 1'
  ).bind(domain, 'html').all<{ config_json: string }>();

  if (!results || results.length === 0) return null;
  const row = results[0];
  if (!row?.config_json) return null;

  try {
    return validateStoredProfile(JSON.parse(row.config_json));
  } catch {
    return null;
  }
}

async function saveProfile(domain: string, profile: ScraperProfileConfig, env: Env): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    contentSelectors: profile.contentSelectors,
    removeSelectors: profile.removeSelectors,
    minLength: profile.minLength ?? 40,
    confidence: profile.confidence ?? 0.5,
    source: 'ai' as const,
    sampleUrl: profile.sampleUrl,
    updatedAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO scraper_configs (domain, mode, config_json, learned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(domain, mode) DO UPDATE SET
       config_json = excluded.config_json,
       learned_at = excluded.learned_at`
  ).bind(domain, 'html', JSON.stringify(payload), now).run();
}

function shouldAcceptCandidate(candidate: ExtractResult, baseline: ExtractResult, minLength = 40): boolean {
  if (!candidate.text) return false;
  if (isLikelyNoisyContent(candidate.text)) return false;

  const minChars = Math.max(240, minLength * 6);
  if (candidate.text.length < minChars) return false;

  if (baseline.text.length === 0) return true;
  return candidate.text.length >= Math.floor(baseline.text.length * 0.85);
}

function isLikelyArticlePage(pageUrl: string, html: string): boolean {
  try {
    const u = new URL(pageUrl);
    const path = u.pathname.toLowerCase().replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);

    if (segments.length < 2) return false;
    if (/(^|\/)(category|categories|tag|tags|author|authors|topics|topic)(\/|$)/.test(path)) return false;
    if (/\/page\/\d+\/?$/.test(path)) return false;
    // Loại trừ trang utility không phải bài viết
    if (/(^|\/)(docs|documentation|help|faq|about|careers|privacy|terms|contact|search|pricing|changelog)(\/|$)/.test(path)) return false;

    const compact = html.replace(/\s+/g, ' ').slice(0, 200000).toLowerCase();

    // Schema.org — tín hiệu mạnh nhất
    if (compact.includes('"@type":"blogposting"') || compact.includes('"@type": "blogposting"')) return true;
    if (compact.includes('"@type":"newsarticle"') || compact.includes('"@type": "newsarticle"')) return true;

    // Open Graph article type
    if (/property=["']og:type["'][^>]*content=["']article["']/i.test(compact) ||
        /content=["']article["'][^>]*property=["']og:type["']/i.test(compact)) return true;

    // Có thẻ <article> với nội dung thực
    if (/<article[^>]*>[\s\S]{200,}<\/article>/i.test(html)) return true;

    // Không có tín hiệu mạnh → không kích hoạt AI
    return false;
  } catch {
    return false;
  }
}

/**
 * Fetch nội dung bài viết từ URL gốc.
 * Ưu tiên profile đã học trong D1, fallback sang hardcoded profile.
 * Domain mới sẽ được AI học profile ngay lần scrape đầu tiên.
 */
export async function extractArticleContent(url: string, env: Env): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return '';

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return '';

    const finalUrl = response.url || url;
    const domain = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
    const html = await response.text();
    if (!html) return '';

    const staticProfile = resolveStaticProfile(finalUrl);
    const learnedProfile = await loadStoredProfile(domain, env);

    let activeProfile: SiteProfile = staticProfile;
    if (learnedProfile) {
      activeProfile = normalizeProfile(learnedProfile);
      console.log(`[scraper] profile_hit domain=${domain} source=d1`);
    } else {
      console.log(`[scraper] profile_miss domain=${domain} fallback=${staticProfile.matchedKey}`);
    }

    let chosen = await extractFromHtmlWithProfile(html, activeProfile);
    let usedProfile = learnedProfile ? 'd1' : 'static';

    // Fallback an toàn nếu profile D1 đã tồn tại nhưng fail ở request hiện tại
    if (learnedProfile && chosen.text.length === 0) {
      const fallback = await extractFromHtmlWithProfile(html, staticProfile);
      if (fallback.text.length > 0) {
        chosen = fallback;
        usedProfile = 'fallback_static';
        console.log(`[scraper] fallback_used domain=${domain} reason=empty_d1_result`);
      }
    }

    // Domain chưa có profile D1 -> học profile từ lần scrape đầu
    if (!learnedProfile && isLikelyArticlePage(finalUrl, html)) {
      const aiProfile = await generateScraperProfile(domain, finalUrl, sanitizeHtmlForAi(html), env);
      if (aiProfile) {
        const candidate = await extractFromHtmlWithProfile(html, normalizeProfile(aiProfile));
        if (shouldAcceptCandidate(candidate, chosen, aiProfile.minLength ?? 40)) {
          await saveProfile(domain, aiProfile, env);
          console.log(
            `[scraper] profile_learned domain=${domain} confidence=${(aiProfile.confidence ?? 0).toFixed(2)} chars=${candidate.text.length}`
          );

          if (candidate.text.length >= chosen.text.length) {
            chosen = candidate;
            usedProfile = 'learned_now';
          } else {
            console.log(`[scraper] fallback_used domain=${domain} reason=baseline_better`);
          }
        } else {
          console.log(`[scraper] profile_rejected domain=${domain} reason=quality_gate`);
        }
      }
    } else if (!learnedProfile) {
      console.log(`[scraper] profile_learning_skipped domain=${domain} reason=non_article_url`);
    }

    if (!chosen.text) return '';
    console.log(
      `[scraper] ${domain}: extracted ${chosen.text.length} chars (${chosen.paragraphs} paragraphs) profile=${usedProfile}`
    );
    return chosen.text;
  } catch (err: any) {
    console.log(`[scraper] extract_error ${url}: ${err.message}`);
    return '';
  }
}
