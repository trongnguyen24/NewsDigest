/**
 * API base URL — points to the deployed Cloudflare Worker.
 * 
 * Production: VITE_API_URL is injected at build time by deploy script.
 * Local dev:  reads from fe/.env.local, or falls back to localhost:8787.
 */
export const API_BASE: string =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '');

export function api(path: string): string {
  return `${API_BASE}${path}`;
}
