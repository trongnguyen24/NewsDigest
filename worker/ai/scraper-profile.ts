import { Env, ListingProfileConfig, ScraperProfileConfig } from '../types';

const PRIMARY_MODEL = 'gemini-3.1-flash-lite-preview';
const FALLBACK_MODEL = 'gemma-4-31b-it';
const MAX_RETRIES = 3;

const ARTICLE_SYSTEM_PROMPT = `
You are an expert web scraping engineer.
Return only valid JSON with this exact schema:
{
  "contentSelectors": ["..."],
  "removeSelectors": ["..."],
  "minLength": 40,
  "confidence": 0.0
}

Rules:
- contentSelectors must target article body containers, most-specific first.
- removeSelectors must remove ads/navigation/sidebar/related/comments/noise.
- Never use overly generic selectors in contentSelectors: html, body, *, main, [role="main"].
- Prefer stable class/id/attribute selectors.
- minLength range 20..300.
- confidence range 0..1.
- Do not include markdown, explanations, or extra keys.
`;

const LISTING_SYSTEM_PROMPT = `
You are an expert web scraping engineer.
Return only valid JSON with this exact schema:
{
  "linkSelectors": ["..."],
  "removeSelectors": ["..."],
  "confidence": 0.0
}

Rules:
- linkSelectors must target links to article detail pages on listing/archive/home pages.
- Never use overly generic selectors: a, body a, html a, *.
- Prefer stable container+link selectors (for example ".post-item a.card-link").
- removeSelectors should remove nav/footer/sidebar/ads/promo/newsletter blocks.
- confidence range 0..1.
- Do not include markdown, explanations, or extra keys.
`;

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

export function extractJson<T>(raw: string): T {
  const text = raw.trim();

  try {
    return JSON.parse(text);
  } catch {}

  const blockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1].trim());
    } catch {}
  }

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    return JSON.parse(braceMatch[0]);
  }

  throw new Error('Cannot extract JSON from AI response');
}

export async function callGemini(
  env: Env,
  systemPrompt: string,
  prompt: string,
  model = PRIMARY_MODEL,
  attempt = 1
): Promise<string> {
  const alias = pickAlias(env);
  const url = `${env.AI_GATEWAY_URL}/v1beta/models/${model}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
        'cf-aig-byok-alias': alias,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(model === PRIMARY_MODEL ? 25000 : 60000),
    });
  } catch (err: any) {
    // Retry khi network timeout (AbortError / TimeoutError) hoặc lỗi mạng
    const isRetryable = err.name === 'AbortError' || err.name === 'TimeoutError';
    if (isRetryable && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return callGemini(env, systemPrompt, prompt, model, attempt + 1);
    }
    throw err;
  }

  if (res.status === 429 && attempt < MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return callGemini(env, systemPrompt, prompt, model, attempt + 1);
  }

  // 503 overload → retry same model, then let caller handle fallback
  if (res.status === 503 && attempt < MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return callGemini(env, systemPrompt, prompt, model, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Profile AI error [${model}] ${res.status}: ${await res.text()}`);
  }

  const data: any = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  let text: string | undefined;
  if (Array.isArray(parts)) {
    // Skip thinking parts (gemma models return thought: true for internal reasoning)
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!parts[i].thought && parts[i].text) { text = parts[i].text; break; }
    }
    if (!text) text = parts[0]?.text;
  }
  if (!text) throw new Error('Profile AI response empty');
  return text;
}

function isContentSelectorTooGeneric(selector: string): boolean {
  const s = selector.trim().toLowerCase();
  return s === 'html' || s === 'body' || s === '*' || s === 'main' || s === '[role="main"]';
}

function normalizeSelectorArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const selector = item.trim();
    if (!selector) continue;
    if (selector.length > 180) continue;
    out.push(selector);
    if (out.length >= maxItems) break;
  }
  return [...new Set(out)];
}

