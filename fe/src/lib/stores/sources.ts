import { writable } from 'svelte/store';
import type { Source } from '$lib/types';

export const sources = writable<Source[]>([]);
