import { Env } from '../../types';
import { extractArticleContent } from '../../scraper';
import type { ContentFetcher } from './index';

/**
 * Fallback fetcher — uses HTMLRewriter + AI-learned CSS selector profiles.
 * Must be registered last in the FETCHERS array (always matches).
 */
export const genericFetcher: ContentFetcher = {
  matches(_url) {
    return true;
  },

  fetch(url: string, env: Env) {
    return extractArticleContent(url, env);
  },
};
