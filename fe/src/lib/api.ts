/**
 * API configuration.
 * In dev mode, Vite proxy handles /api → localhost:8787.
 * In production, calls go directly to the Worker URL.
 */
const DEV_API = '';
const PROD_API = 'https://newsdigest.trongnguyenchromeos.workers.dev';

export const API_BASE = import.meta.env.DEV ? DEV_API : PROD_API;

export function api(path: string): string {
  return `${API_BASE}${path}`;
}
