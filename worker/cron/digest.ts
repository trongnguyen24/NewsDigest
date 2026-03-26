import { Env } from '../types';
import { generateDigest } from '../ai/summarizer';

/**
 * Cron Digest — Chạy sau mỗi lần scrape (mỗi 3h).
 * Lấy tất cả bài đã summarized trong ngày hiện tại (VN timezone) →
 * tổng hợp digest → INSERT hoặc UPDATE digest cho ngày đó.
 */
export async function scheduledDigest(env: Env) {
  console.log(`📰 Digest cron triggered at ${new Date().toISOString()}`);

  // Tính ngày hiện tại theo VN timezone (UTC+7)
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const digestDate = vnNow.toISOString().slice(0, 10); // YYYY-MM-DD

  // Tính UTC range cho ngày VN
  const dayStartUTC = new Date(`${digestDate}T00:00:00+07:00`);
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  const { results } = await env.DB.prepare(
    `SELECT id, title, summary, hot_score
     FROM articles
     WHERE summary IS NOT NULL
       AND published_at >= ?
       AND published_at < ?
     ORDER BY hot_score DESC
     LIMIT 50`
  ).bind(dayStartUTC.toISOString(), dayEndUTC.toISOString())
    .all<{ id: string; title: string; summary: string; hot_score: number }>();

  if (!results || results.length === 0) {
    console.log(`📰 No summarized articles for ${digestDate}, skipping digest.`);
    return;
  }

  console.log(`📰 Generating digest for ${digestDate} from ${results.length} articles...`);

  try {
    const digest = await generateDigest(results, env);
    if (!digest) {
      console.log('📰 Digest generation returned null.');
      return;
    }

    const nowISO = now.toISOString();

    // UPSERT: INSERT nếu chưa có, UPDATE nếu đã tồn tại
    await env.DB.prepare(
      `INSERT INTO digests (id, digest_date, created_at, updated_at, summary_text, total_fetched)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(digest_date) DO UPDATE SET
         summary_text = excluded.summary_text,
         updated_at = excluded.updated_at,
         total_fetched = excluded.total_fetched`
    ).bind(
      crypto.randomUUID(),
      digestDate,
      nowISO,
      nowISO,
      digest.digest_text,
      results.length
    ).run();

    console.log(`📰 Digest saved for ${digestDate} (${digest.digest_text.length} chars, ${results.length} articles)`);
  } catch (err: any) {
    console.error('❌ Digest generation failed:', err.message);
  }
}
