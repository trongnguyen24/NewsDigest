import { Env, Source, ContentScrapeMessage } from '../types';
import { ArticleRepo, SourceRepo } from '../db';
import { fetchSource } from '../scraper';
import { stripHtmlToText } from '../scraper/utils';
import { githubFetcher } from '../queue/fetchers/github';
import { summarizeArticle } from '../ai/summarizer';
import { SCRAPER_SETTINGS } from '../settings';

/** Chuẩn hoá published_at về ISO 8601 UTC trước khi insert. */
function normalizePublishedAt(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const BATCH_SIZE = SCRAPER_SETTINGS.sourceFetch.batchSize;

// Cron Worker — Fetch enabled sources mỗi lần chạy.
// Chạy song song theo batch để tránh quá tải.
// Sau khi insert, enqueue article URLs mới vào CONTENT_QUEUE để cào nội dung.
//
// triggerCron: cron pattern đã trigger (dùng để phân biệt cron nào chạy)
// - "0 */3 * * *" → scrape tất cả NGOẠI TRỪ github-trending
// - "0 1 * * *"   → chỉ scrape github-trending
export async function scheduled(event: ScheduledEvent | null, env: Env, ctx: ExecutionContext, triggerCron?: string) {
  const isGitHubTrendingCron = triggerCron === SCRAPER_SETTINGS.cron.githubTrending;
  const cronLabel = isGitHubTrendingCron ? 'GitHub Trending (daily)' : 'General (every 3h)';
  console.log(`Cron [${cronLabel}] triggered at ${new Date().toISOString()}`);

  const allSources = await SourceRepo.findAllEnabled(env.DB);

  if (allSources.length === 0) {
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

  // Reddit fetching is handled by the browser extension because Reddit blocks
  // server-side JSON/API access from worker/bot environments.
  const nonRedditSources = sources.filter(s => s.type !== 'reddit');
  const redditSources: Source[] = [];
  const skippedReddit = sources.filter(s => s.type === 'reddit').length;
  if (skippedReddit > 0) {
    console.log(`⏭️ Skipping ${skippedReddit} Reddit sources (use browser extension)`);
  }

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
        // ── Reddit 2-step: check trước, chỉ enqueue bài MỚI hoặc đã sang ngày mới ──
        const existing = await ArticleRepo.findBySourceAndUrl(env.DB, source.id, article.url);
        const description = article.description || null;
        const publishedAt = normalizePublishedAt(article.published_at);

        if (existing) {
          // Luôn update description với stats mới nhất
          await ArticleRepo.updateDescription(env.DB, existing.id, description);

          // Nếu bài đã sang ngày mới (> 1 ngày) → reset published_at + re-summarize
          // Nếu đã cào hôm nay rồi → bỏ qua, tránh lặp bài trong ngày
          const daysSince = (Date.now() - new Date(existing.published_at).getTime()) / 86_400_000;
          if (daysSince >= SCRAPER_SETTINGS.reddit.reprocessAfterDays) {
            await ArticleRepo.resetForReprocessing(env.DB, existing.id, publishedAt);
            newArticles.push({ articleId: existing.id, url: article.url, title: article.title });
            insertedCount++;
            console.log(`🔄 Reddit re-enqueue "${article.title}" — still hot after ${daysSince.toFixed(1)} days`);
          }
        } else {
          // Bài mới hoàn toàn → insert + enqueue
          const idValue = crypto.randomUUID();
          await ArticleRepo.insert(env.DB, {
            id: idValue, source_id: source.id, url: article.url,
            title: article.title, description, published_at: publishedAt,
          });
          insertedCount++;
          newArticles.push({ articleId: idValue, url: article.url, title: article.title });
        }
      } else if (source.type === 'github-trending') {
        // ── GitHub Trending: xử lý INLINE (không dùng queue) ──────────────────
        // Queue consumer bị giới hạn CPU 10ms/invocation trên Free plan → bị kill.
        // Scheduled worker không có giới hạn này (wall clock 15 phút) → an toàn hơn.
        const existing = await ArticleRepo.findBySourceAndUrl(env.DB, source.id, article.url);
        const description = article.description || null;
        const publishedAt = normalizePublishedAt(article.published_at);

        let articleId: string;
        let needsSummarize = false;

        if (existing) {
          // Luôn update description (stars mới nhất)
          await ArticleRepo.updateDescription(env.DB, existing.id, description);

          // Nếu bài cũ đã > 3 ngày → coi là trending event mới, reset + re-summarize
          const daysSince = (Date.now() - new Date(existing.published_at).getTime()) / 86_400_000;
          if (daysSince >= SCRAPER_SETTINGS.github.reprocessAfterDays) {
            await ArticleRepo.resetForReprocessing(env.DB, existing.id, publishedAt);
            articleId = existing.id;
            needsSummarize = true;
            insertedCount++;
            console.log(`🔄 GitHub Trending re-process "${article.title}" — last seen ${daysSince.toFixed(1)} days ago`);
          } else {
            // Bài còn mới, đã có summary → bỏ qua
            continue;
          }
        } else {
          // Repo mới hoàn toàn → insert
          articleId = crypto.randomUUID();
          await ArticleRepo.insert(env.DB, {
            id: articleId, source_id: source.id, url: article.url,
            title: article.title, description, published_at: publishedAt,
          });
          insertedCount++;
          needsSummarize = true;
        }

        // ── Inline: fetch README + AI summarize (tuần tự, không enqueue) ──
        if (needsSummarize) {
          try {
            const content = await githubFetcher.fetch(article.url, env);
            if (content) {
              console.log(`📖 GitHub README fetched for "${article.title}" (${content.length} chars)`);
              const aiResult = await summarizeArticle(article.title, content, env);
              if (aiResult) {
                await ArticleRepo.updateSummary(env.DB, articleId, aiResult);
                console.log(`🤖 GitHub Trending summarized: "${article.title}" → score=${aiResult.hot_score}`);
              }
            } else {
              console.log(`⚠️ No README content for "${article.title}"`);
            }
          } catch (err: any) {
            // ContentUnavailableError (no README) → không retry, ghi chú vào description_vn
            const msg = err?.message || String(err);
            console.log(`⚠️ GitHub Trending inline error for "${article.title}": ${msg}`);
            // Không throw — tiếp tục xử lý repo tiếp theo
          }
        }
      } else {
        // Non-Reddit / Non-GitHub-Trending: dedup cứng
        const idValue = crypto.randomUUID();
        const publishedAt = normalizePublishedAt(article.published_at);
        const description = article.description || null;
        const changes = await ArticleRepo.insertOrIgnore(env.DB, {
          id: idValue, source_id: source.id, url: article.url,
          title: article.title, description, published_at: publishedAt,
        });

        if (changes > 0) {
          insertedCount++;
          newArticles.push({ articleId: idValue, url: article.url, title: article.title });

          // ── Pre-save content from RSS content:encoded (e.g. WordPress) ──
          // If the feed already provides full HTML content, strip and save it now.
          // The queue consumer will skip scraping and go straight to AI summarize.
          if (article.contentEncoded) {
            const plainText = stripHtmlToText(article.contentEncoded);
            if (plainText.length >= SCRAPER_SETTINGS.sourceFetch.rssContentEncodedMinChars) {
              await ArticleRepo.updateContent(env.DB, idValue, plainText);
              console.log(`📦 RSS content:encoded saved for "${article.title}" (${plainText.length} chars)`);
            }
          }
        }
      }
    }

    // Enqueue new articles for content scraping (non-reddit, non-github-trending)
    // GitHub Trending đã được xử lý inline ở trên, không cần enqueue.
    if (newArticles.length > 0) {
      const normalArticles = newArticles.filter(a => !a.url.includes('reddit.com'));
      const redditArticles = newArticles.filter(a => a.url.includes('reddit.com'));

      if (normalArticles.length > 0) {
        await env.CONTENT_QUEUE.sendBatch(
          normalArticles.map(a => ({ body: a }))
        );
      }

      // Stagger Reddit articles with 15 seconds delay using sendBatch (per-message delay)
      // sendBatch hỗ trợ delaySeconds per-message → giảm N subrequests xuống 1
      if (redditArticles.length > 0) {
        await env.CONTENT_QUEUE.sendBatch(
          redditArticles.map((a, j) => ({
            body: a,
            delaySeconds: (redditDelayCounter + j) * SCRAPER_SETTINGS.reddit.queueDelaySeconds,
          }))
        );
        redditDelayCounter += redditArticles.length;
      }
    }

    // Cập nhật last_fetched_at
    await SourceRepo.updateLastFetched(env.DB, source.id);

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
  const REDDIT_STAGGER_MS = SCRAPER_SETTINGS.reddit.sourceStaggerMs;

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
