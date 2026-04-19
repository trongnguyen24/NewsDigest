import { Env, ListingProfileConfig, ArticleInput } from '../../types';
import { cleanText, slugToTitle, isLikelyArticlePath, isLikelyVercelBlogArticle } from '../utils';

// ── Validation ─────────────────────────────────────────────────────────────

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

// ── D1 persistence ──────────────────────────────────────────────────────────

export async function loadStoredListingProfile(domain: string, env: Env): Promise<ListingProfileConfig | null> {
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

export async function saveListingProfile(domain: string, profile: ListingProfileConfig, env: Env): Promise<void> {
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

// ── Profile normalisation ───────────────────────────────────────────────────

export function normalizeListingProfile(profile: ListingProfileConfig): {
  linkSelectors: string[];
  removeSelectors: string[];
} {
  return {
    linkSelectors: profile.linkSelectors,
    removeSelectors: profile.removeSelectors,
  };
}

// ── Selectors & URL helpers ──────────────────────────────────────────────────

function scoreListingHref(href: string, sourceHost: string): number {
  if (sourceHost === 'vercel.com' && href.includes('/blog/')) return 100;
  return href.startsWith('/') ? 60 : 40;
}

export function defaultListingSelectors(sourceHost: string): { linkSelectors: string[]; removeSelectors: string[] } {
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

export function isLikelyListingUrl(pageUrl: string): boolean {
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

// ── Candidate accumulation ──────────────────────────────────────────────────

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

export function shouldAcceptListingCandidate(
  candidate: ArticleInput[],
  baseline: ArticleInput[]
): boolean {
  if (candidate.length < 3) return false;
  if (baseline.length === 0) return true;
  return candidate.length >= Math.max(3, Math.floor(baseline.length * 0.5));
}
