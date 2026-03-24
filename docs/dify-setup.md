# Hướng dẫn Setup Dify Workflow cho NewsDigest

## Tổng quan

NewsDigest dùng **Dify Workflow** để xử lý AI. Workflow hoạt động theo flow deterministic: các bước fetch/lưu dữ liệu dùng **HTTP Request node** (không cần AI), chỉ bước tóm tắt + chấm điểm mới dùng **LLM node**.

### Kiến trúc

```
Dify Workflow (deterministic)
  │  1. [HTTP] POST /api/sources/fetch-all    → Fetch bài từ tất cả sources
  │  2. [HTTP] GET  /api/articles?unsummarized=1  → Lấy bài chưa tóm tắt
  │  3. [Code] Parse JSON response             → Format cho LLM
  │  4. [IF]   Has articles?                   → Kiểm tra có bài không
  │  5. [LLM]  Summarize + Score + Digest      → AI tóm tắt (1 lần gọi duy nhất)
  │  6. [Code] Parse LLM output                → Tạo payloads
  │  7. [HTTP] POST /api/articles/summarize     → Lưu summaries
  │  8. [HTTP] POST /api/digest                 → Lưu digest
  ▼
Cloudflare Worker (Hono)
  ├── API routes    (/api/*)
  ├── Cron trigger  (mỗi 3 giờ — round-robin fetch sources)
  ├── Scraper       (RSS, Reddit, YouTube, VOZ)
  └── Web Push      (VAPID, RFC 8291)
```

> **Ưu điểm so với Agent**: Không tốn token AI cho reasoning/tool selection. AI chỉ chạy 1 lần để tóm tắt. Deterministic, không bị bỏ bước.

## Yêu cầu

