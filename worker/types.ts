export interface Env {
  DB: D1Database;
  SCRAPER_CONFIG: KVNamespace;
  PUSH_SUBSCRIPTIONS: KVNamespace;
  CONTENT_QUEUE: Queue;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  YOUTUBE_API_KEY: string;
  RAPIDAPI_KEY: string;
  CONTENT_SERVICE_URL: string;
  CONTENT_SERVICE_KEY: string;
  AI_GATEWAY_TOKEN: string;   // single token (fallback)
  AI_GATEWAY_TOKENS?: string;  // comma-separated tokens for rotation
  AI_GATEWAY_URL: string;
  ADMIN_API_KEY?: string;
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
  type: 'rss' | 'html' | 'reddit' | 'youtube' | 'voz';
  enabled: number;
  group_name: string | null;
  last_fetched_at: string | null;
  created_at: string;
}

export interface ArticleInput {
  url: string;
  title: string;
  description?: string;
  published_at?: string;
}
