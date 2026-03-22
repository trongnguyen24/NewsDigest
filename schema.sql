-- Nguồn tin do user thêm vào
CREATE TABLE sources (
  id          TEXT PRIMARY KEY,         -- UUID
  url         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,            -- 'rss' | 'html' | 'reddit' | 'youtube' | 'voz'
  enabled     INTEGER NOT NULL DEFAULT 1,
  group_name  TEXT,                     -- nhóm chủ đề do user đặt, vd: "Tech", "AI"
  last_fetched_at TEXT,                 -- ISO 8601
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cấu hình scraper đã học (cache selector theo domain)
CREATE TABLE scraper_configs (
  domain      TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,            -- 'rss' | 'html' | 'gemini'
  config_json TEXT NOT NULL,            -- JSON: { rssUrl?, selectors? }
  learned_at  TEXT NOT NULL
);

-- Bài viết đã thu thập
CREATE TABLE articles (
  id          TEXT PRIMARY KEY,         -- UUID
  source_id   TEXT NOT NULL REFERENCES sources(id),
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,                     -- tóm tắt AI (nullable, điền sau)
  full_text   TEXT,                     -- nội dung gốc (optional)
  hot_score   INTEGER,                  -- 1–10, do AI chấm
  tags        TEXT,                     -- JSON array: ["AI", "Security"]
  published_at TEXT,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_bookmarked INTEGER NOT NULL DEFAULT 0,
  is_read     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_id, url)               -- dedup theo source + url
);

-- Digest report được tạo mỗi giờ
CREATE TABLE digests (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  period_start TEXT NOT NULL,           -- giờ bắt đầu kỳ fetch
  period_end   TEXT NOT NULL,
  summary_text TEXT NOT NULL,           -- tổng hợp AI viết
  top_article_ids TEXT NOT NULL,        -- JSON array of article IDs
  total_fetched INTEGER NOT NULL DEFAULT 0
);

-- Index để query nhanh
CREATE INDEX idx_articles_source    ON articles(source_id);
CREATE INDEX idx_articles_hot       ON articles(hot_score DESC);
CREATE INDEX idx_articles_fetched   ON articles(fetched_at DESC);
CREATE INDEX idx_articles_published ON articles(published_at DESC);
