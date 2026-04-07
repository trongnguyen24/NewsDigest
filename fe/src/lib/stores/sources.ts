import { writable } from 'svelte/store';
import type { Source } from '$lib/types';

const STORAGE_KEY = 'nd_sources';

function loadFromStorage(): Source[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Source[];
  } catch {
    return [];
  }
}

function saveToStorage(data: Source[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore quota errors */ }
}

// Initialize from localStorage so offline access works immediately
const initial = typeof window !== 'undefined' ? loadFromStorage() : [];
export const sources = writable<Source[]>(initial);

// Persist whenever the store updates
if (typeof window !== 'undefined') {
  sources.subscribe((value) => {
    if (value.length > 0) {
      saveToStorage(value);
    }
  });
}
