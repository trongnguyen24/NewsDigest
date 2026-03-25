import { Env, Source, ContentScrapeMessage } from '../types';
import { fetchSource } from './scraper';

const BATCH_SIZE = 3; // Fetch 3 sources song song

/**
 * Cron Worker — Fetch TẤT CẢ enabled sources mỗi lần chạy.
 * Chạy song song theo batch để tránh quá tải.
 * Sau khi insert, enqueue article URLs mới vào CONTENT_QUEUE để cào nội dung.
 */
export async function scheduled(event: ScheduledEvent | null, env: Env, ctx: ExecutionContext) {
  console.log(`Cron triggered at ${new Date().toISOString()}`);

  const { results: sources } = await env.DB.prepare(
    "SELECT * FROM sources WHERE enabled = 1 ORDER BY created_at"
  ).all<Source>();

  if (!sources || sources.length === 0) {
    console.log("No enabled sources found.");
    return;
  }

  console.log(`Fetching ${sources.length} sources in batches of ${BATCH_SIZE}...`);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalEnqueued = 0;
  let totalErrors = 0;
  let redditDelayCounter = 0;

  // Xử lý từng batch
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (source) => {
        const articles = await fetchSource(source, env);

        let insertedCount = 0;
        const newArticles: ContentScrapeMessage[] = [];

        for (const article of articles) {
          if (!article.title || !article.url) continue;

          const idValue = crypto.randomUUID();
          const publishedAt = article.published_at || new Date().toISOString();
          const description = article.description || null;

          const result = await env.DB.prepare(
            `INSERT OR IGNORE INTO articles (id, source_id, url, title, description, published_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(idValue, source.id, article.url, article.title, description, publishedAt).run();

          if (result.meta && result.meta.changes > 0) {
            insertedCount++;
            newArticles.push({ articleId: idValue, url: article.url, title: article.title });
          }
        }

        // Enqueue new articles for content scraping
        if (newArticles.length > 0) {
          const normalArticles = newArticles.filter(a => !a.url.includes('reddit.com'));
          const redditArticles = newArticles.filter(a => a.url.includes('reddit.com'));

          if (normalArticles.length > 0) {
            await env.CONTENT_QUEUE.sendBatch(
              normalArticles.map(a => ({ body: a }))
            );
          }

          // Stagger Reddit articles with 7 seconds delay (100 req/10 mins limit)
          for (const a of redditArticles) {
            await env.CONTENT_QUEUE.send(a, { delaySeconds: redditDelayCounter * 7 });
            redditDelayCounter++;
          }
        }

        // Cập nhật last_fetched_at
        await env.DB.prepare(
          "UPDATE sources SET last_fetched_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), source.id).run();

        return { name: source.name, fetched: articles.length, inserted: insertedCount, enqueued: newArticles.length };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, fetched, inserted, enqueued } = result.value;
        console.log(`✅ ${name}: Fetched ${fetched}, Inserted ${inserted} new, Enqueued ${enqueued} for scraping.`);
        totalFetched += fetched;
        totalInserted += inserted;
        totalEnqueued += enqueued;
      } else {
        console.error(`❌ Error in batch:`, result.reason);
        totalErrors++;
      }
    }
  }

  console.log(`Cron done. Total: ${totalFetched} fetched, ${totalInserted} inserted, ${totalEnqueued} enqueued, ${totalErrors} errors.`);
}
