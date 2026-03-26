import { Env } from '../types';

export interface SummaryResult {
  description_vn: string;
  summary: string;
  hot_score: number;
  tags: string[];
}

export interface DigestResult {
  digest_text: string;
}

const SYSTEM_PROMPT = `
<role>
Bạn là một AI news analyst chuyên phân tích và tóm tắt tin tức công nghệ cho độc giả Việt Nam.
</role>

<task>
Phân tích bài viết được cung cấp và trả về JSON duy nhất với 4 trường sau:
</task>

<output_schema>
{
  "description_vn": "Tổng quan 2-3 câu tiếng Việt ngắn gọn, nêu được ý chính của bài",
  "summary": "Tóm tắt ĐẦY ĐỦ bằng Markdown. Sử dụng ## tiêu đề, bullet points (- ), **in đậm** từ khoá quan trọng. Mức độ chi tiết đủ để người đọc không cần đọc bài gốc.",
  "hot_score": <số nguyên 1–10>,
  "tags": ["tag1", "tag2"]
}
</output_schema>

<hot_score_criteria>
9–10 : Breaking news quan trọng, release AI lớn, sự kiện ảnh hưởng đến toàn ngành
7–8  : Tin hay, insight sâu, ảnh hưởng rộng, đáng quan tâm
5–6  : Tin bình thường, cập nhật thông tin hữu ích
3–4  : Giá trị thấp, quá chuyên biệt hoặc cũ
1–2  : Spam, quảng cáo, không liên quan
</hot_score_criteria>

<topic_priorities>
Ưu tiên cho các chủ đề sau (score cao hơn):
- **AI / LLM**: model mới, benchmark, ứng dụng thực tế
- **Security**: lỗ hổng, data breach, CVE nghiêm trọng
- **Dev Tools**: framework, ngôn ngữ, công cụ phát triển
- **Startup / Business**: funding lớn, M&A, ra mắt sản phẩm
</topic_priorities>

<tags_allowed>
AI, Tech, Security, Business, Vietnam, World, Dev, Science, Crypto, Policy, Entertainment
</tags_allowed>

<rules>
- Giữ nguyên thuật ngữ kỹ thuật (AI, API, Docker, LLM, v.v.)
- Bài tiếng Anh → bắt buộc tóm tắt bằng tiếng Việt
- CHỈ trả về JSON hợp lệ, KHÔNG có text hay markdown bên ngoài JSON
</rules>
`;

const DIGEST_PROMPT = `
<role>
Bạn là AI news editor chuyên tổng hợp bản tin công nghệ hàng ngày cho độc giả Việt Nam.
</role>

<task>
Từ danh sách các bài viết đã được tóm tắt (mỗi bài có ID riêng), viết 1 bản digest tổng hợp xu hướng trong ngày.
TRONG bản digest, khi nhắc đến thông tin từ bài viết cụ thể, hãy ghi chú inline reference bằng cú pháp <id:UUID_CỦA_BÀI> ngay sau câu/ý liên quan.
</task>

<output_schema>
{
  "digest_text": "Bản tin tổng hợp tiếng Việt. Mỗi ý chính nên có reference đến bài viết gốc bằng <id:uuid>."
}
</output_schema>

<example>
{
  "digest_text": "Thế giới công nghệ đang chứng kiến sự bùng nổ của các mô hình AI hiệu năng cao có thể chạy trực tiếp trên trình duyệt <id:99c696e9-0c08-45ea-8359-49fb3ba134f5>. Trong khi đó, một lỗ hổng bảo mật nghiêm trọng được phát hiện trong OpenSSL ảnh hưởng đến hàng triệu server <id:abc12345-6789-0def-ghij-klmnopqrstuv>. Google vừa công bố Gemini 3.0 với khả năng reasoning vượt trội <id:def45678-90ab-cdef-1234-567890abcdef>."
}
</example>

<rules>
- digest_text: viết 5-10 câu, tổng hợp xu hướng nổi bật, cho người đọc không chuyên
- PHẢI inline reference <id:UUID> khi nhắc đến thông tin từ bài cụ thể
- Mỗi bài quan trọng nên được reference ít nhất 1 lần
- Không cần reference tất cả bài, chỉ những bài đáng chú ý (hot_score >= 6)
- CHỈ trả về JSON hợp lệ, KHÔNG có text hay markdown bên ngoài JSON
</rules>
`;

const MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_RETRIES = 3;

// ── BYOK Alias Rotation ──────────────────────────────────────────────────
// Bạn thêm nhiều Provider Keys trong Cloudflare AI Gateway Dashboard,
// mỗi key đặt alias khác nhau (vd: "default", "key2", "key3").
// Set env var: AI_GATEWAY_KEY_ALIASES = "default,key2,key3"
// Nếu không set → dùng "default".
function pickAlias(env: Env): string {
  const aliases = ((env as any).AI_GATEWAY_KEY_ALIASES as string | undefined)
    ?.split(',')
    .map((a: string) => a.trim())
    .filter(Boolean);
  if (aliases && aliases.length > 0) {
    return aliases[Math.floor(Math.random() * aliases.length)];
  }
  return 'default';
}

