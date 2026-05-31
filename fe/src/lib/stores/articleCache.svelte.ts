/**
 * Article Cache Store
 *
 * Strategy:
 * 1. First visit: _initializing=true (blank, no skeleton) → check IndexedDB → no cache
 *    → _loading=true (skeleton) → fetch 20 articles → display → background-load rest
 * 2. Return visit: _initializing=true → check IndexedDB → cache found → display instantly
 *    → _initializing=false → background refresh if needed
 * 3. Same-session nav: memory cache hit → instant, no async at all
 * 4. Cleanup: keep max 14 days in IndexedDB
 */
import { api } from '$lib/api';
import type { Article, Digest } from '$lib/types';
import * as cacheDb from './cacheDb';
import type { CachedDayData } from './cacheDb';

// ── Eager IDB preload ────────────────────────────────
// Start reading today's cached articles from IDB immediately when this module
// is first imported — well before $effect fires and loadDate() is called.
// By the time the component mounts and calls loadDate(), this promise is
// typically already resolved, so the IDB check is instant (no await latency).
type EagerPreload = { date: string; promise: Promise<[CachedDayData | undefined, Digest | null | undefined]> };
let _eagerPreload: EagerPreload | null = null;
if (typeof window !== 'undefined') {
  const today = getTodayStr();
  _eagerPreload = { date: today, promise: Promise.all([cacheDb.getArticles(today), cacheDb.getDigest(today)]) };
}

const MAX_CACHED_DAYS = 14;
const INITIAL_BATCH = 40;
const REFRESH_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

// ── In-memory cache (L1: instant, within a session) ──
const memoryCache = new Map<string, CachedDayData>();
const digestCache = new Map<string, Digest | null>();

// ── Reactive state exposed to components ──────────────
let _articles = $state<Article[]>([]);
let _digest = $state<Digest | null>(null);
/**
 * True only when doing a full network fetch with no cache available.
 * Drives the skeleton loading UI.
 */
let _loading = $state(false);
/**
 * True from the moment loadDate() is called until the IndexedDB check
 * (or memory check) completes. During this window we show nothing (blank),
 * which avoids skeleton flash when cache will be found.
 */
let _initializing = $state(true);
let _refreshing = $state(false);
let _loadingMore = $state(false);
let _currentDate = $state('');
let _unsummarizedCount = $derived(_articles.filter((a) => !a.summary).length);

/** Get today's date string in YYYY-MM-DD format (local time). */
function getTodayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ── API fetch helpers ─────────────────────────────────

function buildDateRange(date: string) {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: dayStart.toISOString(),
    to: dayEnd.toISOString(),
  };
}

/** Thrown when the SW returns an offline stub instead of real data. */
class OfflineError extends Error {
  constructor() { super('offline'); }
}

async function fetchArticlesPage(
  date: string,
  page: number,
  limit: number,
): Promise<{ articles: Article[]; total: number; nextPage: number | null }> {
  const { from, to } = buildDateRange(date);
  const res = await fetch(
    api(
      `/api/articles?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${limit}&page=${page}&sort=date`,
    ),
  );
  const data = await res.json();
  // SW offline stub: { offline: true }
  if (data.offline) throw new OfflineError();
  return {
    articles: (data.articles ?? []) as Article[],
    total: data.total ?? 0,
    nextPage: data.nextPage ?? null,
  };
}

async function fetchDigest(date: string): Promise<Digest | null> {
  const res = await fetch(api(`/api/digest?date=${date}`));
  const data = await res.json();
  if (data.offline) throw new OfflineError();
  return (data.digest ?? null) as Digest | null;
}

// ── Merge logic ───────────────────────────────────────

/**
 * Merge newly fetched articles into existing cache.
 * New articles (by ID) are prepended; existing ones are updated in-place.
 * Returns { merged, hasOverlap } where hasOverlap = at least one fetched article
 * already existed in cache (meaning we've caught up).
 */
function mergeArticles(
  existing: Article[],
  fetched: Article[],
): { merged: Article[]; hasOverlap: boolean; newCount: number } {
  const existingIds = new Set(existing.map((a) => a.id));
  const newArticles: Article[] = [];
  let hasOverlap = false;

  for (const article of fetched) {
    if (existingIds.has(article.id)) {
      hasOverlap = true;
      // Update existing article data in case it changed (e.g. summary was added)
      const idx = existing.findIndex((a) => a.id === article.id);
      if (idx >= 0) existing[idx] = article;
    } else {
      newArticles.push(article);
    }
  }

  const merged = [...newArticles, ...existing];
  merged.sort((a, b) => {
    const da = a.published_at || a.fetched_at;
    const db = b.published_at || b.fetched_at;
    return new Date(db).getTime() - new Date(da).getTime();
  });

  return { merged, hasOverlap, newCount: newArticles.length };
}

