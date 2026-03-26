import { api } from '$lib/api';
import type { Article } from '$lib/types';

// Override layout's prerender — this page is dynamic (date-based)
export const prerender = false;

export async function load({ fetch, url }) {
  // Read date from URL or default to today (local timezone)
  const dateParam = url.searchParams.get('date');
  const now = new Date();
  const localDate = dateParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Compute UTC range for the local date
  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const from = dayStart.toISOString();
  const to = dayEnd.toISOString();

  try {
    const res = await fetch(api(`/api/articles?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200&sort=date`));
    const data = await res.json();
    return { articles: (data.articles ?? []) as Article[], error: false, currentDate: localDate };
  } catch (e) {
    console.error('Failed to fetch articles', e);
    return { articles: [] as Article[], error: true, currentDate: localDate };
  }
}
