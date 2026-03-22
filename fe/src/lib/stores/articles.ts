import { writable } from 'svelte/store';
import type { Article } from '$lib/types';

export const articles = writable<Article[]>([]);
export const isLoading = writable(false);
export const filters = writable({ tag: '', minHot: 0, sourceId: '', sort: 'date' });
