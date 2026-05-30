import type { ListingArticle, PushContentResponse, PushListingResponse, RedditSource } from './types';

function cleanApiUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/, '');
}

function headers(adminKey: string): HeadersInit {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  if (adminKey.trim()) result['X-Admin-Key'] = adminKey.trim();
  return result;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.error || data?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function getRedditSources(apiUrl: string, adminKey = ''): Promise<RedditSource[]> {
  const res = await fetch(`${cleanApiUrl(apiUrl)}/api/sources`, {
    headers: adminKey.trim() ? { 'X-Admin-Key': adminKey.trim() } : undefined,
  });
  const data = await readJson<{ sources?: RedditSource[] }>(res);
  return (data.sources || []).filter((source) => source.type === 'reddit' && Number(source.enabled) === 1);
}

export async function pushListing(
  apiUrl: string,
  adminKey: string,
  payload: { source_id: string; articles: ListingArticle[] },
): Promise<PushListingResponse> {
  const res = await fetch(`${cleanApiUrl(apiUrl)}/api/reddit/push-listing`, {
    method: 'POST',
    headers: headers(adminKey),
    body: JSON.stringify(payload),
  });
  return readJson<PushListingResponse>(res);
}

export async function pushContent(
  apiUrl: string,
  adminKey: string,
  payload: { items: { article_id: string; content: string }[] },
): Promise<PushContentResponse> {
  const res = await fetch(`${cleanApiUrl(apiUrl)}/api/reddit/push-content`, {
    method: 'POST',
    headers: headers(adminKey),
    body: JSON.stringify(payload),
  });
  return readJson<PushContentResponse>(res);
}
