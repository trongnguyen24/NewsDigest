import { browser } from 'wxt/browser';
import type { ContentScriptMessage } from '../lib/types';
import { scrapeRedditListing, scrapeRedditPost } from '../lib/scraper';

export default defineContentScript({
  matches: ['*://old.reddit.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message: ContentScriptMessage) => {
      if (message?.action === 'ping') return Promise.resolve({ ok: true });
      if (message?.action === 'scrape-listing') return Promise.resolve({ ok: true, articles: scrapeRedditListing() });
      if (message?.action === 'scrape-post') return Promise.resolve({ ok: true, ...scrapeRedditPost() });
      return undefined;
    });
  },
});
