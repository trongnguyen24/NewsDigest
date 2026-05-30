import { Env } from '../../types';
import { youtubeFetcher } from './youtube';
import { redditFetcher } from './reddit';
import { githubFetcher } from './github';
import { genericFetcher } from './generic';

/**
 * A self-contained content fetcher for a specific URL type.
 * Add new fetchers here — do NOT add routing logic to the queue consumer.
 */
export interface ContentFetcher {
  /** Return true if this fetcher can handle the given URL */
  matches(url: string): boolean;
  /**
   * Fetch raw text content for the article.
   * @throws {NetworkError}           — transient, should retry
   * @throws {RateLimitError}         — transient, retry with delay
   * @throws {ContentUnavailableError} — permanent, ack without retry
   * @throws {ConfigError}            — permanent, ack without retry
   */
  fetch(url: string, env: Env): Promise<string>;
}

/**
 * Ordered registry — first match wins.
 * To add a new source type: create a fetcher module and prepend it here.
 */
const FETCHERS: ContentFetcher[] = [
  youtubeFetcher,  // youtube.com, youtu.be
  redditFetcher,   // reddit.com — legacy: extension pushes new content; kept for queue retry of old items
  githubFetcher,   // github.com/<owner>/<repo> (exact repo URLs only)
  genericFetcher,  // HTMLRewriter fallback — always matches
];

/**
 * Resolve the correct fetcher for a URL.
 * Falls back to genericFetcher if no specific fetcher matches.
 */
export function resolveFetcher(url: string): ContentFetcher {
  return FETCHERS.find(f => f.matches(url)) ?? genericFetcher;
}
