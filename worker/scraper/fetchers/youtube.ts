import { Env, Source, ArticleInput } from '../../types';
import { parseRssOrAtom, extractItemLink, nodeText, normalizeDate } from '../utils';

/**
 * Resolve YouTube channel handle (@handle) → channel_id.
 * Reads from source.channel_id first (cached in sources table),
 * then fetches channel page HTML and extracts from rssUrl or externalId.
 * If both fail and YOUTUBE_API_KEY is set, uses the API as last resort.
 */
async function resolveYouTubeChannelId(source: Source, handle: string, env: Env): Promise<string> {
  // 1. Check if already cached in the source record
  if (source.channel_id) {
    return source.channel_id;
  }

  // 2. Try fetching channel page HTML
  try {
    const pageRes = await fetch(`https://www.youtube.com/@${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const rssMatch = html.match(/"rssUrl":"https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=([a-zA-Z0-9_-]+)"/);
      if (rssMatch) {
        await saveChannelId(source.id, rssMatch[1], env);
        return rssMatch[1];
      }
      const extMatch = html.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/);
      if (extMatch) {
        await saveChannelId(source.id, extMatch[1], env);
        return extMatch[1];
      }
    }
  } catch (e) {
    console.log(`[scraper] HTML resolve failed for @${handle}: ${e}`);
  }

  // 3. Fallback: use YouTube API v3 if available
  if (env.YOUTUBE_API_KEY) {
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${handle}&key=${env.YOUTUBE_API_KEY}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (channelRes.ok) {
      const data: any = await channelRes.json();
      if (data.items?.[0]?.id) {
        await saveChannelId(source.id, data.items[0].id, env);
        return data.items[0].id;
      }
    }
  }

  throw new Error(`Could not resolve channel_id for @${handle}`);
}

async function saveChannelId(sourceId: string, channelId: string, env: Env) {
  await env.DB.prepare('UPDATE sources SET channel_id = ? WHERE id = ?')
    .bind(channelId, sourceId).run();
  console.log(`[scraper] YouTube channel_id saved: ${channelId}`);
}

/** Try fetching videos via free RSS/Atom feed. Returns null on failure. */
async function fetchYouTubeViaRSS(handle: string, channelId: string): Promise<ArticleInput[] | null> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  try {
    // Retry once for transient 404s
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) break;
      if (attempt === 0) {
        console.log(`[scraper] YouTube RSS ${res.status} for @${handle}, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!res || !res.ok) return null;

    const xml = await res.text();
    const parsed = parseRssOrAtom(xml);
    if (!parsed) return null;

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    return parsed.items
      .filter((item: any) => {
        const published = item.published || item.pubDate || item.updated;
        if (!published) return false;
        return new Date(published) >= threeDaysAgo;
      })
      .slice(0, 2)
      .map((item: any) => {
        const link = extractItemLink(item);
        const title = nodeText(item.title);
        const published = item.published || item.pubDate || item.updated;
        const mediaGroup = item['media:group'] || {};
        const description = nodeText(mediaGroup['media:description']) || '';

        return {
          url: link,
          title,
          description: description.slice(0, 500),
          published_at: normalizeDate(published),
        };
      })
      .filter((item: ArticleInput) => item.url && item.title);
  } catch (e) {
    console.log(`[scraper] YouTube RSS error for @${handle}: ${e}`);
    return null;
  }
}

/** Fallback: fetch videos via YouTube Data API v3. */
async function fetchYouTubeViaAPI(handle: string, channelId: string, apiKey: string): Promise<ArticleInput[]> {
  // Get uploads playlist ID from channel
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!channelRes.ok) throw new Error(`YouTube API channels failed: ${channelRes.status}`);

  const channelData: any = await channelRes.json();
  const playlistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error(`No uploads playlist for @${handle}`);

  // Get latest videos from uploads playlist
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=5&key=${apiKey}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`YouTube API playlistItems failed: ${res.status}`);

  const data: any = await res.json();
  const items = data.items || [];

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  return items
    .filter((item: any) => new Date(item.snippet.publishedAt) >= threeDaysAgo)
    .slice(0, 2)
    .map((item: any) => ({
      url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
      title: item.snippet.title,
      description: (item.snippet.description || '').slice(0, 500),
      published_at: normalizeDate(item.snippet.publishedAt),
    }));
}

/**
 * Fetch YouTube videos. Strategy:
 * 1. Try free RSS/Atom feed (no API key needed)
 * 2. If RSS fails → fallback to YouTube Data API v3 (needs YOUTUBE_API_KEY)
 */
export async function fetchYouTube(source: Source, env: Env): Promise<ArticleInput[]> {
  const handleMatch = source.url.match(/@([a-zA-Z0-9_-]+)/);
  if (!handleMatch) {
    throw new Error(`Cannot extract YouTube handle from URL: ${source.url}`);
  }

  const handle = handleMatch[1];
  const channelId = await resolveYouTubeChannelId(source, handle, env);

  // Try 1: RSS/Atom feed (free)
  const rssResult = await fetchYouTubeViaRSS(handle, channelId);
  if (rssResult) return rssResult;

  // Try 2: YouTube API v3 (reliable but needs API key)
  if (env.YOUTUBE_API_KEY) {
    console.log(`[scraper] YouTube RSS failed for @${handle}, falling back to API v3`);
    return fetchYouTubeViaAPI(handle, channelId, env.YOUTUBE_API_KEY);
  }

  throw new Error(`YouTube RSS feed unavailable for @${handle} and no YOUTUBE_API_KEY configured`);
}
