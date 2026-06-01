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

export interface FailedRedditArticle {
  articleId: string;
  url: string;
  title: string;
  hasContent: boolean;
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
  phase: 'idle' | 'listing' | 'content' | 'retrying' | 'done' | 'error' | 'cancelled';
  currentSource?: string;
  contentIndex: number;
  contentTotal: number;
  sourcesTotal: number;
  sourcesDone: number;
  listingsFound: number;
  inserted: number;
  enqueued: number;
  errors: number;
  retryTotal: number;
  retryDone: number;
  retrySkipped: number;
  startedAt?: string;
  completedAt?: string;
  log: LogEntry[];
}

export interface StartScrapeMessage {
  action: 'start-scrape';
  apiUrl: string;
  adminKey: string;
}

export interface RetryFailedMessage {
  action: 'retry-failed';
  apiUrl: string;
  adminKey: string;
}

export interface GetStatusMessage {
  action: 'get-status';
}

export interface CancelScrapeMessage {
  action: 'cancel-scrape';
}

export interface ClearLogMessage {
  action: 'clear-log';
}

export type PopupMessage = StartScrapeMessage | RetryFailedMessage | GetStatusMessage | CancelScrapeMessage | ClearLogMessage;

export type ContentScriptMessage =
  | { action: 'ping' }
  | { action: 'scrape-listing' }
  | { action: 'scrape-post' }
  | { action: 'simulate-scroll' };