export function normalizeConfig(input: any): ScraperProfileConfig | null {
  const contentSelectors = normalizeSelectorArray(input?.contentSelectors, 8)
    .filter((s) => !isContentSelectorTooGeneric(s));
  const removeSelectors = normalizeSelectorArray(input?.removeSelectors, 20);

  const rawMinLen = Number(input?.minLength);
  const minLength = Number.isFinite(rawMinLen) ? Math.min(300, Math.max(20, Math.round(rawMinLen))) : 40;

  const rawConfidence = Number(input?.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0.5;

  if (contentSelectors.length === 0) return null;

  return {
    contentSelectors,
    removeSelectors,
    minLength,
    confidence,
    source: 'ai',
    sampleUrl: '',
    updatedAt: new Date().toISOString(),
  };
}

function isListingSelectorTooGeneric(selector: string): boolean {
  const s = selector.trim().toLowerCase();
  return s === 'a' || s === 'body a' || s === 'html a' || s === '*';
}

export function normalizeListingConfig(input: any): ListingProfileConfig | null {
  const linkSelectors = normalizeSelectorArray(input?.linkSelectors, 10)
    .filter((s) => !isListingSelectorTooGeneric(s));
  const removeSelectors = normalizeSelectorArray(input?.removeSelectors, 20);

  const rawConfidence = Number(input?.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0.5;

  if (linkSelectors.length === 0) return null;

  return {
    linkSelectors,
    removeSelectors,
    confidence,
    source: 'ai',
    sampleUrl: '',
    updatedAt: new Date().toISOString(),
  };
}

export async function generateScraperProfile(
  domain: string,
  sampleUrl: string,
  cleanedHtml: string,
  env: Env
): Promise<ScraperProfileConfig | null> {
  if (!cleanedHtml || cleanedHtml.length < 300) return null;

  const prompt = [
    `Domain: ${domain}`,
    `Sample URL: ${sampleUrl}`,
    'Task: infer robust selectors for article content extraction.',
    'HTML sample:',
    cleanedHtml.slice(0, 120000),
  ].join('\n\n');

  // Try primary model first, fallback on any error
  async function tryModel(model: string): Promise<ScraperProfileConfig | null> {
    const raw = await callGemini(env, ARTICLE_SYSTEM_PROMPT, prompt, model);
    const parsed = extractJson<any>(raw);
    const config = normalizeConfig(parsed);
    if (!config) return null;
    config.sampleUrl = sampleUrl;
    return config;
  }

  try {
    const config = await tryModel(PRIMARY_MODEL);
    if (config) return config;
    console.log(`[scraper] primary model normalizeConfig failed for ${domain}, trying fallback...`);
  } catch (err: any) {
    console.log(`[scraper] primary model error for ${domain}: ${err.message}, trying fallback...`);
  }

  try {
    const fallbackConfig = await tryModel(FALLBACK_MODEL);
    if (fallbackConfig) return fallbackConfig;
    console.log(`[scraper] fallback model normalizeConfig also failed for ${domain}`);
  } catch (err: any) {
    console.log(`[scraper] fallback model error for ${domain}: ${err.message}`);
  }

  return null;
}

export async function generateListingProfile(
  domain: string,
  sampleUrl: string,
  cleanedHtml: string,
  env: Env
): Promise<ListingProfileConfig | null> {
  if (!cleanedHtml || cleanedHtml.length < 300) return null;

  const prompt = [
    `Domain: ${domain}`,
    `Sample URL: ${sampleUrl}`,
    'Task: infer robust selectors for extracting article links from a listing page.',
    'HTML sample:',
    cleanedHtml.slice(0, 120000),
  ].join('\n\n');

  // Try primary model first, fallback on any error
  async function tryModel(model: string): Promise<ListingProfileConfig | null> {
    const raw = await callGemini(env, LISTING_SYSTEM_PROMPT, prompt, model);
    const parsed = extractJson<any>(raw);
    const config = normalizeListingConfig(parsed);
    if (!config) return null;
    config.sampleUrl = sampleUrl;
    return config;
  }

  try {
    const config = await tryModel(PRIMARY_MODEL);
    if (config) return config;
    console.log(`[scraper] primary listing model normalizeConfig failed for ${domain}, trying fallback...`);
  } catch (err: any) {
    console.log(`[scraper] primary listing model error for ${domain}: ${err.message}, trying fallback...`);
  }

  try {
    const fallbackConfig = await tryModel(FALLBACK_MODEL);
    if (fallbackConfig) return fallbackConfig;
    console.log(`[scraper] fallback listing model normalizeConfig also failed for ${domain}`);
  } catch (err: any) {
    console.log(`[scraper] fallback listing model error for ${domain}: ${err.message}`);
  }

  return null;
}
