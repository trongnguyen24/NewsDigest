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
Bản digest PHẢI được viết bằng Markdown có cấu trúc rõ ràng, dễ đọc.
TRONG bản digest, khi nhắc đến thông tin từ bài viết cụ thể, hãy ghi chú inline reference bằng cú pháp <id:UUID_CỦA_BÀI> ngay sau câu/ý liên quan.
</task>

<output_schema>
{
  "digest_text": "Markdown có cấu trúc: đoạn tổng quan + các heading theo chủ đề + bullet points."
}
</output_schema>

<format>
Cấu trúc bắt buộc:
1. Mở đầu bằng 1 đoạn tổng quan ngắn (2-3 câu) tóm tắt bức tranh chung trong ngày
2. Tiếp theo chia thành các nhóm chủ đề, mỗi nhóm có heading ## và các bullet points
3. Mỗi bullet point là 1-2 câu ngắn gọn, **in đậm** keyword/tên sản phẩm quan trọng
4. Đặt <id:uuid> ngay cuối bullet point liên quan
5. Chỉ tạo heading cho nhóm có nội dung, không tạo nhóm rỗng
</format>

<example>
{
  "digest_text": "Ngày hôm nay chứng kiến nhiều chuyển động lớn trong lĩnh vực AI và bảo mật, đặc biệt là cuộc đua tối ưu mô hình ngôn ngữ lớn và các vấn đề an ninh mạng đáng lo ngại.\n\n## AI & LLM\n\n- **Google** công bố Gemini 3.0 với khả năng reasoning vượt trội, đạt điểm cao nhất trên nhiều benchmark <id:def45678-90ab-cdef-1234-567890abcdef>\n- Xu hướng chạy mô hình AI trực tiếp trên trình duyệt đang bùng nổ nhờ kỹ thuật quantization mới <id:99c696e9-0c08-45ea-8359-49fb3ba134f5>\n\n## Bảo mật\n\n- Lỗ hổng nghiêm trọng trong **OpenSSL** ảnh hưởng đến hàng triệu server, các chuyên gia khuyến cáo cập nhật ngay <id:abc12345-6789-0def-ghij-klmnopqrstuv>"
}
</example>

<rules>
- digest_text: viết bằng Markdown, chia theo chủ đề (## heading), dùng bullet points (- )
- Mỗi bullet 1-2 câu ngắn gọn, in đậm keyword/tên sản phẩm quan trọng
- Bắt đầu bằng 1 đoạn tổng quan ngắn trước khi vào chi tiết
- PHẢI inline reference <id:UUID> khi nhắc đến thông tin từ bài cụ thể
- Mỗi bài quan trọng nên được reference ít nhất 1 lần
- Không cần reference tất cả bài, chỉ những bài đáng chú ý (hot_score >= 6)
- CHỈ trả về JSON hợp lệ, KHÔNG có text hay markdown bên ngoài JSON
- Các heading gợi ý: AI & LLM, Bảo mật, Công cụ & Hạ tầng, Startup & Kinh doanh, Chính sách & Xã hội (chỉ dùng heading phù hợp với nội dung có)
</rules>
`;

// ── Model Pool ────────────────────────────────────────────────────────────
// Hai model Gemma 4 cùng rate limit (RPM=15, TPM=Unlimited, RPD=1500).
// Random chọn model → gấp đôi throughput (RPM=30, RPD=3000).
// Khi bị 429 → tự chuyển sang model kia.
const MODELS = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'] as const;
const MAX_RETRIES = 3;

function pickModel(): string {
  return MODELS[Math.floor(Math.random() * MODELS.length)];
}

function getOtherModel(current: string): string {
  return current === MODELS[0] ? MODELS[1] : MODELS[0];
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

// ── Extract response text (skip thinking parts) ──────────────────────────
// Gemma models return multi-part responses where parts with `thought: true`
// are internal reasoning. We need the actual answer part.
function extractResponseText(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  // Find the last non-thinking part (the actual answer)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!parts[i].thought && parts[i].text) {
      return parts[i].text;
    }
  }

  // Fallback: return first part with text (even if thinking)
  return parts[0]?.text ?? null;
}

// ── AI API Call (JSON mode) ────────────────────────────────────────────────
async function callGemini(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  model = pickModel(),
  attempt = 1,
  timeoutMs?: number,
): Promise<string> {
  const url = `${env.AI_GATEWAY_URL}/v1beta/models/${model}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  const timeout = timeoutMs ?? 60000;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
      'cf-aig-byok-alias': 'default',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  // Rate-limited → switch to the other model and retry
  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) throw new Error(`${model} rate limit (429) after max retries`);
    const nextModel = getOtherModel(model);
    const wait = attempt * 2000; // 2s, 4s, 6s — short wait since other model is likely not rate-limited
    console.log(`⏳ ${model} 429 — switching to ${nextModel}, waiting ${wait / 1000}s (retry ${attempt + 1}/${MAX_RETRIES})`);
    await new Promise(r => setTimeout(r, wait));
    return callGemini(env, systemPrompt, userPrompt, nextModel, attempt + 1, timeoutMs);
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI API error [${model}] ${res.status}: ${err.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const text = extractResponseText(data);
  if (!text) throw new Error('Empty AI response');
  return text;
}

