import { XMLParser } from 'fast-xml-parser';
import { Env, Source } from '../types';
import type { Context } from 'hono';
import { normalizeDate } from '../utils/date';

// ── Auth ─────────────────────────────────────────────────

/** Check X-Admin-Key header against ADMIN_API_KEY secret. Returns error Response or null. */
export function requireAdmin(c: Context<{ Bindings: Env }>): Response | null {
  const adminKey = c.env.ADMIN_API_KEY;
  if (!adminKey) return null; // no key configured → skip check
  const provided = c.req.header('X-Admin-Key');
  if (provided !== adminKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

export { normalizeDate };

// ── Source resolver ──────────────────────────────────────

const COMMON_FEED_PATHS = [
  '/rss',
  '/rss/',
  '/rss.xml',
  '/feed',
  '/feed/',
  '/feed.xml',
  '/atom.xml',
  '/index.xml',
];

export const ALLOWED_SOURCE_TYPES: Source['type'][] = ['rss', 'html', 'reddit', 'youtube', 'voz', 'github-trending'];

function parseFeedShape(xml: string): boolean {
  // Fast regex check: covers RSS/Atom with namespaces, CDATA, etc.
  const sample = xml.slice(0, 2000);
  if (/<rss[\s>]/i.test(sample) || /<feed[\s>]/i.test(sample)) return true;

  const parser = new XMLParser({
    ignoreAttributes: false,
    textNodeName: '_text',
    cdataPropName: '_cdata',
  });
  try {
    const parsed: any = parser.parse(xml);
    return Boolean(parsed?.rss?.channel || parsed?.feed);
  } catch {
    return false;
  }
}

function isHtmlLike(contentType: string, text: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html')) return true;
  const sample = text.slice(0, 800).toLowerCase();
  return sample.includes('<!doctype html') || sample.includes('<html');
}

function getAttr(tag: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return (tag.match(re)?.[2] || '').trim();
}

function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = getAttr(tag, 'rel').toLowerCase();
    if (!rel.split(/\s+/).includes('canonical')) continue;
    const href = getAttr(tag, 'href');
    if (!href) continue;
    try {
      return new URL(href, fallbackUrl).toString();
    } catch {
      continue;
    }
  }
  return fallbackUrl;
}

function extractFeedLinksFromHtml(html: string, baseUrl: string): string[] {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const links: string[] = [];
  for (const tag of tags) {
    const rel = getAttr(tag, 'rel').toLowerCase();
    const type = getAttr(tag, 'type').toLowerCase();
    const href = getAttr(tag, 'href');
    if (!href) continue;
    if (!rel.split(/\s+/).includes('alternate')) continue;
    if (!(type.includes('application/rss+xml') || type.includes('application/atom+xml'))) continue;

    try {
      links.push(new URL(href, baseUrl).toString());
    } catch {
      // ignore invalid URLs
    }
  }
  return [...new Set(links)];
}

async function isValidFeedUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NewsDigest/1.0.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    if (isHtmlLike(contentType, text)) return false;
    return parseFeedShape(text);
  } catch {
    return false;
  }
}

function detectSpecialType(url: string): Source['type'] | null {
  const lower = url.toLowerCase();
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('voz.vn')) return 'voz';
  if (lower.includes('github.com/trending')) return 'github-trending';
  // Google News RSS feeds: news.google.com/rss/... → always RSS
  if (lower.includes('news.google.com/rss')) return 'rss';
  return null;
}

export async function resolveSource(url: string): Promise<{
  resolved_url: string;
  detected_type: Source['type'];
  detection_method: string;
}> {
  const normalizedInput = new URL(url).toString();
  const special = detectSpecialType(normalizedInput);
  if (special) {
    return {
      resolved_url: normalizedInput,
      detected_type: special,
      detection_method: 'known-source-type',
    };
  }

  const initial = await fetch(normalizedInput, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  if (!initial.ok) {
    throw new Error(`Source URL failed: ${initial.status}`);
  }

  const finalUrl = initial.url || normalizedInput;
  const body = await initial.text();
  const contentType = initial.headers.get('content-type') || '';

  if (!isHtmlLike(contentType, body) && parseFeedShape(body)) {
    return {
      resolved_url: finalUrl,
      detected_type: 'rss',
      detection_method: 'direct-xml',
    };
  }

  const canonicalUrl = extractCanonicalUrl(body, finalUrl);
  const fromHtml = extractFeedLinksFromHtml(body, canonicalUrl);
  for (const candidate of fromHtml) {
    if (await isValidFeedUrl(candidate)) {
      return {
        resolved_url: candidate,
        detected_type: 'rss',
        detection_method: 'html-link-alternate',
      };
    }
  }

  const canonical = new URL(canonicalUrl);
  const pathParts = canonical.pathname.split('/').filter(Boolean);
  const basePath = pathParts.length > 0 ? `/${pathParts[0]}` : '';
  const candidates = [
    ...COMMON_FEED_PATHS.map((p) => `${canonical.origin}${p}`),
    ...(basePath ? COMMON_FEED_PATHS.map((p) => `${canonical.origin}${basePath}${p}`) : []),
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (await isValidFeedUrl(candidate)) {
      return {
        resolved_url: candidate,
        detected_type: 'rss',
        detection_method: 'common-path',
      };
    }
  }

  return {
    resolved_url: canonicalUrl,
    detected_type: 'html',
    detection_method: 'html-fallback',
  };
}
