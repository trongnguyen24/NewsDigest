import { extractFromXml, extractFromJson } from '@extractus/feed-extractor';
import { Source, ArticleInput } from '../../types';
import { fetchFeedBuffer, isLikelyHtml, normalizeDate } from '../utils';

export async function fetchRSS(source: Source): Promise<ArticleInput[]> {
  const { text, contentType, isJsonFeed } = await fetchFeedBuffer(
    source.url,
    AbortSignal.timeout(15000)
  );

  if (isLikelyHtml(contentType, text)) {
    throw new Error(`RSS feed returned HTML for ${source.url}. Please use feed URL (XML).`);
  }

  let entries: Array<{ id?: string; title?: string; link?: string; description?: string; published?: string }>;

  if (isJsonFeed) {
    // JSON Feed (application/feed+json)
    let json: any;
    try { json = JSON.parse(text); } catch { throw new Error(`Invalid JSON Feed for ${source.url}`); }
    const feed = extractFromJson(json, { descriptionMaxLen: 0 });
    if (!feed) throw new Error(`Could not parse JSON Feed for ${source.url}`);
    entries = feed.entries ?? [];
  } else {
    // RSS / Atom / RDF with namespace + encoding support
    let feed: any;
    try {
      feed = extractFromXml(text, {
        descriptionMaxLen: 0,
        getExtraEntryFields: (entry: any) => {
          // Pull content:encoded (WordPress / general RSS), dc:creator, media:description
          const encoded = entry['content:encoded'] ?? entry['encoded'] ?? '';
          const mediaGroup = entry['media:group'] ?? {};
          const mediaDesc = mediaGroup['media:description'] ?? entry['media:description'] ?? '';
          return {
            // Expose content:encoded as a fallback description
            contentEncoded: typeof encoded === 'string' ? encoded.trim() : '',
            mediaDescription: typeof mediaDesc === 'string' ? mediaDesc.trim() : '',
          };
        },
      } as any);
    } catch (e) {
      throw new Error(`Invalid RSS/Atom/RDF payload for ${source.url}: ${e}`);
    }
    if (!feed) throw new Error(`Invalid RSS/Atom/RDF payload for ${source.url}`);
    entries = feed.entries ?? [];
  }

  // Chỉ lấy bài trong 3 ngày gần nhất, tối đa 10 bài
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const recent = entries.filter((entry: any) => {
    if (!entry.published) return true; // không có ngày → giữ lại, normalizeDate sẽ dùng now
    return new Date(entry.published) >= threeDaysAgo;
  });

  const mapped = recent.slice(0, 10).map((entry: any) => {
    let link = (entry.link ?? '').trim();
    if (link && !/^https?:\/\//i.test(link)) {
      try { link = new URL(link, source.url).toString(); } catch { link = ''; }
    }
    // description: prefer feed-extractor's normalized field, fallback to content:encoded / media
    const desc = entry.description || entry.contentEncoded || entry.mediaDescription || '';
    return {
      url: link,
      title: (entry.title ?? '').trim(),
      description: desc,
      published_at: normalizeDate(entry.published ?? null),
    };
  });

  const valid = mapped.filter(item => item.url && item.title);
  console.log(
    `[scraper] RSS ${source.url}: total=${entries.length} recent=${recent.length} valid=${valid.length} ` +
    `(cutoff=${threeDaysAgo.toISOString().slice(0, 10)})`
  );
  return valid;
}