// ── Main public functions ─────────────────────────────

// Guard: track the last loadDate call to prevent concurrent duplicate loads
let _loadCallId = 0;

/**
 * Load articles for a given date.
 *
 * Flow:
 * 1. Memory cache hit → instant display, no loading states
 * 2. IndexedDB cache hit → fast async read, display without skeleton
 * 3. No cache → skeleton → network fetch
 *
 * In all cases, a background refresh runs for "today" (throttled to 5min)
 * and for past dates that were cached the same day (may be incomplete).
 */
async function loadDate(date: string) {
  const callId = ++_loadCallId;
  _currentDate = date;
  _initializing = true;
  const isToday = date === getTodayStr();

  /**
   * True if the cache was created on the same day as the article date
   * (meaning it was cached while still "today" and may be incomplete).
   */
  function needsFinalization(date: string, timestamp: number): boolean {
    const cacheDay = new Date(timestamp).toISOString().slice(0, 10);
    return cacheDay === date;
  }

  // 1. Memory cache (synchronous — no state change needed)
  const memCached = memoryCache.get(date);
  if (memCached) {
    _articles = memCached.articles;
    _digest = digestCache.get(date) ?? null;
    _loading = false;
    _initializing = false;

    if (isToday && Date.now() - memCached.timestamp > REFRESH_THROTTLE_MS) {
      backgroundRefresh(date, memCached);
    } else if (!isToday && needsFinalization(date, memCached.timestamp)) {
      backgroundRefresh(date, memCached);
    }
    return;
  }

  // 2. IndexedDB cache — reuse the eager preload promise if it matches this date
  // (avoids a redundant IDB roundtrip since we started reading at module load time)
  const idbPromise = (_eagerPreload && _eagerPreload.date === date)
    ? _eagerPreload.promise
    : Promise.all([cacheDb.getArticles(date), cacheDb.getDigest(date)]);
  _eagerPreload = null; // consume it — preload is one-shot

  const [storageCached, cachedDigest] = await idbPromise;

  if (_loadCallId !== callId) return; // superseded by newer call

  if (storageCached && storageCached.articles.length > 0) {
    _articles = storageCached.articles;
    _digest = cachedDigest ?? null;
    _loading = false;
    _initializing = false;

    // Populate memory cache
    memoryCache.set(date, storageCached);
    digestCache.set(date, cachedDigest ?? null);

    if (isToday && Date.now() - storageCached.timestamp > REFRESH_THROTTLE_MS) {
      backgroundRefresh(date, storageCached);
    } else if (!isToday && needsFinalization(date, storageCached.timestamp)) {
      backgroundRefresh(date, storageCached);
    }
    return;
  }

  // 3. No cache — full network load, show skeleton
  _loading = true;
  _initializing = false;
  _articles = [];
  _digest = null;

  try {
    const [articlesResult, digestResult] = await Promise.all([
      fetchArticlesPage(date, 1, INITIAL_BATCH),
      fetchDigest(date),
    ]);

    if (_loadCallId !== callId) return;

    const sortedArticles = [...articlesResult.articles].sort((a, b) => {
      const da = a.published_at || a.fetched_at;
      const db = b.published_at || b.fetched_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    _articles = sortedArticles;
    _digest = digestResult;

    const cacheData: CachedDayData = {
      date,
      articles: sortedArticles,
      total: articlesResult.total,
      fullyLoaded: articlesResult.nextPage === null,
      timestamp: Date.now(),
    };
    memoryCache.set(date, cacheData);
    digestCache.set(date, digestResult);

    _loading = false;

    if (articlesResult.nextPage !== null) {
      backgroundLoadRemaining(date, cacheData);
    } else {
      await cacheDb.saveArticles(date, cacheData);
      await cacheDb.saveDigest(date, digestResult);
    }
  } catch (e) {
    if (_loadCallId !== callId) return;
    if (e instanceof OfflineError) {
      // Offline with no local cache for this date — show empty state
      console.info('[articleCache] Offline, no cache for', date);
    } else {
      console.error('Failed to fetch articles', e);
    }
    _articles = [];
    _digest = null;
    _loading = false;
  }
}

/**
 * Background load all articles (limit=200 covers any day's volume).
 */
async function backgroundLoadRemaining(
  date: string,
  cacheData: CachedDayData,
) {
  _loadingMore = true;

  try {
    if (_currentDate !== date) return;

    const result = await fetchArticlesPage(date, 1, 200);
    if (_currentDate !== date) return;

    const seen = new Set<string>();
    const deduped = result.articles.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    deduped.sort((a, b) => {
      const da = a.published_at || a.fetched_at;
      const db = b.published_at || b.fetched_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    cacheData.articles = deduped;
    cacheData.total = result.total;
    cacheData.fullyLoaded = true;
    _articles = deduped;

    cacheData.timestamp = Date.now();
    memoryCache.set(date, cacheData);
    await cacheDb.saveArticles(date, cacheData);
    await cacheDb.saveDigest(date, digestCache.get(date) ?? null);
  } catch (e) {
    console.error('Background load failed', e);
  } finally {
    if (_currentDate === date) {
      _loadingMore = false;
    }
  }
}

/**
 * Background refresh: fetch latest INITIAL_BATCH articles and merge with cache.
 * Also refreshes digest.
 */
async function backgroundRefresh(date: string, cacheData: CachedDayData) {
  _refreshing = true;

  try {
    const [articlesResult, digestResult] = await Promise.all([
      fetchArticlesPage(date, 1, INITIAL_BATCH),
      fetchDigest(date),
    ]);

    if (_currentDate !== date) return;

    _digest = digestResult;
    digestCache.set(date, digestResult);

    const { merged, newCount } = mergeArticles(
      [...cacheData.articles],
      articlesResult.articles,
    );

    cacheData.articles = merged;
    cacheData.total = articlesResult.total;
    cacheData.timestamp = Date.now();

    _articles = merged;
    memoryCache.set(date, cacheData);

    if (merged.length < articlesResult.total && !cacheData.fullyLoaded) {
      await backgroundLoadRemaining(date, cacheData);
    } else {
      cacheData.fullyLoaded = merged.length >= articlesResult.total;
      await cacheDb.saveArticles(date, cacheData);
      await cacheDb.saveDigest(date, digestResult);
    }

    if (newCount > 0) {
      console.log(`📰 ${newCount} bài mới được cập nhật`);
    }
  } catch (e) {
    if (e instanceof OfflineError) {
      // Silently skip — cached data is already displayed, nothing to update
      console.info('[articleCache] Offline, skipping background refresh');
    } else {
      console.error('Background refresh failed', e);
    }
  } finally {
    if (_currentDate === date) {
      _refreshing = false;
    }
  }
}

/**
 * Force refresh: attempt to reload from network without losing cached data.
 * If data is currently displayed, uses backgroundRefresh to avoid skeleton flash.
 * Caches are preserved until new data is successfully fetched — this prevents
 * data loss when offline (the old code wiped caches before fetching, so an
 * offline failure left both memory and IDB empty).
 */
async function forceRefresh(date: string) {
  if (_articles.length > 0 && _currentDate === date) {
    // Keep current articles in memory cache with timestamp=0 (forces re-fetch)
    // so offline navigation still has data to fall back on.
    // DO NOT wipe IDB — it serves as fallback for cold restarts.
    const tempCache: CachedDayData = {
      date,
      articles: [..._articles],
      total: _articles.length,
      fullyLoaded: false,
      timestamp: 0,
    };
    memoryCache.set(date, tempCache);
    // backgroundRefresh will update memory + IDB on success, or no-op on failure
    await backgroundRefresh(date, tempCache);
  } else {
    memoryCache.delete(date);
    digestCache.delete(date);
    if (_currentDate === date) {
      await loadDate(date);
    } else {
      await cacheDb.saveDigest(date, null);
      const idbCached = await cacheDb.getArticles(date);
      if (idbCached) {
        await cacheDb.saveArticles(date, {
          ...idbCached,
          timestamp: 0,
        });
      }
    }
  }
}

async function invalidateCache(date: string) {
  memoryCache.delete(date);
  digestCache.delete(date);
  await cacheDb.saveDigest(date, null);
  const idbCached = await cacheDb.getArticles(date);
  if (idbCached) {
    await cacheDb.saveArticles(date, {
      ...idbCached,
      timestamp: 0,
    });
  }
}

// ── Initialization (browser only) ────────────────────

if (typeof window !== 'undefined') {
  // Run migration + cleanup async without blocking anything
  cacheDb.migrateFromLocalStorage().catch(console.warn);
  cacheDb.cleanup(MAX_CACHED_DAYS).catch(console.warn);
}

// ── Exports ───────────────────────────────────────────

export const articleCache = {
  get articles() { return _articles; },
  get digest() { return _digest; },
  get loading() { return _loading; },
  get initializing() { return _initializing; },
  get refreshing() { return _refreshing; },
  get loadingMore() { return _loadingMore; },
  get currentDate() { return _currentDate; },
  get unsummarizedCount() { return _unsummarizedCount; },
  loadDate,
  forceRefresh,
  invalidateCache,
};
