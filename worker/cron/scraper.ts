import { XMLParser } from 'fast-xml-parser';
import { Env, Source, ArticleInput } from '../types';
import { getProfile } from './site-profiles';

/** Chuẩn hoá mọi định dạng ngày (RFC 2822, ISO 8601…) về ISO 8601 UTC. */
function normalizeDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
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
  } else {
    // Basic fallback for HTML or unknown
    return fetchUnknown(source);
  }
}

async function fetchReddit(source: Source): Promise<ArticleInput[]> {
  const url = source.url.endsWith('/') ? `${source.url}hot.json?limit=25` : `${source.url}/hot.json?limit=25`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'NewsDigest/1.0 (news aggregation bot)' }
  });
  if (!response.ok) throw new Error(`Reddit API failed: ${response.status}`);
  
  const data: any = await response.json();
  const children = data?.data?.children || [];
  
  return children
    .filter((item: any) => !item.data.stickied) // Skip pinned posts
    .map((item: any) => {
      const d = item.data;
      const meta = `⬆${d.score} 💬${d.num_comments} r/${d.subreddit}`;
      return {
        url: `https://www.reddit.com${d.permalink}`,
        title: d.title,
        description: d.selftext
          ? `${meta}\n${d.selftext.slice(0, 300)}`
          : meta,
        published_at: new Date(d.created_utc * 1000).toISOString()
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

  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=10&key=${apiKey}`);
  const data: any = await res.json();
  const items = data.items || [];
  
  return items.map((item: any) => {
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
  
  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    textNodeName: "_text",
  });
  const result: any = parser.parse(xml);
  
  let items = [];
  if (result.rss && result.rss.channel && result.rss.channel.item) {
    items = Array.isArray(result.rss.channel.item) ? result.rss.channel.item : [result.rss.channel.item];
  } else if (result.feed && result.feed.entry) {
    items = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
  }

  return items.slice(0, 20).map((item: any) => {
    let link = item.link;
    if (typeof link === 'object' && link['@_href']) {
      link = link['@_href'];
    }
    return {
      url: link,
      title: item.title,
      description: item.description || item.content || item['_text'] || '',
      published_at: normalizeDate(item.pubDate || item.published)
    };
  });
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

async function fetchUnknown(source: Source): Promise<ArticleInput[]> {
  console.log(`Fallback fetch for HTML source ${source.url} not fully implemented yet.`);
  return [];
}

/**
 * Fetch nội dung bài viết từ URL gốc.
 * Dùng HTMLRewriter + SiteProfile để extract text chính xác theo từng site.
 * contentSelectors dùng để scope vùng content (chỉ lấy text bên trong).
 * removeSelectors dùng để xoá noise trước khi extract.
 * Giới hạn 25000 ký tự.
 */
export async function extractArticleContent(url: string): Promise<string> {
  try {
    const profile = getProfile(url);
    const minLen = profile.minLength ?? 40;

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

    const paragraphs: string[] = [];
    let currentParagraph = '';
    let totalLen = 0;
    const MAX_CHARS = 25000;

    // Track whether we're inside a content container
    // depth > 0 means we're inside at least one matching content selector
    let contentDepth = 0;
    // If no contentSelector matched at all, we'll fallback to capturing everything
    let anyContentSelectorMatched = false;

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

    function flushParagraph() {
      if (totalLen >= MAX_CHARS) return;
      if (currentParagraph.trim()) {
        const clean = decodeEntities(currentParagraph.trim());
        if (clean.length >= minLen) {
          paragraphs.push(clean);
          totalLen += clean.length;
        }
      }
      currentParagraph = '';
    }

    // Build rewriter
    let rewriter = new HTMLRewriter();

    // 1) Remove noise elements from profile
    const removeSelector = profile.removeSelectors.join(', ');
    if (removeSelector) {
      rewriter = rewriter.on(removeSelector, {
        element(el: Element) { el.remove(); }
      });
    }

    // 2) Track content scope using contentSelectors
    //    Enter → depth++, Leave (end tag) → depth--
    const contentSelector = profile.contentSelectors.join(', ');
    rewriter = rewriter.on(contentSelector, {
      element(el: Element) {
        contentDepth++;
        anyContentSelectorMatched = true;
        // Also flush paragraph at container boundary
        flushParagraph();

        el.onEndTag(() => {
          flushParagraph();
          contentDepth--;
        });
      }
    });

    // 3) Paragraph boundary detection
    rewriter = rewriter.on('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, div, section, article', {
      element(_el: Element) {
        flushParagraph();
      }
    });

    // 4) Text extraction — only capture if inside content scope
    rewriter = rewriter.on('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, td, th, span, a, em, strong, b, i, code', {
      text(text: Text) {
        if (totalLen >= MAX_CHARS) return;
        // Only capture text if we're inside a content container
        if (contentDepth <= 0) return;
        const t = text.text.trim();
        if (t) {
          currentParagraph += ' ' + t;
        }
      }
    });

    await rewriter.transform(response).text();

    // Flush last paragraph
    flushParagraph();

    // If no content selector matched at all, it means the page structure
    // didn't match any profile selector. Return empty — the generic approach
    // would just capture garbage anyway.
    if (!anyContentSelectorMatched && paragraphs.length === 0) {
      return '';
    }

    const result = paragraphs
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_CHARS);

    console.log(`[scraper] ${profile.hostname}: extracted ${result.length} chars (${paragraphs.length} paragraphs)`);
    return result;
  } catch {
    return '';
  }
}

