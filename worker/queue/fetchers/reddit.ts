import { NetworkError, RateLimitError } from '../../errors';
import type { ContentFetcher } from './index';
import { SCRAPER_SETTINGS } from '../../settings';

const MAX_CHARS = SCRAPER_SETTINGS.reddit.contentMaxChars;

async function fetchRedditPost(url: string): Promise<string> {
  const cleanUrl = url.replace(/\/+$/, '');
  const jsonUrl = `${cleanUrl}.json?limit=20&depth=2&sort=top`;

  const res = await fetch(jsonUrl, {
    headers: { 'User-Agent': 'NewsDigest/1.0 (news aggregation bot)' },
    signal: AbortSignal.timeout(SCRAPER_SETTINGS.reddit.fetchTimeoutMs),
  });

  if (res.status === 429) {
    throw new RateLimitError(`Reddit rate-limited (429)`, url);
  }
  if (!res.ok) {
    throw new NetworkError(`Reddit JSON failed: ${res.status}`, res.status, url);
  }

  const data: any = await res.json();

  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return '';

  const parts: string[] = [];

  parts.push(`[Post] ${post.title}`);
  if (post.selftext) {
    parts.push(post.selftext);
  }
  if (post.url_overridden_by_dest && !post.is_self) {
    parts.push(`Link: ${post.url_overridden_by_dest}`);
  }

  const comments = data?.[1]?.data?.children || [];
  const topComments = comments
    .filter((c: any) => c.kind === 't1')
    .slice(0, SCRAPER_SETTINGS.reddit.topCommentsLimit);

  if (topComments.length > 0) {
    parts.push('\n---\n[Top Comments]');
    for (const c of topComments) {
      const d = c.data;
      const body = (d.body || '').slice(0, SCRAPER_SETTINGS.reddit.commentPreviewChars);
      parts.push(`@${d.author} (score: ${d.score}): ${body}`);

      const replies = d.replies?.data?.children || [];
      const topReply = replies.find((r: any) => r.kind === 't1');
      if (topReply) {
        const rd = topReply.data;
        const replyBody = (rd.body || '').slice(0, SCRAPER_SETTINGS.reddit.replyPreviewChars);
        parts.push(`  ↳ @${rd.author} (score: ${rd.score}): ${replyBody}`);
      }
    }
  }

  return parts.join('\n').slice(0, MAX_CHARS);
}

export const redditFetcher: ContentFetcher = {
  matches(url) {
    return url.includes('reddit.com');
  },

  async fetch(url) {
    // Stagger Reddit requests to avoid rate-limits from Cloudflare datacenter IPs
    await new Promise(r => setTimeout(r, SCRAPER_SETTINGS.reddit.queueFetchDelayMs));
    return fetchRedditPost(url);
  },
};
