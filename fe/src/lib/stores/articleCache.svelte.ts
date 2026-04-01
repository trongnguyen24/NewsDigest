/**
 * Article Cache Store
 * 
 * Strategy:
 * 1. First visit: load 20 articles → display → background-load 50/batch until all loaded
 * 2. Cache everything (including today) in localStorage
 * 3. Return visit: show cached data instantly → fetch 20 latest →
 *    compare IDs, prepend new articles → if overlap found, stop
 * 4. Cleanup: keep max 14 days in localStorage
 */
import { api } from '$lib/api';
import type { Article, Digest } from '$lib/types';

const CACHE_PREFIX = 'nd_cache_';
const DIGEST_PREFIX = 'nd_digest_';
const MAX_CACHED_DAYS = 14;
const INITIAL_BATCH = 40;
const REFRESH_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

interface CachedDayData {
  articles: Article[];
  total: number;       // total count from server
  fullyLoaded: boolean; // true if all pages have been fetched
  timestamp: number;   // when this cache was last updated
}

// ── In-memory cache ──────────────────────────────────
const memoryCache = new Map<string, CachedDayData>();
const digestCache = new Map<string, Digest | null>();

// ── Reactive state exposed to components ─────────────
let _articles = $state<Article[]>([]);
let _digest = $state<Digest | null>(null);
let _loading = $state(false);      // initial full-page load
let _refreshing = $state(false);   // background sync for new articles
let _loadingMore = $state(false);  // background loading remaining batches
let _currentDate = $state('');
let _unsummarizedCount = $derived(_articles.filter((a) => !a.summary).length);

/** Get today's date string in YYYY-MM-DD format (local time). */
function getTodayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ── localStorage helpers ─────────────────────────────

function saveToStorage(date: string, data: CachedDayData) {
  try {
    localStorage.setItem(CACHE_PREFIX + date, JSON.stringify(data));
  } catch {
    // localStorage full — clean old entries
    cleanupStorage();
    try {
      localStorage.setItem(CACHE_PREFIX + date, JSON.stringify(data));
    } catch { /* give up */ }
  }
}

function loadFromStorage(date: string): CachedDayData | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (!raw) return null;
    return JSON.parse(raw) as CachedDayData;
  } catch {
    return null;
  }
}

function saveDigestToStorage(date: string, digest: Digest | null) {
  try {
    if (digest) {
      localStorage.setItem(DIGEST_PREFIX + date, JSON.stringify(digest));
    }
  } catch { /* ignore */ }
}

function loadDigestFromStorage(date: string): Digest | null {
  try {
    const raw = localStorage.getItem(DIGEST_PREFIX + date);
    if (!raw) return null;
    return JSON.parse(raw) as Digest | null;
  } catch {
    return null;
  }
}

function cleanupStorage() {
  const keys: { key: string; date: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      keys.push({ key, date: key.replace(CACHE_PREFIX, '') });
    } else if (key?.startsWith(DIGEST_PREFIX)) {
      keys.push({ key, date: key.replace(DIGEST_PREFIX, '') });
    }
  }
  // Sort by date ascending, remove oldest beyond MAX_CACHED_DAYS
  keys.sort((a, b) => a.date.localeCompare(b.date));
  // Each day has 2 entries (articles + digest), so we keep MAX_CACHED_DAYS * 2
  const toRemove = keys.slice(0, Math.max(0, keys.length - MAX_CACHED_DAYS * 2));
  for (const { key } of toRemove) {
    localStorage.removeItem(key);
  }
}

// ── API fetch helpers ────────────────────────────────

function buildDateRange(date: string) {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: dayStart.toISOString(),
    to: dayEnd.toISOString(),
  };
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
  return {
    articles: (data.articles ?? []) as Article[],
    total: data.total ?? 0,
    nextPage: data.nextPage ?? null,
  };
}

async function fetchDigest(date: string): Promise<Digest | null> {
  const res = await fetch(api(`/api/digest?date=${date}`));
  const data = await res.json();
  return (data.digest ?? null) as Digest | null;
}