- Tài khoản [Dify](https://cloud.dify.ai) (Free plan)
- Model provider đã thêm vào Dify (ví dụ: Google Gemini)
- Worker API đã deploy: `https://newsdigest.trongnguyenchromeos.workers.dev`

---

## Bước 1: Thêm Model Provider

1. Vào Dify → **Settings** → **Model Provider**
2. Click **+ Add Model Provider** → chọn provider (Google Gemini, OpenRouter, etc.)
3. Nhập API key → **Save**

---

## Bước 2: Import Workflow

1. Vào **Studio** → **Create App** → chọn **Import DSL**
2. Upload file `Daily AI News Digest.yml` từ root dự án
3. Dify sẽ tạo workflow với đầy đủ nodes

---

## Bước 3: Kiểm tra Workflow

Sau khi import, verify các node:

### Sơ đồ Workflow

```
Start
  │
  ▼
[HTTP] Fetch All Sources ── POST /api/sources/fetch-all
  │
  ▼
[HTTP] Get Unsummarized ─── GET /api/articles?unsummarized=1&limit=30
  │
  ▼
[Code] Parse Articles ───── Parse JSON, format text cho LLM, đếm bài
  │
  ▼
[IF] Has Articles? ──────── article_count > 0 ?
  │           │
  │(Yes)      │(No)
  ▼           ▼
[LLM]       End
Summarize
  │
  ▼
[Code] Parse LLM Output ── Trích JSON, tạo payloads
  │
  ▼
[HTTP] Save Summaries ───── POST /api/articles/summarize
  │
  ▼
[HTTP] Save Digest ──────── POST /api/digest
  │
  ▼
End
```

---

### Node 1: `Fetch All Sources` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/sources/fetch-all`
- **Body**: none
- **Timeout read**: 120s (fetch nhiều sources có thể chậm)

### Node 2: `Get Unsummarized Articles` (HTTP Request)

- **Method**: GET
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles?unsummarized=1&limit=30`

### Node 3: `Parse Articles` (Code - Python)

- **Input**: `body` ← response body từ node Get Unsummarized
- **Output**: `articles_text` (string), `article_count` (number)
- **Logic**: Parse JSON, format mỗi bài thành `ID / Title / Content` (giới hạn 2000 ký tự/bài)

### Node 4: `Has Articles?` (IF-ELSE)

- **Condition**: `article_count` > 0
- **True** → tiếp tục LLM
- **False** → End (không có bài mới)

### Node 5: `AI Summarize & Score` (LLM)

- **Model**: `gemini-3-flash-preview` (hoặc model tương đương)
- **Nhiệm vụ**: Trong 1 lần gọi duy nhất:
  1. Tóm tắt mỗi bài (tiếng Việt, 2-3 câu)
  2. Chấm `hot_score` (1-10)
  3. Gắn tags (tối đa 3)
  4. Viết digest 3-5 câu xu hướng nổi bật
  5. Chọn 3-5 bài hot nhất
- **Output**: JSON có cấu trúc `{ summaries, digest_text, top_article_ids }`

### Node 6: `Parse LLM Output` (Code - Python)

- **Input**: `llm_output` ← text từ LLM node
- **Output**: `summaries_payload` (JSON string), `digest_payload` (JSON string)
- **Logic**: Trích JSON từ markdown code block, build 2 payload cho 2 HTTP request tiếp theo

### Node 7: `Save Summaries` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles/summarize`
- **Headers**: `Content-Type: application/json`
- **Body**: raw-text → `{{#parse_output.summaries_payload#}}`

### Node 8: `Save Digest` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/digest`
- **Headers**: `Content-Type: application/json`
- **Body**: raw-text → `{{#parse_output.digest_payload#}}`

---

## Bước 4: Chạy Workflow

### Chạy thủ công

Click **Run** (▶) ở góc trên phải.

### Scheduled Trigger (tự động)

1. Thêm **Trigger** node loại **Schedule**
2. Set cron: mỗi 3-6 giờ
3. Nối trigger → node `Fetch All Sources`

---

## Bước 5: Test

1. Click **Run** trên Workflow
2. Kiểm tra từng node:
   - `Fetch All Sources` → `{ ok: true, total_fetched: N }`
   - `Get Unsummarized` → `{ articles: [...], total: N }`
   - `Parse Articles` → `article_count > 0`, `articles_text` có nội dung
   - `Has Articles?` → đi nhánh True
   - `AI Summarize & Score` → JSON output hợp lệ
   - `Parse LLM Output` → 2 payload JSON
   - `Save Summaries` → `{ ok: true, updated: N }`
   - `Save Digest` → `{ ok: true, digestId: "..." }`

---

## So sánh: Workflow mới vs Agent cũ

| | Agent cũ | Workflow mới |
|---|---------|-------------|
| AI calls | 6+ (ReAct reasoning cho mỗi tool) | **1** (chỉ summarize) |
| Token tiêu thụ | Rất nhiều | Tiết kiệm 70-80% |
| Độ tin cậy | Agent có thể bỏ bước / sai thứ tự | Deterministic |
| Error handling | Agent tự xử lý (unreliable) | IF-ELSE + Code fallback |
| Max iterations | Cần 15 | Không cần |

---

## API Reference

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/sources` | GET | Danh sách nguồn tin |
| `/api/sources` | POST | Thêm nguồn mới `{ url, name?, group_name? }` |
| `/api/sources/:id` | PATCH | Cập nhật nguồn `{ enabled?, name?, group_name? }` |
| `/api/sources/:id` | DELETE | Xóa nguồn |
| `/api/sources/:id/fetch` | POST | Fetch bài từ nguồn (gọi scraper) |
| `/api/sources/fetch-all` | POST | Fetch bài từ tất cả sources enabled |
| `/api/articles` | GET | Bài viết (filter: `tag`, `source_id`, `min_hot`, `sort`, `bookmarked`, `unsummarized`, `compact`, `ids`, `page`, `limit`) |
| `/api/articles/:id` | GET | Chi tiết 1 bài |
| `/api/articles/:id/bookmark` | PATCH | Bookmark `{ bookmarked: true/false }` |
| `/api/articles/:id/read` | PATCH | Đánh dấu đã đọc |
| `/api/articles/enrich` | POST | Fetch nội dung bài gốc `{ ids: [...], force? }` |
| `/api/articles/summarize` | POST | Gửi kết quả AI tóm tắt (Dify → Worker) |
| `/api/digest` | POST | Tạo digest mới |
| `/api/digest/latest` | GET | Digest mới nhất + top articles |
| `/api/push/vapid-public-key` | GET | Lấy VAPID public key |
| `/api/push/subscribe` | POST | Đăng ký push notification |
| `/api/push/unsubscribe` | DELETE | Hủy đăng ký push |

**Base URL**: `https://newsdigest.trongnguyenchromeos.workers.dev`

---

## Cấu trúc Worker hiện tại

```
worker/
├── index.ts           # Entry: route fetch → API, scheduled → Cron
├── types.ts           # Env, Article, Source, ArticleInput
├── api/
│   └── index.ts       # Hono router — tất cả API endpoints
├── cron/
│   ├── index.ts       # Cron scheduler — round-robin fetch
│   └── scraper.ts     # RSS, Reddit, YouTube, VOZ adapters
└── push/
    └── index.ts       # Web Push (RFC 8291 + VAPID)
```

### Bindings (wrangler.toml)

| Binding | Type | Mô tả |
|---|---|---|
| `DB` | D1 | Database chính (sources, articles, digests) |
| `SCRAPER_CONFIG` | KV | Lưu cron round-robin index |
| `PUSH_SUBSCRIPTIONS` | KV | Lưu Web Push subscriptions |

### Cron

Worker cron chạy **mỗi 3 giờ** (`0 */3 * * *`), round-robin fetch 1 source mỗi lần. Chỉ fetch và insert bài, **không tự summarize** — phần AI do Dify workflow xử lý.

---

## Scraper hỗ trợ

| Type | Cách hoạt động |
|---|---|
| `rss` | Parse RSS/Atom feed bằng `fast-xml-parser` |
| `reddit` | Reddit JSON API (`/new.json?limit=25`) |
| `youtube` | YouTube Data API v3 (playlistItems — 1 unit/request) |
| `voz` | HTMLRewriter parse `.structItem` |
| `html` | Chưa implement (fallback trả về `[]`) |

---

## Troubleshooting

- **HTTP node lỗi kết nối**: Kiểm tra URL trong node config. Worker đã có CORS middleware.
- **Không có bài mới**: Cần thêm sources trước (qua frontend hoặc `POST /api/sources`).
- **LLM output parse lỗi**: Code node có fallback tìm JSON trong markdown code block. Kiểm tra LLM system prompt yêu cầu output JSON.
- **Tóm tắt bị sai ngôn ngữ**: Đảm bảo LLM system prompt yêu cầu "tóm tắt bằng tiếng Việt".
- **YouTube không fetch được**: Cần set `YOUTUBE_API_KEY` qua `wrangler secret put YOUTUBE_API_KEY`.
- **Push notification không gửi**: Cần set VAPID keys qua `wrangler secret put VAPID_PUBLIC_KEY` và `VAPID_PRIVATE_KEY`.
