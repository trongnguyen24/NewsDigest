export interface RedditSource {
  id: string;
  url: string;
  name: string;
  type: string;
  enabled: number | boolean;
  last_fetched_at?: string | null;
}

export interface ListingArticle {
  url: string;
  title: string;
  score: number;
  num_comments: number;
  selftext_preview?: string;
}

export interface InsertedArticle {
  articleId: string;
  url: string;
}

export interface PushListingResponse {
  ok: boolean;
  inserted: InsertedArticle[];
  updated: number;
  skipped: number;
  last_fetched_at?: string;
}

export interface PushContentResponse {
  ok: boolean;
  received: number;
  enqueued: number;
}

export interface ScrapedPost {
  content: string;
}

export interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'success' | 'error';
  message: string;
}

export interface ScrapeStatus {
  running: boolean;
  phase: 'idle' | 'listing' | 'content' | 'done' | 'error' | 'cancelled';
  currentSource?: string;
  contentIndex: number;
  contentTotal: number;
  sourcesTotal: number;
  sourcesDone: number;
  listingsFound: number;
  inserted: number;
  enqueued: number;
  errors: number;
  startedAt?: string;
  completedAt?: string;
  log: LogEntry[];
}

export interface StartScrapeMessage {
  action: 'start-scrape';
  apiUrl: string;
  adminKey: string;
}

export interface GetStatusMessage {
  action: 'get-status';
}

export interface CancelScrapeMessage {
  action: 'cancel-scrape';
}

export type PopupMessage = StartScrapeMessage | GetStatusMessage | CancelScrapeMessage;

export type ContentScriptMessage =
  | { action: 'ping' }
  | { action: 'scrape-listing' }
  | { action: 'scrape-post' };