// ── AI API Call (Plain Text mode — no responseMimeType) ────────────────────
// Dùng cho multi-step fallback khi JSON mode thất bại
async function callGeminiPlainText(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  model: string = pickModel(),
  timeoutMs = 60000,
): Promise<string> {
  const url = `${env.AI_GATEWAY_URL}/v1beta/models/${model}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
      'cf-aig-byok-alias': 'default',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI API error [${model}] ${res.status}: ${err.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const text = extractResponseText(data);
  if (!text) throw new Error(`Empty ${model} response`);
  return text.trim();
}

// ── Clean fallback response ───────────────────────────────────────────────
// Model sometimes echoes back instructions or adds meta-commentary.
// Strip known patterns to get clean content only.
function cleanFallbackResponse(raw: string): string {
  let text = raw.trim();

  // Remove lines that echo back task/constraint instructions
  const echoPatterns = [
    /^\*?\s*Task:.*$/gm,
    /^\*?\s*Constraint:.*$/gm,
    /^\*?\s*Input:.*$/gm,
    /^\*?\s*Output:.*$/gm,
    /^Here is the .*:?\s*$/gim,
    /^Here's the .*:?\s*$/gim,
    /^Below is .*:?\s*$/gim,
    /^Dưới đây là .*:?\s*$/gim,
    /^Đây là .*:?\s*$/gim,
  ];
  for (const pattern of echoPatterns) {
    text = text.replace(pattern, '');
  }

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

// ── callGeminiWithJsonRetry ────────────────────────────────────────────────
// Gọi AI, parse JSON, nếu lỗi thì retry với model khác (tối đa MAX_RETRIES lần)
async function callGeminiWithJsonRetry<T>(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs?: number,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Alternate models on each attempt for better distribution
    const model = attempt === 1 ? pickModel() : getOtherModel(MODELS[attempt % 2]);
    try {
      console.log(`🤖 Attempt ${attempt}/${MAX_RETRIES} using ${model}`);
      const raw = await callGemini(env, systemPrompt, userPrompt, model, 1, timeoutMs);
      const result = extractJson<T>(raw);
      if (attempt > 1) console.log(`✅ JSON valid on attempt ${attempt}`);
      return result;
    } catch (err: any) {
      lastError = err;
      console.log(`⚠️ Attempt ${attempt}/${MAX_RETRIES} [${model}] failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s
      }
    }
  }

  throw lastError ?? new Error(`AI call failed after ${MAX_RETRIES} retries`);
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

// ── Multi-Step Fallback (plain text, no JSON) ─────────────────────────────
// Khi JSON mode fail → gọi 4 lần riêng biệt, mỗi lần hỏi 1 field
const ALLOWED_TAGS = ['AI', 'Tech', 'Security', 'Business', 'Vietnam', 'World', 'Dev', 'Science', 'Crypto', 'Policy', 'Entertainment'];

