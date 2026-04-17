/**
 * IndexedDB cache layer for NewsDigest.
 *
 * Database: 'newsdigest-cache', version 1
 * Object stores:
 *   'articles' — keyPath: 'date', value: CachedDayData
 *   'digests'  — keyPath: 'date', value: StoredDigest
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Article, Digest } from '$lib/types';

// ── Types ─────────────────────────────────────────────

export interface CachedDayData {
  date: string;        // YYYY-MM-DD (keyPath)
  articles: Article[];
  total: number;
  fullyLoaded: boolean;
  timestamp: number;
}

interface StoredDigest {
  date: string;        // keyPath
  digest: Digest | null;
}

interface NewsDigestDB extends DBSchema {
  articles: {
    key: string;
    value: CachedDayData;
  };
  digests: {
    key: string;
    value: StoredDigest;
  };
}

// ── DB singleton ──────────────────────────────────────

const DB_NAME = 'newsdigest-cache';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<NewsDigestDB>> | null = null;

function getDb(): Promise<IDBPDatabase<NewsDigestDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NewsDigestDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('articles')) {
          db.createObjectStore('articles', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('digests')) {
          db.createObjectStore('digests', { keyPath: 'date' });
        }
      },
    });
  }
  return dbPromise;
}

// ── Article helpers ───────────────────────────────────

export async function getArticles(date: string): Promise<CachedDayData | undefined> {
  try {
    const db = await getDb();
    return await db.get('articles', date);
  } catch (e) {
    console.warn('[cacheDb] getArticles failed', e);
    return undefined;
  }
}

export async function saveArticles(date: string, data: Omit<CachedDayData, 'date'>): Promise<void> {
  try {
    const db = await getDb();
    await db.put('articles', { date, ...data });
  } catch (e) {
    console.warn('[cacheDb] saveArticles failed', e);
  }
}

// ── Digest helpers ────────────────────────────────────

export async function getDigest(date: string): Promise<Digest | null | undefined> {
  try {
    const db = await getDb();
    const row = await db.get('digests', date);
    return row?.digest;           // undefined if no row, null if stored as null
  } catch (e) {
    console.warn('[cacheDb] getDigest failed', e);
    return undefined;
  }
}

export async function saveDigest(date: string, digest: Digest | null): Promise<void> {
  try {
    if (digest === undefined) return;
    const db = await getDb();
    await db.put('digests', { date, digest });
  } catch (e) {
    console.warn('[cacheDb] saveDigest failed', e);
  }
}

// ── Cleanup ───────────────────────────────────────────

export async function cleanup(maxDays: number): Promise<void> {
  try {
    const db = await getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const tx = db.transaction(['articles', 'digests'], 'readwrite');
    const [articleKeys, digestKeys] = await Promise.all([
      tx.objectStore('articles').getAllKeys(),
      tx.objectStore('digests').getAllKeys(),
    ]);

    const deletes: Promise<void>[] = [];
    for (const key of articleKeys) {
      if (key < cutoffStr) deletes.push(tx.objectStore('articles').delete(key));
    }
    for (const key of digestKeys) {
      if (key < cutoffStr) deletes.push(tx.objectStore('digests').delete(key));
    }
    await Promise.all(deletes);
    await tx.done;
  } catch (e) {
    console.warn('[cacheDb] cleanup failed', e);
  }
}

// ── One-time migration from localStorage ─────────────

const MIGRATION_FLAG = 'nd_idb_migrated';
const LS_CACHE_PREFIX = 'nd_cache_';
const LS_DIGEST_PREFIX = 'nd_digest_';

export async function migrateFromLocalStorage(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;  // already done

    const db = await getDb();
    const tx = db.transaction(['articles', 'digests'], 'readwrite');
    const writes: Promise<unknown>[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith(LS_CACHE_PREFIX)) {
        const date = key.slice(LS_CACHE_PREFIX.length);
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw) as Omit<CachedDayData, 'date'>;
            writes.push(tx.objectStore('articles').put({ date, ...parsed }));
          }
        } catch { /* skip malformed */ }
      } else if (key.startsWith(LS_DIGEST_PREFIX)) {
        const date = key.slice(LS_DIGEST_PREFIX.length);
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const digest = JSON.parse(raw) as Digest;
            writes.push(tx.objectStore('digests').put({ date, digest }));
          }
        } catch { /* skip malformed */ }
      }
    }

    await Promise.all(writes);
    await tx.done;

    // Remove old localStorage keys
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_CACHE_PREFIX) || key?.startsWith(LS_DIGEST_PREFIX)) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);

    localStorage.setItem(MIGRATION_FLAG, '1');
    console.log('[cacheDb] Migrated from localStorage to IndexedDB');
  } catch (e) {
    console.warn('[cacheDb] Migration failed (non-fatal)', e);
  }
}
