export interface Env {
  DB: D1Database;
  SCRAPER_CONFIG: KVNamespace;
  CONTENT_QUEUE: Queue;
  RAPIDAPI_KEY: string;
  YOUTUBE_API_KEY?: string;
  AI_GATEWAY_TOKEN: string;
  AI_GATEWAY_URL: string;
  ADMIN_API_KEY?: string;

  // ── Prompt configuration (all optional — see worker/ai/prompt-config.ts) ──
  /** Full language name for AI output, e.g. "Vietnamese", "English". Default: "Vietnamese" */
  PROMPT_OUTPUT_LANGUAGE?: string;
  /** Comma-separated topic priorities for hot_score boosting. */
  PROMPT_TOPIC_PRIORITIES?: string;
  /** Comma-separated whitelist of tags the AI can assign. */
  PROMPT_ALLOWED_TAGS?: string;
  /** Comma-separated suggested ## heading groups for the daily digest. */
  PROMPT_DIGEST_HEADINGS?: string;
  /** Optional plain-text extra context appended to system prompts. */
  PROMPT_CUSTOM_CONTEXT?: string;
}

export interface ScraperProfileConfig {
  contentSelectors: string[];
  removeSelectors: string[];
  minLength?: number;
  confidence?: number;
  source: 'ai';
  sampleUrl: string;
  updatedAt: string;
}

export interface ListingProfileConfig {
  linkSelectors: string[];
  removeSelectors: string[];
  confidence?: number;
  source: 'ai';
  sampleUrl: string;
  updatedAt: string;
}

export interface ContentScrapeMessage {
  articleId: string;
  url: string;
  title: string;
}

export interface Article {
  id: string;
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  description: string | null;
  description_vn: string | null;
  content: string | null;
  hot_score: number | null;
  tags: string | null;
  published_at: string | null;
  fetched_at: string;
}

export interface Source {
  id: string;
  url: string;
  name: string;
  type: 'rss' | 'html' | 'reddit' | 'youtube' | 'voz' | 'github-trending';
  enabled: number;
  channel_id: string | null;
  last_fetched_at: string | null;
  created_at: string;
}

export interface ArticleInput {
  url: string;
  title: string;
  description?: string;
  published_at?: string;
  /** Full HTML content from RSS content:encoded (e.g. WordPress blogs). Strip HTML before using. */
  contentEncoded?: string;
  /** Reddit-only: raw upvote score */
  reddit_score?: number;
  /** Reddit-only: raw comment count */
  reddit_comments?: number;
}
