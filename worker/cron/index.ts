import { Env, Source, ContentScrapeMessage } from '../types';
import { fetchSource } from './scraper';

/** Chuẩn hoá published_at về ISO 8601 UTC trước khi insert. */
function normalizePublishedAt(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const BATCH_SIZE = 3; // Fetch 3 sources song song

// Cron Worker — Fetch enabled sources mỗi lần chạy.
// Chạy song song theo batch để tránh quá tải.
// Sau khi insert, enqueue article URLs mới vào CONTENT_QUEUE để cào nội dung.
//
// triggerCron: cron pattern đã trigger (dùng để phân biệt cron nào chạy)
// - "0 */3 * * *" → scrape tất cả NGOẠI TRỪ github-trending
// - "0 1 * * *"   → chỉ scrape github-trending
export async function scheduled(event: ScheduledEvent | null, env: Env, ctx: ExecutionContext, triggerCron?: string) {
  const isGitHubTrendingCron = triggerCron === '0 1 * * *';
  const cronLabel = isGitHubTrendingCron ? 'GitHub Trending (daily)' : 'General (every 3h)';
  console.log(`Cron [${cronLabel}] triggered at ${new Date().toISOString()}`);

  const { results: allSources } = await env.DB.prepare(
    "SELECT * FROM sources WHERE enabled = 1 ORDER BY created_at"
  ).all<Source>();

  if (!allSources || allSources.length === 0) {
    console.log("No enabled sources found.");
    return;
  }

  // Lọc sources theo loại cron
  const sources = isGitHubTrendingCron
    ? allSources.filter(s => s.type === 'github-trending')
    : allSources.filter(s => s.type !== 'github-trending');

  if (sources.length === 0) {
    console.log(`No matching sources for cron [${cronLabel}].`);
    return;
  }

  // Tách Reddit ra xử lý riêng tuần tự (tránh rate limit từ Reddit API)
  const nonRedditSources = sources.filter(s => s.type !== 'reddit');
  const redditSources = sources.filter(s => s.type === 'reddit');

  console.log(`Fetching ${nonRedditSources.length} non-Reddit + ${redditSources.length} Reddit sources...`);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalEnqueued = 0;
  let totalErrors = 0;
  let redditDelayCounter = 0;

  // ── Helper: xử lý 1 source (insert articles + enqueue) ──────────────────
  async function processSource(source: Source): Promise<{ name: string; fetched: number; inserted: number; enqueued: number }> {
    const articles = await fetchSource(source, env);

    let insertedCount = 0;
    const newArticles: ContentScrapeMessage[] = [];

    for (const article of articles) {
      if (!article.title || !article.url) continue;

      if (source.type === 'reddit') {
        // ── Reddit 2-step: check trước, chỉ enqueue bài MỚI hoặc engagement spike ──
        const { results: existingRows } = await env.DB.prepare(
          `SELECT id, description FROM articles WHERE source_id = ? AND url = ?`
        ).bind(source.id, article.url).all();

        const existing = existingRows?.[0] as any;
        const description = article.description || null;
        const publishedAt = normalizePublishedAt(article.published_at);

        if (existing) {
          // Bài đã tồn tại → update engagement stats
          let oldScore = 0;
          let oldComments = 0;
          if (existing.description) {
            const scoreMatch = existing.description.match(/⬆(\d+)/);
            const commentsMatch = existing.description.match(/💬(\d+)/);
            if (scoreMatch) oldScore = parseInt(scoreMatch[1]);
            if (commentsMatch) oldComments = parseInt(commentsMatch[1]);
          }

          const newScore = article.reddit_score || 0;
          const newComments = article.reddit_comments || 0;
          const scoreDelta = newScore - oldScore;
          const commentsDelta = newComments - oldComments;

          // Luôn update stats mới nhất
          await env.DB.prepare(
            `UPDATE articles SET description = ? WHERE id = ?`
          ).bind(description, existing.id).run();

          // Nếu engagement tăng ≥ 50 (score hoặc comments) → re-summarize + đưa vào ngày mới
          if (scoreDelta >= 50 || commentsDelta >= 50) {
            await env.DB.prepare(
              `UPDATE articles SET published_at = ?, summary = NULL, description_vn = NULL, hot_score = NULL, tags = NULL WHERE id = ?`
            ).bind(publishedAt, existing.id).run();
            newArticles.push({ articleId: existing.id, url: article.url, title: article.title });
            insertedCount++;
            console.log(`🔄 Reddit re-enqueue "${article.title}" — score +${scoreDelta}, comments +${commentsDelta}`);
          }
        } else {
          // Bài mới hoàn toàn → insert + enqueue
          const idValue = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO articles (id, source_id, url, title, description, published_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(idValue, source.id, article.url, article.title, description, publishedAt).run();
          insertedCount++;
          newArticles.push({ articleId: idValue, url: article.url, title: article.title });
        }
      } else {
        // Non-Reddit: giữ dedup cứng
        const idValue = crypto.randomUUID();
        const publishedAt = normalizePublishedAt(article.published_at);
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
  }

  // ── 1. Non-Reddit: xử lý song song theo batch (như cũ) ──────────────────
  for (let i = 0; i < nonRedditSources.length; i += BATCH_SIZE) {
    const batch = nonRedditSources.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(batch.map(processSource));

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

  // ── 2. Reddit: xử lý tuần tự, delay 10s giữa mỗi subreddit ─────────────
  // Reddit rate-limit từ Cloudflare edge IPs → cào đồng thời nhiều /r sẽ bị block
  const REDDIT_STAGGER_MS = 10_000;

  for (let i = 0; i < redditSources.length; i++) {
    const source = redditSources[i];

    // Delay trước mỗi request (trừ request đầu tiên)
    if (i > 0) {
      console.log(`⏳ Reddit stagger: waiting ${REDDIT_STAGGER_MS / 1000}s before ${source.name}...`);
      await new Promise(r => setTimeout(r, REDDIT_STAGGER_MS));
    }

    try {
      const result = await processSource(source);
      console.log(`✅ ${result.name}: Fetched ${result.fetched}, Inserted ${result.inserted} new, Enqueued ${result.enqueued} for scraping.`);
      totalFetched += result.fetched;
      totalInserted += result.inserted;
      totalEnqueued += result.enqueued;
    } catch (err: any) {
      console.error(`❌ Reddit ${source.name} failed:`, err?.message || err);
      totalErrors++;
    }
  }

  console.log(`Cron done. Total: ${totalFetched} fetched, ${totalInserted} inserted, ${totalEnqueued} enqueued, ${totalErrors} errors.`);
}
