import { browser } from 'wxt/browser';
import { getRedditSources, pushContent, pushListing } from '../lib/api';
import type { ContentScriptMessage, ListingArticle, PopupMessage, ScrapeStatus } from '../lib/types';

const INITIAL_STATUS: ScrapeStatus = {
  running: false,
  phase: 'idle',
  contentIndex: 0,
  contentTotal: 0,
  sourcesTotal: 0,
  sourcesDone: 0,
  listingsFound: 0,
  inserted: 0,
  enqueued: 0,
  errors: 0,
  log: [],
};

let status: ScrapeStatus = { ...INITIAL_STATUS, log: [] };
let activeRun: Promise<void> | null = null;
let cancelRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): number {
  return 3_000 + Math.floor(Math.random() * 2_001);
}

function updateStatus(patch: Partial<ScrapeStatus>) {
  status = { ...status, ...patch };
  void browser.runtime.sendMessage({ action: 'scrape-progress', status }).catch(() => undefined);
}

function log(level: 'info' | 'success' | 'error', message: string) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toLocaleTimeString(),
    level,
    message,
  };
  updateStatus({ log: [...status.log, entry].slice(-80) });
}

function sourceToOldRedditHot(rawUrl: string): string {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/r\/([^/]+)/i);
  if (!match) throw new Error(`Cannot determine subreddit from ${rawUrl}`);
  return `https://old.reddit.com/r/${match[1]}/hot/`;
}

function postToOldReddit(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.protocol = 'https:';
  url.hostname = 'old.reddit.com';
  return url.toString();
}

async function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for tab load'));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    browser.tabs.onUpdated.addListener(listener);
  });
}

async function pingContentScript(tabId: number): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await browser.tabs.sendMessage(tabId, { action: 'ping' } satisfies ContentScriptMessage);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Content script did not become ready');
}

async function navigate(tabId: number, url: string): Promise<void> {
  await browser.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
  await pingContentScript(tabId);
}

async function scrapeListing(tabId: number): Promise<ListingArticle[]> {
  const response = await browser.tabs.sendMessage(tabId, { action: 'scrape-listing' } satisfies ContentScriptMessage);
  if (!response?.ok || !Array.isArray(response.articles)) throw new Error('Listing scrape failed');
  return response.articles;
}

async function scrapePost(tabId: number): Promise<string> {
  const response = await browser.tabs.sendMessage(tabId, { action: 'scrape-post' } satisfies ContentScriptMessage);
  if (!response?.ok || typeof response.content !== 'string') throw new Error('Post scrape failed');
  return response.content;
}

async function runScrape(apiUrl: string, adminKey: string) {
  let tabId: number | undefined;

  try {
    const sources = await getRedditSources(apiUrl, adminKey);
    updateStatus({ sourcesTotal: sources.length });
    log('info', `Loaded ${sources.length} Reddit sources`);

    if (sources.length === 0) {
      updateStatus({ running: false, phase: 'done', completedAt: new Date().toISOString() });
      return;
    }

    const tab = await browser.tabs.create({ url: 'about:blank', active: true });
    if (tab.id === undefined) throw new Error('Failed to create scraping tab');
    tabId = tab.id;

    for (const source of sources) {
      if (cancelRequested) break;

      updateStatus({ phase: 'listing', currentSource: source.name, contentIndex: 0, contentTotal: 0 });
      log('info', `Listing ${source.name}`);

      try {
        await navigate(tabId, sourceToOldRedditHot(source.url));
        const articles = await scrapeListing(tabId);
        updateStatus({ listingsFound: status.listingsFound + articles.length });

        const listingResult = await pushListing(apiUrl, adminKey, { source_id: source.id, articles });
        updateStatus({ inserted: status.inserted + listingResult.inserted.length, contentTotal: listingResult.inserted.length });
        log('success', `${source.name}: ${articles.length} found, ${listingResult.inserted.length} need content`);

        for (let i = 0; i < listingResult.inserted.length; i++) {
          if (cancelRequested) break;

          const article = listingResult.inserted[i];
          updateStatus({ phase: 'content', contentIndex: i + 1, contentTotal: listingResult.inserted.length });

          try {
            await navigate(tabId, postToOldReddit(article.url));
            const content = await scrapePost(tabId);
            if (!content.trim()) throw new Error('No post content extracted');

            const contentResult = await pushContent(apiUrl, adminKey, {
              items: [{ article_id: article.articleId, content }],
            });
            updateStatus({ enqueued: status.enqueued + contentResult.enqueued });
            log('success', `Pushed content ${i + 1}/${listingResult.inserted.length}`);
          } catch (error) {
            updateStatus({ errors: status.errors + 1 });
            log('error', `Post failed: ${error instanceof Error ? error.message : String(error)}`);
          }

          if (i < listingResult.inserted.length - 1) await sleep(randomDelay());
        }
      } catch (error) {
        updateStatus({ errors: status.errors + 1 });
        log('error', `${source.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      updateStatus({ sourcesDone: status.sourcesDone + 1 });
    }

    updateStatus({
      running: false,
      phase: cancelRequested ? 'cancelled' : 'done',
      completedAt: new Date().toISOString(),
    });
    log(cancelRequested ? 'error' : 'success', cancelRequested ? 'Scrape cancelled' : 'Scrape complete');
  } catch (error) {
    updateStatus({ running: false, phase: 'error', errors: status.errors + 1, completedAt: new Date().toISOString() });
    log('error', error instanceof Error ? error.message : String(error));
  } finally {
    activeRun = null;
    cancelRequested = false;
    if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => undefined);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: PopupMessage) => {
    if (message?.action === 'get-status') return Promise.resolve({ ok: true, status });

    if (message?.action === 'cancel-scrape') {
      cancelRequested = true;
      log('info', 'Cancellation requested');
      return Promise.resolve({ ok: true, status });
    }

    if (message?.action === 'start-scrape') {
      if (activeRun) return Promise.resolve({ ok: false, error: 'Scrape already running', status });
      if (!message.apiUrl.trim()) return Promise.resolve({ ok: false, error: 'API URL is required', status });
      if (!message.adminKey.trim()) return Promise.resolve({ ok: false, error: 'Admin key is required', status });

      status = {
        ...INITIAL_STATUS,
        running: true,
        phase: 'listing',
        startedAt: new Date().toISOString(),
        log: [],
      };
      cancelRequested = false;
      log('info', 'Starting Reddit scrape');
      activeRun = runScrape(message.apiUrl, message.adminKey);
      return Promise.resolve({ ok: true, status });
    }

    return undefined;
  });
});
