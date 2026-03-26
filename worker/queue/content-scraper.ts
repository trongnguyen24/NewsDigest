import { Env, ContentScrapeMessage } from '../types';
import { extractArticleContent } from '../cron/scraper';
import { summarizeArticle } from '../ai/summarizer';

const MAX_CHARS = 25000;

/**
 * Extract YouTube video ID from URL
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch content from the Python micro-service (Render)
 */
async function fetchFromContentService(
  env: Env,
  endpoint: string,
  body: Record<string, string>
): Promise<string> {
  const res = await fetch(`${env.CONTENT_SERVICE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.CONTENT_SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Content service returned ${res.status}: ${await res.text()}`);
  }

  return res.text();
}

/**
 * Fetch Reddit post content + top comments via public JSON endpoint.
 * No API key needed — uses reddit.com/.../.json
 */
async function fetchRedditContent(url: string): Promise<string> {
  const cleanUrl = url.replace(/\/+$/, '');
  const jsonUrl = `${cleanUrl}.json?limit=20&depth=2&sort=top`;

  const res = await fetch(jsonUrl, {
    headers: { 'User-Agent': 'NewsDigest/1.0 (news aggregation bot)' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Reddit JSON failed: ${res.status}`);
  }

  const data: any = await res.json();

  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return '';

  const parts: string[] = [];

  parts.push(`[Post] ${post.title}`);
  if (post.selftext) {
    parts.push(post.selftext);
  }
  if (post.url_overridden_by_dest && !post.is_self) {
    parts.push(`Link: ${post.url_overridden_by_dest}`);
  }

  const comments = data?.[1]?.data?.children || [];
  const topComments = comments
    .filter((c: any) => c.kind === 't1')
    .slice(0, 15);

  if (topComments.length > 0) {
    parts.push('\n---\n[Top Comments]');
    for (const c of topComments) {
      const d = c.data;
      const body = (d.body || '').slice(0, 500);
      parts.push(`@${d.author} (score: ${d.score}): ${body}`);

      const replies = d.replies?.data?.children || [];
      const topReply = replies.find((r: any) => r.kind === 't1');
      if (topReply) {
        const rd = topReply.data;
        const replyBody = (rd.body || '').slice(0, 300);
        parts.push(`  ↳ @${rd.author} (score: ${rd.score}): ${replyBody}`);
      }
    }
  }

  return parts.join('\n').slice(0, MAX_CHARS);
}

/**
 * Queue Consumer — Nhận batch messages chứa article URLs,
 * cào nội dung từng bài, gọi AI tóm tắt, và cập nhật D1.
 *
 * Routing:
 *   - YouTube URLs → Python service /youtube/transcript
 *   - Reddit URLs  → Public JSON endpoint (direct fetch)
 *   - Other URLs   → HTMLRewriter (extractArticleContent)
 *
 * Sau khi cào content → gọi Gemini AI qua AI Gateway để:
 *   - Tóm tắt (summary)
 *   - Chấm điểm (hot_score)
 *   - Gắn tag (tags)
 */
export async function handleContentQueue(
  batch: MessageBatch<ContentScrapeMessage>,
  env: Env
): Promise<void> {
  console.log(`📥 Processing ${batch.messages.length} articles for content scraping...`);

  // Warm up Render service (avoid cold start delay on first real request)
  if (env.CONTENT_SERVICE_URL) {
    await fetch(`${env.CONTENT_SERVICE_URL}/health`).catch(() => {});
  }

  for (const message of batch.messages) {
    const { articleId, url, title } = message.body;

    try {
      let content = '';

      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        // --- YouTube → Python service ---
        const videoId = extractVideoId(url);
        if (videoId && env.CONTENT_SERVICE_URL) {
          const raw = await fetchFromContentService(env, '/youtube/transcript', {
            video_id: videoId,
          });
          const data = JSON.parse(raw);
          content = data.transcript || '';
          if (data.error) {
            console.log(`⚠️ YouTube transcript warning for ${url}: ${data.error}`);
          }
        } else if (!videoId) {
          console.log(`⚠️ Could not extract video ID from ${url}`);
        }
      } else if (url.includes('reddit.com')) {
        // --- Reddit → Public JSON ---
        await new Promise(r => setTimeout(r, 2000));
        content = await fetchRedditContent(url);
      } else {
        // --- Other sites → HTMLRewriter ---
        content = await extractArticleContent(url);
      }

      if (content) {
        await env.DB.prepare(
          "UPDATE articles SET content = ? WHERE id = ?"
        ).bind(content, articleId).run();
        console.log(`✅ Scraped content for ${url} (${content.length} chars)`);

        // ── AI Summarize ──────────────────────────────────
        // Gọi ngay sau khi có content, nếu lỗi thì bỏ qua
        try {
          const aiResult = await summarizeArticle(title || '', content, env);
          if (aiResult) {
            await env.DB.prepare(
              "UPDATE articles SET description_vn = ?, summary = ?, hot_score = ?, tags = ? WHERE id = ?"
            ).bind(aiResult.description_vn, aiResult.summary, aiResult.hot_score, JSON.stringify(aiResult.tags), articleId).run();
            console.log(`🤖 AI: "${title}" → score=${aiResult.hot_score} tags=${aiResult.tags.join(',')}`);
          }
        } catch (aiErr: any) {
          console.log(`⚠️ AI summarize skipped for "${title}": ${aiErr.message}`);
        }
      } else {
        console.log(`⚠️ No content extracted for ${url}`);
      }

      message.ack();
    } catch (err: any) {
      console.error(`❌ Failed to scrape ${url}:`, err);
      if (err.message && err.message.includes('429')) {
        message.retry({ delaySeconds: 65 });
      } else {
        message.retry();
      }
    }
  }

  console.log(`📥 Batch complete.`);
}