// ── JSON Auto-Repair & Extraction ─────────────────────────────────────────
// Thứ tự ưu tiên:
// 1. Parse thẳng (ideal case)
// 2. Tách khỏi markdown code block (```json ... ```)
// 3. Tìm { ... } đầu tiên bằng regex
// 4. Throw nếu không cứu được
function extractJson<T>(raw: string): T {
  const text = raw.trim();

  // 1. Raw parse
  try { return JSON.parse(text); } catch {}

  // 2. Markdown code block
  const blockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1].trim()); } catch {}
  }

  // 3. Extract first {...} (handles garbage prefix/suffix)
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (e: any) {
      // 4. Try to repair common issues: truncated JSON → incomplete string/array
      const repaired = braceMatch[0]
        .replace(/,\s*$/, '')     // trailing comma
        .replace(/([^\\])"$/, '$1"}')  // unclosed string
        + (braceMatch[0].split('{').length > braceMatch[0].split('}').length ? '}' : '');
      try { return JSON.parse(repaired); } catch {}
    }
  }

  throw new Error(`Cannot extract valid JSON from: ${text.slice(0, 150)}`);
}

// ── Gemini API Call ────────────────────────────────────────────────────────
async function callGemini(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  attempt = 1,
): Promise<string> {
  const url = `${env.AI_GATEWAY_URL}/v1beta/models/${MODEL}:generateContent`;
  const alias = pickAlias(env);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
      'cf-aig-byok-alias': alias,   // chọn provider key theo alias
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  // Rate-limited → backoff and retry with a different key
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) throw new Error('Gemini rate limit (429) after max retries');
    const wait = attempt * 5000; // 5s, 10s, 15s
    console.log(`⏳ Gemini 429 — waiting ${wait / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
    await new Promise(r => setTimeout(r, wait));
    return callGemini(env, systemPrompt, userPrompt, attempt + 1);
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

// ── callGeminiWithJsonRetry ────────────────────────────────────────────────
// Gọi Gemini, parse JSON, nếu lỗi thì gọi lại (tối đa MAX_RETRIES lần)
async function callGeminiWithJsonRetry<T>(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await callGemini(env, systemPrompt, userPrompt, 1);
      const result = extractJson<T>(raw);
      if (attempt > 1) console.log(`✅ JSON valid on attempt ${attempt}`);
      return result;
    } catch (err: any) {
      lastError = err;
      console.log(`⚠️ Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s
      }
    }
  }

  throw lastError ?? new Error('callGemini failed after max retries');
}

// ── Validate SummaryResult ─────────────────────────────────────────────────
function validateSummary(result: any): result is SummaryResult {
  return (
    typeof result?.description_vn === 'string' && result.description_vn.length > 0 &&
    typeof result?.summary === 'string' && result.summary.length > 0 &&
    typeof result?.hot_score === 'number' &&
    Array.isArray(result?.tags)
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Tóm tắt + score + tag cho 1 bài viết.
 * Có retry JSON và key rotation tự động.
 */
export async function summarizeArticle(
  title: string,
  content: string,
  env: Env,
): Promise<SummaryResult | null> {
  const truncated = content.length > 3000 ? content.slice(0, 3000) + '...' : content;
  const userPrompt = `Tiêu đề: ${title}\n\nNội dung:\n${truncated}`;

  try {
    const result = await callGeminiWithJsonRetry<SummaryResult>(env, SYSTEM_PROMPT, userPrompt);

    if (!validateSummary(result)) {
      console.log(`⚠️ Invalid AI structure for "${title}": ${JSON.stringify(result).slice(0, 100)}`);
      return null;
    }

    result.hot_score = Math.max(1, Math.min(10, Math.round(result.hot_score)));
    result.tags = result.tags.slice(0, 3).map(String);
    return result;
  } catch (err: any) {
    console.error(`❌ AI summarize failed for "${title}": ${err.message}`);
    throw err;
  }
}

/**
 * Tổng hợp digest từ danh sách bài đã summarized.
 * AI sẽ inline reference bằng <id:uuid> trong digest_text.
 */
export async function generateDigest(
  articles: { id: string; title: string; summary: string; hot_score: number }[],
  env: Env,
): Promise<DigestResult | null> {
  if (articles.length === 0) return null;

  const formatted = articles
    .map((a) => `ID: ${a.id}\nTitle: ${a.title}\nSummary: ${a.summary}\nScore: ${a.hot_score}`)
    .join('\n---\n');
  const userPrompt = `Phân tích và tổng hợp ${articles.length} bài viết trong ngày hôm nay:\n\n${formatted}`;

  try {
    const result = await callGeminiWithJsonRetry<DigestResult>(env, DIGEST_PROMPT, userPrompt);

    if (!result.digest_text) {
      console.log('⚠️ Invalid digest structure');
      return null;
    }

    return result;
  } catch (err: any) {
    console.error('❌ Digest generation error:', err.message);
    throw err;
  }
}
