import { XMLParser } from 'fast-xml-parser';
export { normalizeDate } from '../utils/date';

export function nodeText(value: any): string {
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
    if (typeof value.__cdata === 'string') return value.__cdata.trim();
    if (typeof value._text === 'string') return value._text.trim();
    if (typeof value['#text'] === 'string') return value['#text'].trim();
  }
  return '';
}

export function extractItemLink(item: any): string {
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

export function parseRssOrAtom(xml: string): { items: any[]; format: 'rss' | 'atom' } | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '_text',
    cdataPropName: '__cdata',
    // Skip parsing inside encoded content nodes (HTML entities would cause issues)
    stopNodes: ['*.content:encoded', '*.encoded'],
    processEntities: true,
    htmlEntities: false,
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

export function isLikelyHtml(contentType: string, text: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html')) return true;
  const sample = text.slice(0, 800).toLowerCase();
  return sample.includes('<!doctype html') || sample.includes('<html');
}

/**
 * Detect charset from HTTP Content-Type header or XML prolog.
 * Falls back to UTF-8.
 */
export function detectCharset(contentType: string, buffer: ArrayBuffer): string {
  // 1. From Content-Type: text/xml; charset=iso-8859-1
  const ctMatch = contentType.match(/charset=([^\s;,]+)/i);
  if (ctMatch) return ctMatch[1].trim();

  // 2. From XML prolog: <?xml version="1.0" encoding="windows-1252"?>
  // Peek first 300 bytes as latin1 (safe for any single-byte encoding)
  const probe = new TextDecoder('latin1').decode(buffer.slice(0, 300));
  const xmlMatch = probe.match(/encoding=["']([^"']+)["']/i);
  if (xmlMatch) return xmlMatch[1].trim();

  return 'utf-8';
}

/**
 * Fetch a feed URL as ArrayBuffer, detect charset, decode correctly.
 * Returns { text, contentType, isJsonFeed }.
 */
export async function fetchFeedBuffer(
  url: string,
  signal?: AbortSignal
): Promise<{ text: string; contentType: string; isJsonFeed: boolean }> {
  let fetchUrl = url;

  // Google News RSS requires hl/gl/ceid query params, otherwise returns 302 → 503
  if (url.includes('news.google.com/rss')) {
    const u = new URL(url);
    if (!u.searchParams.has('hl')) u.searchParams.set('hl', 'en-US');
    if (!u.searchParams.has('gl')) u.searchParams.set('gl', 'US');
    if (!u.searchParams.has('ceid')) u.searchParams.set('ceid', 'US:en');
    fetchUrl = u.toString();
  }

  const response = await fetch(fetchUrl, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' },
    signal,
  });
  if (!response.ok) throw new Error(`Feed fetch failed: ${response.status} ${url}`);

  const contentType = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  const charset = detectCharset(contentType, buffer);

  // TextDecoder automatically strips BOM for utf-8/utf-16
  let text: string;
  try {
    text = new TextDecoder(charset).decode(buffer).trim();
  } catch {
    // Unknown charset label → fallback to UTF-8
    text = new TextDecoder('utf-8').decode(buffer).trim();
  }

  const isJsonFeed = /json/i.test(contentType) || (text.startsWith('{') && text.includes('"items"'));
  return { text, contentType, isJsonFeed };
}

export function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function slugToTitle(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean).pop() || '';
  const withoutExt = seg.replace(/\.[a-z0-9]+$/i, '');
  const text = withoutExt.replace(/[-_]+/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function isLikelyArticlePath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (!p || p === '/' || p === '/blog') return false;
  if (/\.(xml|json|png|jpg|jpeg|webp|svg|gif|ico|pdf|zip)$/i.test(p)) return false;
  if (/\/(tag|tags|category|categories|author|authors|about|careers|privacy|terms|contact|search)\b/.test(p)) return false;
  if (/\/page\/\d+\/?$/.test(p)) return false;
  const segments = p.split('/').filter(Boolean);
  return segments.length >= 1;
}

export function isLikelyVercelBlogArticle(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (!p.startsWith('/blog/')) return false;
  if (/^\/blog\/?$/.test(p)) return false;
  if (/^\/blog\/(tag|tags|category|categories|author|authors)\b/.test(p)) return false;
  return p.split('/').filter(Boolean).length >= 2;
}

/** Strip script/style/comments to reduce token count before feeding to AI. */
export function sanitizeHtmlForAi(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function decodeEntities(s: string): string {
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

/**
 * Strip HTML tags from RSS content:encoded → plain text suitable for AI summarization.
 * Preserves line breaks at block-level elements. Decodes HTML entities.
 */
export function stripHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|h[1-6]|li|blockquote|tr|td|th|section|article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