async function summarizeArticleFallback(
  title: string,
  truncatedContent: string,
  env: Env,
): Promise<SummaryResult> {
  const model = pickModel();
  console.log(`🔄 Fallback: using ${model} multi-step for "${title.slice(0, 60)}"`);

  // Step 1: description_vn
  const description_vn = cleanFallbackResponse(await callGeminiPlainText(
    env,
    'Bạn là trợ lý tóm tắt tin tức. Luôn trả lời bằng tiếng Việt. Chỉ trả về nội dung tóm tắt, KHÔNG lặp lại đề bài, KHÔNG thêm ghi chú hay giải thích.',
    `Tóm tắt bài viết sau trong 2-3 câu tiếng Việt:\n\n${title}\n\n${truncatedContent}`,
  ));
  console.log(`  ✅ Step 1/4 description_vn (${description_vn.length} chars)`);

  // Step 2: summary (markdown)
  const summary = cleanFallbackResponse(await callGeminiPlainText(
    env,
    'Bạn là trợ lý tóm tắt tin tức công nghệ. Luôn viết bằng tiếng Việt. Trả về tóm tắt dạng Markdown có cấu trúc. Giữ nguyên thuật ngữ kỹ thuật (AI, API, LLM, v.v.). KHÔNG lặp lại đề bài, KHÔNG thêm ghi chú.',
    `Viết tóm tắt chi tiết bằng Markdown cho bài viết sau. Dùng ## cho heading, - cho bullet point, **bold** cho từ khóa quan trọng.\n\n${title}\n\n${truncatedContent}`,
  ));
  console.log(`  ✅ Step 2/4 summary (${summary.length} chars)`);

  // Step 3: hot_score
  const scoreRaw = await callGeminiPlainText(
    env,
    'Bạn là chuyên gia đánh giá tin tức tech. Chỉ trả về DUY NHẤT 1 con số từ 1 đến 10. Không giải thích.',
    `Chấm điểm mức độ quan trọng (1=thấp, 10=rất hot):\n\n${title}\n${description_vn}`,
  );
  const scoreMatch = scoreRaw.match(/\d+/);
  const hot_score = Math.max(1, Math.min(10, scoreMatch ? parseInt(scoreMatch[0], 10) : 5));
  console.log(`  ✅ Step 3/4 hot_score = ${hot_score} (raw: "${scoreRaw.slice(0, 30)}")`);

  // Step 4: tags
  const tagsRaw = await callGeminiPlainText(
    env,
    `Bạn là hệ thống gắn tag. Chỉ trả về các tag cách nhau bởi dấu phẩy. KHÔNG giải thích. Tags hợp lệ: ${ALLOWED_TAGS.join(', ')}`,
    `Chọn tối đa 3 tags phù hợp nhất:\n\n${title}\n${description_vn}`,
  );
  const tags = tagsRaw
    .split(',')
    .map(t => t.trim().replace(/[^a-zA-Z]/g, ''))
    .filter(t => ALLOWED_TAGS.includes(t))
    .slice(0, 3);
  console.log(`  ✅ Step 4/4 tags = [${tags.join(', ')}]`);

  console.log(`✅ Fallback complete for "${title.slice(0, 60)}"`);
  return { description_vn, summary, hot_score, tags };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Tóm tắt + score + tag cho 1 bài viết.
 * Thử JSON mode (retry) trước → nếu fail → multi-step plain text (last resort).
 */
export async function summarizeArticle(
  title: string,
  content: string,
  env: Env,
): Promise<SummaryResult | null> {
  const truncated = content.length > 3000 ? content.slice(0, 3000) + '...' : content;
  const userPrompt = `Tiêu đề: ${title}\n\nNội dung:\n${truncated}`;

  // ── Try JSON mode (with retry) ──
  try {
    const result = await callGeminiWithJsonRetry<SummaryResult>(env, SYSTEM_PROMPT, userPrompt);

    if (!validateSummary(result)) {
      console.log(`⚠️ Invalid AI structure for "${title}": ${JSON.stringify(result).slice(0, 100)}`);
      throw new Error('Invalid model response structure');
    }

    result.hot_score = Math.max(1, Math.min(10, Math.round(result.hot_score)));
    result.tags = result.tags.slice(0, 3).map(String);
    return result;
  } catch (primaryErr: any) {
    console.log(`⚠️ JSON mode failed for "${title}": ${primaryErr.message}`);
    console.log(`🔄 Switching to multi-step plain text fallback...`);
  }

  // ── Last resort: multi-step plain text ──
  try {
    return await summarizeArticleFallback(title, truncated, env);
  } catch (fallbackErr: any) {
    console.error(`❌ All strategies failed for "${title}": ${fallbackErr.message}`);
    throw fallbackErr;
  }
}

/**
 * Tổng hợp digest từ danh sách bài đã summarized.
 * AI sẽ inline reference bằng <id:uuid> trong digest_text.
 * Flow: JSON mode (retry) → plain text (last resort).
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

  const DIGEST_TIMEOUT = 120000; // 120s — digest prompt lớn hơn (40+ bài)

  // ── Try JSON mode (with retry) ──
  try {
    const result = await callGeminiWithJsonRetry<DigestResult>(env, DIGEST_PROMPT, userPrompt, DIGEST_TIMEOUT);
    if (result.digest_text) return result;
    console.log('⚠️ Invalid digest structure');
  } catch (err: any) {
    console.log(`⚠️ JSON mode digest failed: ${err.message}`);
  }

  // ── Last resort: plain text (digest chỉ cần 1 field) ──
  try {
    console.log(`🔄 Trying plain text mode for digest...`);
    const rawText = cleanFallbackResponse(await callGeminiPlainText(
      env,
      DIGEST_PROMPT,
      userPrompt,
      undefined,
      DIGEST_TIMEOUT,
    ));

    // Model có thể trả JSON cả trong plain text mode → thử parse digest_text ra
    let digestText = rawText;
    try {
      const parsed = extractJson<DigestResult>(rawText);
      if (parsed.digest_text) digestText = parsed.digest_text;
    } catch {
      // Không phải JSON → dùng raw text luôn
    }

    if (digestText && digestText.length > 50) {
      console.log(`✅ Plain text digest succeeded (${digestText.length} chars)`);
      return { digest_text: digestText };
    }
    console.log('⚠️ Plain text digest too short');
    return null;
  } catch (fallbackErr: any) {
    console.error(`❌ All digest strategies failed: ${fallbackErr.message}`);
    throw fallbackErr;
  }
}
