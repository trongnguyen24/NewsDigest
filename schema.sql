-- Nguồn tin do user thêm vào
CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,         -- UUID
  url         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,            -- 'rss' | 'html' | 'reddit' | 'youtube' | 'voz'
  enabled     INTEGER NOT NULL DEFAULT 1,
  channel_id  TEXT,                     -- YouTube channel_id (e.g. 'UCZRoNJu1OszFqABP8AuJIuw'), NULL cho non-YouTube sources
  last_fetched_at TEXT,                 -- ISO 8601
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cấu hình scraper đã học (cache selector theo domain)
CREATE TABLE IF NOT EXISTS scraper_configs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT NOT NULL,
  mode        TEXT NOT NULL,            -- 'html' | 'listing'
  config_json TEXT NOT NULL,
  learned_at  TEXT NOT NULL,
  UNIQUE(domain, mode)
);

-- Bài viết đã thu thập
CREATE TABLE IF NOT EXISTS articles (
  id          TEXT PRIMARY KEY,         -- UUID
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,                     -- tóm tắt AI (nullable, điền sau)
  description TEXT,                     -- mô tả ngắn từ RSS/API
  description_vn TEXT,                  -- mô tả tiếng Việt do AI sinh
  content     TEXT,                     -- nội dung đầy đủ được cào (optional)
  hot_score   INTEGER,                  -- 1–10, do AI chấm
  tags        TEXT,                     -- JSON array: ["AI", "Security"]
  published_at TEXT,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, url)               -- dedup theo source + url
);

-- Digest tổng hợp theo ngày (mỗi ngày 1 digest, cập nhật liên tục)
CREATE TABLE IF NOT EXISTS digests (
  id          TEXT PRIMARY KEY,
  digest_date TEXT NOT NULL UNIQUE,     -- YYYY-MM-DD, mỗi ngày 1 digest
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  summary_text TEXT NOT NULL,           -- tổng hợp AI viết, chứa inline <id:uuid>
  total_fetched INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_digests_date ON digests(digest_date);

-- Index để query nhanh
CREATE INDEX IF NOT EXISTS idx_articles_source    ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_hot       ON articles(hot_score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_fetched   ON articles(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
