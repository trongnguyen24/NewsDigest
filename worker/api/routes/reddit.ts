import { Hono } from 'hono';
import { ArticleRepo, SourceRepo } from '../../db';
import { SCRAPER_SETTINGS } from '../../settings';
import { ContentScrapeMessage, Env } from '../../types';
import { requireAdmin } from '../utils';

const reddit = new Hono<{ Bindings: Env }>();

interface PushListingArticle {
  url: string;
  title: string;
  score?: number;
  num_comments?: number;
  selftext_preview?: string;
}

interface PushContentItem {
  article_id: string;
  content: string;
}

function canonicalizeRedditUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.hostname === 'old.reddit.com' || url.hostname === 'reddit.com') {
    url.hostname = 'www.reddit.com';
  }
  url.hash = '';
  return url.toString();
}

function subredditFromUrl(rawUrl: string, fallback = 'reddit'): string {
  try {
    const match = new URL(rawUrl).pathname.match(/\/r\/([^/]+)/i);
    return match?.[1] || fallback;
  } catch {
    return fallback;
  }
}

function buildDescription(article: PushListingArticle, sourceName: string): string {
  const score = Number.isFinite(article.score) ? Math.max(0, Number(article.score)) : 0;
  const comments = Number.isFinite(article.num_comments) ? Math.max(0, Number(article.num_comments)) : 0;
  const subreddit = subredditFromUrl(article.url, sourceName.replace(/^r\//i, '') || 'reddit');
  const date = new Date().toISOString().slice(0, 10);
  const preview = (article.selftext_preview || '').trim();
  const stats = `⬆${score} 💬${comments} r/${subreddit} 📅${date}`;
  return preview ? `${stats}\n\n${preview}` : stats;
}

async function enqueueMessages(env: Env, messages: ContentScrapeMessage[]): Promise<number> {
  let enqueued = 0;
  const batchSize = SCRAPER_SETTINGS.queue.normalSendBatchSize;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    await env.CONTENT_QUEUE.sendBatch(batch.map((body) => ({ body })));
    enqueued += batch.length;
  }

  return enqueued;
}

// POST /api/reddit/push-listing
reddit.post('/push-listing', async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const body = await c.req.json().catch(() => null) as { source_id?: string; articles?: PushListingArticle[] } | null;
  if (!body?.source_id || typeof body.source_id !== 'string') {
    return c.json({ error: 'source_id is required' }, 400);
  }
  if (!Array.isArray(body.articles)) {
    return c.json({ error: 'articles must be an array' }, 400);
  }

  const source = await SourceRepo.findById(c.env.DB, body.source_id);
  if (!source) return c.json({ error: 'Source not found' }, 404);
  if (source.type !== 'reddit') return c.json({ error: 'Source is not reddit' }, 400);

  const inserted: { articleId: string; url: string }[] = [];
  let updated = 0;
  let skipped = 0;

  for (const article of body.articles) {
    if (!article || typeof article.url !== 'string' || typeof article.title !== 'string') {
      skipped++;
      continue;
    }

    const title = article.title.trim();
    if (!title) {
      skipped++;
      continue;
    }

    let url: string;
    try {
      url = canonicalizeRedditUrl(article.url);
    } catch {
      skipped++;
      continue;
    }

    const publishedAt = new Date().toISOString();
    const description = buildDescription({ ...article, url }, source.name);
    const existing = await ArticleRepo.findBySourceAndUrl(c.env.DB, source.id, url);

    if (existing) {
      updated++;
      await ArticleRepo.updateDescription(c.env.DB, existing.id, description);

      const daysSince = (Date.now() - new Date(existing.published_at).getTime()) / 86_400_000;
      if (daysSince >= SCRAPER_SETTINGS.reddit.reprocessAfterDays) {
        await ArticleRepo.resetForReprocessing(c.env.DB, existing.id, publishedAt);
        inserted.push({ articleId: existing.id, url });
      } else {
        skipped++;
      }
      continue;
    }

    const id = crypto.randomUUID();
    await ArticleRepo.insert(c.env.DB, {
      id,
      source_id: source.id,
      url,
      title,
      description,
      published_at: publishedAt,
    });
    inserted.push({ articleId: id, url });
  }

  const lastFetchedAt = await SourceRepo.updateLastFetched(c.env.DB, source.id);
  return c.json({ ok: true, inserted, updated, skipped, last_fetched_at: lastFetchedAt });
});

// POST /api/reddit/push-content
reddit.post('/push-content', async (c) => {
  const authErr = requireAdmin(c);
  if (authErr) return authErr;

  const body = await c.req.json().catch(() => null) as { items?: PushContentItem[] } | null;
  if (!Array.isArray(body?.items)) {
    return c.json({ error: 'items must be an array' }, 400);
  }

  const queueMessages: ContentScrapeMessage[] = [];
  let received = 0;

  for (const item of body.items) {
    if (!item || typeof item.article_id !== 'string' || typeof item.content !== 'string') continue;

    const content = item.content.trim();
    if (!content) continue;

    const article = await ArticleRepo.findById(c.env.DB, item.article_id);
    if (!article) continue;

    await ArticleRepo.updateContent(c.env.DB, article.id, content.slice(0, SCRAPER_SETTINGS.reddit.contentMaxChars));
    queueMessages.push({ articleId: article.id, url: article.url, title: article.title });
    received++;
  }

  const enqueued = await enqueueMessages(c.env, queueMessages);
  return c.json({ ok: true, received, enqueued });
});

export default reddit;