// ── Merge logic ──────────────────────────────────────

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

  // Prepend new articles, keep existing ones, sort all by published_at DESC
  const merged = [...newArticles, ...existing];
  merged.sort((a, b) => {
    const da = a.published_at || a.fetched_at;
    const db = b.published_at || b.fetched_at;
    return new Date(db).getTime() - new Date(da).getTime();
  });

  return { merged, hasOverlap, newCount: newArticles.length };
}

// ── Main public functions ────────────────────────────

/**
 * Load articles for a given date.
 * 
 * Flow:
 * - If memory cache exists → show immediately
 * - Else if localStorage cache exists → show immediately
 * - Else → show loading, fetch 20 articles
 * - Then background-load remaining batches (50/batch)
 * - If this is "today" or if it's a return visit, also do a refresh check
 */
async function loadDate(date: string) {
  _currentDate = date;
  const isToday = date === getTodayStr();

  /**
   * Check if a past date's cache needs one final refresh.
   * True if the cache was created on the same day as the article date
   * (meaning it was cached while still "today" and may be incomplete).
   */
  function needsFinalization(date: string, timestamp: number): boolean {
    const cacheDay = new Date(timestamp).toISOString().slice(0, 10);
    return cacheDay === date; // cached same day → might be incomplete
  }

  // 1. Check memory cache first
  const memCached = memoryCache.get(date);
  if (memCached) {
    _articles = memCached.articles;
    _loading = false;

    // Load digest from cache too
    _digest = digestCache.get(date) ?? loadDigestFromStorage(date);

    // Today: refresh with 5-min throttle
    // Past date with same-day cache: finalize once
    if (isToday && (Date.now() - memCached.timestamp > REFRESH_THROTTLE_MS)) {
      backgroundRefresh(date, memCached);
    } else if (!isToday && needsFinalization(date, memCached.timestamp)) {
      backgroundRefresh(date, memCached);
    }
    return;
  }

  // 2. Check localStorage cache
  const storageCached = loadFromStorage(date);
  if (storageCached && storageCached.articles.length > 0) {
    _articles = storageCached.articles;
    _loading = false;
    memoryCache.set(date, storageCached);

    // Load digest
    const cachedDigest = loadDigestFromStorage(date);
    _digest = cachedDigest;
    digestCache.set(date, cachedDigest);

    // Today: refresh with 5-min throttle
    // Past date with same-day cache: finalize once
    if (isToday && (Date.now() - storageCached.timestamp > REFRESH_THROTTLE_MS)) {
      backgroundRefresh(date, storageCached);
    } else if (!isToday && needsFinalization(date, storageCached.timestamp)) {
      backgroundRefresh(date, storageCached);
    }
    return;
  }

  // 3. No cache at all — full load
  _loading = true;
  _articles = [];
  _digest = null;

  try {
    // Fetch initial batch + digest in parallel
    const [articlesResult, digestResult] = await Promise.all([
      fetchArticlesPage(date, 1, INITIAL_BATCH),
      fetchDigest(date),
    ]);

    // Bail if user navigated away during fetch
    if (_currentDate !== date) return;

    // Sort by published_at DESC immediately to match backgroundLoadRemaining order
    // and prevent visible reorder when remaining articles load
    const sortedArticles = [...articlesResult.articles].sort((a, b) => {
      const da = a.published_at || a.fetched_at;
      const db = b.published_at || b.fetched_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    _articles = sortedArticles;
    _digest = digestResult;

    // Save to caches
    const cacheData: CachedDayData = {
      articles: sortedArticles,
      total: articlesResult.total,
      fullyLoaded: articlesResult.nextPage === null,
      timestamp: Date.now(),
    };
    memoryCache.set(date, cacheData);
    digestCache.set(date, digestResult);

    _loading = false;

    // Background-load remaining articles if there are more
    if (articlesResult.nextPage !== null) {
      backgroundLoadRemaining(date, cacheData);
    } else {
      // Fully loaded — persist
      saveToStorage(date, cacheData);
      saveDigestToStorage(date, digestResult);
    }
  } catch (e) {
    console.error('Failed to fetch articles', e);
    _articles = [];
    _digest = null;
    _loading = false;
  }
}

/**
 * Background load all articles (limit=200 covers any day's volume).
 * Fetches from page 1 with a large limit, deduplicates against existing cache.
 * Some overlap with the initial batch is expected and handled by deduplication.
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

    // Deduplicate by id
    const seen = new Set<string>();
    const deduped = result.articles.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    // Sort by time
    deduped.sort((a, b) => {
      const da = a.published_at || a.fetched_at;
      const db = b.published_at || b.fetched_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    cacheData.articles = deduped;
    cacheData.total = result.total;
    cacheData.fullyLoaded = true;
    _articles = deduped;

    // Persist to memory + localStorage
    cacheData.timestamp = Date.now();
    memoryCache.set(date, cacheData);
    saveToStorage(date, cacheData);
    saveDigestToStorage(date, digestCache.get(date) ?? null);
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
 * New articles are prepended; if all fetched articles overlap with cache,
 * we know we're caught up. Also refreshes digest.
 */
async function backgroundRefresh(date: string, cacheData: CachedDayData) {
  _refreshing = true;

  try {
    const [articlesResult, digestResult] = await Promise.all([
      fetchArticlesPage(date, 1, INITIAL_BATCH),
      fetchDigest(date),
    ]);

    if (_currentDate !== date) return;

    // Update digest
    _digest = digestResult;
    digestCache.set(date, digestResult);

    // Merge articles
    const { merged, newCount } = mergeArticles(
      [...cacheData.articles],
      articlesResult.articles,
    );

    cacheData.articles = merged;
    cacheData.total = articlesResult.total;
    cacheData.timestamp = Date.now();

    _articles = merged;
    memoryCache.set(date, cacheData);

    // If there are articles beyond what we've loaded, and our total count
    // shows more on server, load the rest
    if (merged.length < articlesResult.total && !cacheData.fullyLoaded) {
      await backgroundLoadRemaining(date, cacheData);
    } else {
      cacheData.fullyLoaded = merged.length >= articlesResult.total;
      saveToStorage(date, cacheData);
      saveDigestToStorage(date, digestResult);
    }

    if (newCount > 0) {
      console.log(`📰 ${newCount} bài mới được cập nhật`);
    }
  } catch (e) {
    console.error('Background refresh failed', e);
  } finally {
    if (_currentDate === date) {
      _refreshing = false;
    }
  }
}

/**
 * Force refresh: clear cache and reload.
 * If data is currently displayed, uses backgroundRefresh to avoid skeleton flash.
 */
async function forceRefresh(date: string) {
  memoryCache.delete(date);
  localStorage.removeItem(CACHE_PREFIX + date);
  localStorage.removeItem(DIGEST_PREFIX + date);

  // If currently displaying data for this date, use backgroundRefresh
  // to keep existing articles visible while fetching fresh data
  if (_articles.length > 0 && _currentDate === date) {
    const tempCache: CachedDayData = {
      articles: [..._articles],
      total: _articles.length,
      fullyLoaded: false,
      timestamp: 0,
    };
    await backgroundRefresh(date, tempCache);
  } else {
    await loadDate(date);
  }
}



// Run cleanup on module load (only in browser)
if (typeof window !== 'undefined') {
  cleanupStorage();
}

// ── Exports ──────────────────────────────────────────

export const articleCache = {
  get articles() { return _articles; },
  get digest() { return _digest; },
  get loading() { return _loading; },
  get refreshing() { return _refreshing; },
  get loadingMore() { return _loadingMore; },
  get currentDate() { return _currentDate; },
  get unsummarizedCount() { return _unsummarizedCount; },
  loadDate,
  forceRefresh,
};
