import { Env, ScraperProfileConfig } from '../../types';
import { SiteProfile } from '../../cron/site-profiles';

// ── Validation ─────────────────────────────────────────────────────────────

function validateStoredProfile(config: any): ScraperProfileConfig | null {
  const contentSelectors = Array.isArray(config?.contentSelectors)
    ? config.contentSelectors.filter((v: unknown) => typeof v === 'string' && v.trim()).slice(0, 8)
    : [];
  if (contentSelectors.length === 0) return null;

  const removeSelectors = Array.isArray(config?.removeSelectors)
    ? config.removeSelectors.filter((v: unknown) => typeof v === 'string' && v.trim()).slice(0, 20)
    : [];

  const minLength = Number.isFinite(Number(config?.minLength))
    ? Math.max(20, Math.min(300, Number(config.minLength)))
    : 40;
  const confidence = Number.isFinite(Number(config?.confidence))
    ? Math.max(0, Math.min(1, Number(config.confidence)))
    : 0.5;
  const sampleUrl = typeof config?.sampleUrl === 'string' ? config.sampleUrl : '';
  const updatedAt = typeof config?.updatedAt === 'string' ? config.updatedAt : new Date().toISOString();

  return {
    contentSelectors,
    removeSelectors,
    minLength,
    confidence,
    source: 'ai',
    sampleUrl,
    updatedAt,
  };
}

// ── D1 persistence ──────────────────────────────────────────────────────────

export async function loadStoredProfile(domain: string, env: Env): Promise<ScraperProfileConfig | null> {
  const { results } = await env.DB.prepare(
    'SELECT config_json FROM scraper_configs WHERE domain = ? AND mode = ? LIMIT 1'
  ).bind(domain, 'html').all<{ config_json: string }>();

  if (!results || results.length === 0) return null;
  const row = results[0];
  if (!row?.config_json) return null;

  try {
    return validateStoredProfile(JSON.parse(row.config_json));
  } catch {
    return null;
  }
}

export async function saveProfile(domain: string, profile: ScraperProfileConfig, env: Env): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    contentSelectors: profile.contentSelectors,
    removeSelectors: profile.removeSelectors,
    minLength: profile.minLength ?? 40,
    confidence: profile.confidence ?? 0.5,
    source: 'ai' as const,
    sampleUrl: profile.sampleUrl,
    updatedAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO scraper_configs (domain, mode, config_json, learned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(domain, mode) DO UPDATE SET
       config_json = excluded.config_json,
       learned_at = excluded.learned_at`
  ).bind(domain, 'html', JSON.stringify(payload), now).run();
}

// ── Profile normalisation ───────────────────────────────────────────────────

export function normalizeProfile(profile: ScraperProfileConfig): SiteProfile {
  return {
    contentSelectors: profile.contentSelectors,
    removeSelectors: profile.removeSelectors,
    minLength: profile.minLength ?? 40,
  };
}

// ── Acceptance helpers ──────────────────────────────────────────────────────

export interface ExtractResult {
  text: string;
  paragraphs: number;
  anyContentSelectorMatched: boolean;
}

export function shouldAcceptCandidate(candidate: ExtractResult, baseline: ExtractResult, minLength = 40): boolean {
  if (!candidate.text) return false;
  if (isLikelyNoisyContent(candidate.text)) return false;

  const minChars = Math.max(240, minLength * 6);
  if (candidate.text.length < minChars) return false;

  if (baseline.text.length === 0) return true;
  return candidate.text.length >= Math.floor(baseline.text.length * 0.85);
}

function isLikelyNoisyContent(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  const noiseMarkers = [
    'cookie',
    'privacy policy',
    'subscribe',
    'advertisement',
    'all rights reserved',
    'sign in',
    'log in',
    'newsletter',
  ];
  let hits = 0;
  for (const marker of noiseMarkers) {
    if (lower.includes(marker)) hits++;
  }
  return hits >= 4;
}

export function isLikelyArticlePage(pageUrl: string, html: string): boolean {
  try {
    const u = new URL(pageUrl);
    const path = u.pathname.toLowerCase().replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);

    if (segments.length < 2) return false;
    if (/(^|\/)(category|categories|tag|tags|author|authors|topics|topic)(\/|$)/.test(path)) return false;
    if (/\/page\/\d+\/?$/.test(path)) return false;
    // Loại trừ trang utility không phải bài viết
    if (/(^|\/)(docs|documentation|help|faq|about|careers|privacy|terms|contact|search|pricing|changelog)(\/|$)/.test(path)) return false;

    const compact = html.replace(/\s+/g, ' ').slice(0, 200000).toLowerCase();

    // Schema.org — tín hiệu mạnh nhất
    if (compact.includes('"@type":"blogposting"') || compact.includes('"@type": "blogposting"')) return true;
    if (compact.includes('"@type":"newsarticle"') || compact.includes('"@type": "newsarticle"')) return true;

    // Open Graph article type
    if (/property=["']og:type["'][^>]*content=["']article["']/i.test(compact) ||
        /content=["']article["'][^>]*property=["']og:type["']/i.test(compact)) return true;

    // Có thẻ <article> với nội dung thực
    if (/<article[^>]*>[\s\S]{200,}<\/article>/i.test(html)) return true;

    // Không có tín hiệu mạnh → không kích hoạt AI
    return false;
  } catch {
    return false;
  }
}
