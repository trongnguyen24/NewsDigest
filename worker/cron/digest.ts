import { Env } from '../types';
import { generateDigest } from '../ai/summarizer';

/**
 * Cron Digest — Chạy 2 lần/ngày (0 1,13 * * * = 8h & 20h VN).
 * Lấy các bài đã summarized trong 12h gần nhất → tổng hợp digest → lưu vào bảng digests.
 */
export async function scheduledDigest(env: Env) {
  console.log(`📰 Digest cron triggered at ${new Date().toISOString()}`);

  // Lấy bài đã summarized trong 12h gần nhất
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const { results } = await env.DB.prepare(
    `SELECT id, title, summary, hot_score
     FROM articles
     WHERE summary IS NOT NULL AND fetched_at > ?
     ORDER BY hot_score DESC
     LIMIT 50`
  ).bind(since).all<{ id: string; title: string; summary: string; hot_score: number }>();

  if (!results || results.length === 0) {
    console.log('📰 No summarized articles in last 12h, skipping digest.');
    return;
  }

  console.log(`📰 Generating digest from ${results.length} articles...`);

  try {
    const digest = await generateDigest(results, env);
    if (!digest) {
      console.log('📰 Digest generation returned null.');
      return;
    }

    const digestId = crypto.randomUUID();
    const now = new Date();
    const periodStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    await env.DB.prepare(
      `INSERT INTO digests (id, created_at, period_start, period_end, summary_text, top_article_ids, total_fetched)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      digestId,
      now.toISOString(),
      periodStart.toISOString(),
      now.toISOString(),
      digest.digest_text,
      JSON.stringify(digest.top_article_ids),
      results.length
    ).run();

    console.log(`📰 Digest saved: ${digestId} (${digest.digest_text.length} chars, ${digest.top_article_ids.length} top articles)`);
  } catch (err: any) {
    console.error('❌ Digest generation failed:', err.message);
  }
}
