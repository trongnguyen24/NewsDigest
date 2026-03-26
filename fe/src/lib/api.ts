/**
 * API base URL — always points to the deployed Cloudflare Worker.
 * Override with VITE_API_URL env var if needed.
 */
const PROD_API = 'https://newsdigest.trongnguyenchromeos.workers.dev';

export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? PROD_API;

export function api(path: string): string {
  return `${API_BASE}${path}`;
}
