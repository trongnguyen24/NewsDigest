import { Env, Source } from '../types';
import { fetchSource } from './scraper';

/**
 * Cron Worker — Round-robin: mỗi lần chỉ fetch 1 source.
 * Dùng KV lưu index nguồn tiếp theo cần fetch.
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

  // Round-robin: lấy index tiếp theo từ KV
  const lastIndexStr = await env.SCRAPER_CONFIG.get("cron:next_index");
  let nextIndex = lastIndexStr ? parseInt(lastIndexStr) : 0;
  if (nextIndex >= sources.length) nextIndex = 0;

  const source = sources[nextIndex];
  console.log(`Processing source ${nextIndex + 1}/${sources.length}: ${source.name} (${source.url})`);

  try {
    const articles = await fetchSource(source, env);

    let insertedCount = 0;
    for (const article of articles) {
      if (!article.title || !article.url) continue;

      const idValue = crypto.randomUUID();
      const publishedAt = article.published_at || new Date().toISOString();
      const fullText = article.full_text || null;

      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO articles (id, source_id, url, title, full_text, published_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(idValue, source.id, article.url, article.title, fullText, publishedAt).run();

      if (result.meta && result.meta.changes > 0) {
        insertedCount++;
      }
    }

    console.log(`Source ${source.name}: Fetched ${articles.length}, Inserted ${insertedCount} new.`);

    await env.DB.prepare(
      "UPDATE sources SET last_fetched_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), source.id).run();

  } catch (e) {
    console.error(`Error fetching source ${source.name}:`, e);
  }

  // Lưu index tiếp theo cho lần cron sau
  await env.SCRAPER_CONFIG.put("cron:next_index", String(nextIndex + 1));
  console.log(`Cron done. Next index: ${nextIndex + 1}`);
}
