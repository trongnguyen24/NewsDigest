# Hướng dẫn Setup Dify Agent cho NewsDigest

## Tổng quan

NewsDigest dùng **Dify agent** thay cho AI Worker nội bộ. Agent hoạt động như một **AI news reader** — gọi API của Cloudflare Worker để fetch bài, đọc nội dung, tóm tắt + chấm điểm, rồi gửi kết quả về lại Worker lưu vào D1.

### Kiến trúc

```
Dify Agent (AI)
  │  1. get_sources         → Worker API
  │  2. fetch_source_articles → Worker API → Cron scraper
  │  3. get_unsummarized_articles → Worker API
  │  4. [Agent tự tóm tắt + chấm điểm]
  │  5. save_summaries      → Worker API → D1
  │  6. save_digest          → Worker API → D1
  ▼
Cloudflare Worker (Hono)
  ├── API routes    (/api/*)
  ├── Cron trigger  (mỗi 3 giờ — round-robin fetch sources)
  ├── Scraper       (RSS, Reddit, YouTube, VOZ)
  └── Web Push      (VAPID, RFC 8291)
```

> **Lưu ý:** Dự án hiện tại **không dùng** CF Queues hay AI Worker riêng. Toàn bộ AI processing do Dify agent đảm nhận qua API.

## Yêu cầu

- Tài khoản [Dify](https://cloud.dify.ai) (Free plan)
- OpenRouter API key đã thêm vào Dify (Model Provider)
- Worker API đã deploy: `https://newsdigest.trongnguyenchromeos.workers.dev`

---

## Bước 1: Thêm Model Provider

1. Vào Dify → **Settings** → **Model Provider**
2. Click **+ Add Model Provider** → chọn **OpenRouter**
3. Nhập API key → **Save**

---

## Bước 2: Tạo Agent App

1. Vào **Studio** → **Create App** → chọn **Agent**
2. Đặt tên: `NewsDigest Reader`
3. Chọn model: gợi ý `google/gemini-2.0-flash` hoặc `meta-llama/llama-4-maverick`

---

## Bước 3: Tạo Custom Tools

Dify dùng **OpenAPI Schema** để định nghĩa custom tools. Bạn chỉ cần paste 1 schema JSON duy nhất, Dify sẽ tự parse ra 5 tools.

1. Vào tab **Tools** → **Custom** → **Create Custom Tool**
2. Đặt tên: `NewsDigest API`
3. Paste schema sau vào ô **Schema**:

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "NewsDigest API",
    "version": "1.0.0",
    "description": "API cho Dify agent đọc và xử lý tin tức"
  },
  "servers": [
    {
      "url": "https://newsdigest.trongnguyenchromeos.workers.dev"
    }
  ],
  "paths": {
    "/api/sources": {
      "get": {
        "operationId": "getSources",
        "summary": "Lấy danh sách tất cả nguồn tin đã đăng ký",
        "responses": {
          "200": {
            "description": "Danh sách sources",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "sources": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": { "type": "string" },
                          "url": { "type": "string" },
                          "name": { "type": "string" },
                          "type": { "type": "string" },
                          "enabled": { "type": "integer" },
                          "group_name": { "type": "string" },
                          "last_fetched_at": { "type": "string", "nullable": true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/sources/fetch-all": {
      "post": {
        "operationId": "fetchAllSources",
        "summary": "Fetch bài mới từ TẤT CẢ nguồn tin đang enabled trong 1 lần gọi",
        "responses": {
          "200": {
            "description": "Kết quả fetch tất cả sources",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": { "type": "boolean" },
                    "total_fetched": { "type": "integer" },
                    "total_inserted": { "type": "integer" },
                    "results": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "source_id": { "type": "string" },
                          "name": { "type": "string" },
                          "fetched": { "type": "integer" },
                          "inserted": { "type": "integer" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/articles": {
      "get": {
        "operationId": "getUnsummarizedArticles",
        "summary": "Lấy bài viết chưa được AI tóm tắt",
        "parameters": [
          {
            "name": "unsummarized",
            "in": "query",
            "schema": { "type": "string", "default": "1" },
            "description": "Set 1 để chỉ lấy bài chưa tóm tắt"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": { "type": "integer", "default": 30 },
            "description": "Số bài tối đa trả về (max 50)"
          },
          {
            "name": "page",
            "in": "query",
            "schema": { "type": "integer", "default": 1 },
            "description": "Trang"
          }
        ],
        "responses": {
          "200": {
            "description": "Danh sách bài viết",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "articles": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": { "type": "string" },
                          "title": { "type": "string" },
                          "url": { "type": "string" },
                          "full_text": { "type": "string" },
                          "source_id": { "type": "string" },
                          "published_at": { "type": "string" }
                        }
                      }
                    },
                    "total": { "type": "integer" },
                    "page": { "type": "integer" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/articles/summarize": {
      "post": {
        "operationId": "saveSummaries",
        "summary": "Gửi kết quả tóm tắt AI về Worker lưu vào D1",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["results"],
                "properties": {
                  "results": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": ["id", "summary"],
                      "properties": {
                        "id": { "type": "string", "description": "Article ID" },
                        "summary": { "type": "string", "description": "Tóm tắt 2-3 câu" },
                        "hot_score": { "type": "integer", "description": "Điểm 1-10", "minimum": 1, "maximum": 10 },
                        "tags": {
                          "type": "array",
                          "items": { "type": "string" },
                          "description": "Tags: AI, Tech, Security, Business, Vietnam, World, Dev, Science, Crypto, Policy, Entertainment"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": { "type": "boolean" },
                    "updated": { "type": "integer" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/digest": {
      "post": {
        "operationId": "saveDigest",
        "summary": "Lưu bài tổng hợp digest vào D1",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["summary_text"],
                "properties": {
                  "summary_text": { "type": "string", "description": "Đoạn tổng hợp 3-5 câu" },
                  "top_article_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Danh sách article IDs nổi bật"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": { "type": "boolean" },
                    "digestId": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

4. Dify sẽ parse ra 5 tools trong bảng **Available Tools**:
   - `getSources` — GET danh sách nguồn tin
   - `fetchAllSources` — POST fetch bài từ **tất cả** sources (1 lần gọi)
   - `getUnsummarizedArticles` — GET bài chưa tóm tắt
   - `saveSummaries` — POST kết quả AI tóm tắt
   - `saveDigest` — POST digest tổng hợp
5. Authorization method: **None** (Worker đã có CORS, không cần auth)
6. Click **Save**

---

## Bước 4: Tạo Workflow

> **Tại sao Workflow?** Agent node yêu cầu model tự quyết định gọi tool nào → dễ bị dừng giữa chừng. Workflow chia từng bước thành node riêng biệt, đáng tin cậy hơn nhiều.

Vào **Studio** → **Create App** → chọn **Workflow** → đặt tên `NewsDigest Pipeline`.

### Sơ đồ Workflow (2-pass)

```
Start
  │
  ▼
[HTTP] fetch_all ──── POST /api/sources/fetch-all
  │
  ▼
[HTTP] get_titles ─── GET /api/articles?unsummarized=1&compact=1&limit=50
  │                   (chỉ trả id, title, url — KHÔNG full_text)
  ▼
[LLM] screen ──────── Scan tiêu đề, chọn bài hay → trả về danh sách IDs
  │
  ▼
[Code] extract_ids ── Parse JSON → tạo chuỗi ids
  │
  ▼
[HTTP] enrich ─────── POST /api/articles/enrich {ids: [...]}
  │                   (fetch nội dung bài gốc từ URL)
  ▼
[HTTP] get_full ───── GET /api/articles?ids={{ids}}
  ▼
[LLM] summarize ───── Tóm tắt + chấm điểm + gắn tags
  │
  ▼
[HTTP] save_summaries ── POST /api/articles/summarize
  │
  ▼
[LLM] write_digest ──── Viết digest tổng hợp
  │
  ▼
[HTTP] save_digest ───── POST /api/digest
  │
  ▼
End
```

> **Ưu điểm 2-pass**: Pass 1 gửi ~50 tiêu đề (rất nhẹ) cho LLM lọc. Pass 2 chỉ gửi full_text ~10-15 bài hay → tiết kiệm 70-80% token.

---

### Node 1: `fetch_all` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/sources/fetch-all`

### Node 2: `get_titles` (HTTP Request)

- **Method**: GET
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles?unsummarized=1&compact=1&limit=50`

> `compact=1` chỉ trả về `id, title, url, source_id, published_at` — không có `full_text`.

### Node 3: `screen` (LLM)

- **Model**: model rẻ nhất có thể (ví dụ `gemini-2.0-flash`)
- **Input variable**: `titles` ← output body của node `get_titles`
- **System Prompt**:

```
Bạn là biên tập viên. Đọc danh sách tiêu đề bài viết và chọn những bài ĐÁNG ĐỌC SÂU.

Tiêu chí chọn:
- Tin quan trọng, có giá trị thông tin cao
- Công nghệ mới, AI breakthrough, security issue
- Sự kiện lớn, trending
- Bỏ qua bài spam, quảng cáo, click-bait, trùng lặp

Trả về ĐÚNG JSON format (không thêm gì khác):
{"selected_ids": ["id1", "id2", "id3"]}

Chọn tối đa 15 bài hay nhất.
```

- **User Prompt**: `{{titles}}`

### Node 4: `extract_ids` (Code)

- **Language**: Python
- **Input**: `screen_output` ← output text từ node `screen`
- **Code**:

```python
import json

def main(screen_output: str) -> dict:
    try:
        data = json.loads(screen_output)
        ids = data.get("selected_ids", [])
        return {
            "ids": ",".join(ids),
            "ids_json": json.dumps(ids)
        }
    except:
        return {"ids": "", "ids_json": "[]"}
```

- **Output**: `ids` (comma-separated cho GET), `ids_json` (JSON array cho POST enrich)

### Node 5: `enrich` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles/enrich`
- **Headers**: `Content-Type: application/json`
- **Body**: `{"ids": {{ids_json}}}`

> Endpoint này fetch nội dung bài gốc từ URL và update `full_text` vào DB. Fetch song song 5 bài cùng lúc, timeout 8s/bài.

### Node 6: `get_full` (HTTP Request)

- **Method**: GET
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles?ids={{ids}}`

> Giờ articles đã có `full_text` đầy đủ nhờ bước enrich.

### Node 7: `summarize` (LLM)

- **Model**: `gemini-2.0-flash` hoặc tương đương
- **Input variable**: `articles` ← output body của node `get_full`
- **System Prompt**:

```
Đọc full_text từng bài viết và tóm tắt. Với MỖI bài, trả về:
- id: giữ nguyên article id
- summary: tóm tắt 2-3 câu bằng tiếng Việt
- hot_score: 1-10 (10=viral, 7-8=hay, 5-6=bình thường, 1-3=nhàm/spam)
- tags: tối đa 3 từ: AI, Tech, Security, Business, Vietnam, World, Dev, Science, Crypto, Policy, Entertainment

Giữ nguyên thuật ngữ kỹ thuật. Nếu bài tiếng Anh, dịch tóm tắt sang tiếng Việt.

Trả về ĐÚNG JSON format:
{"results": [{"id": "...", "summary": "...", "hot_score": 7, "tags": ["Tech", "AI"]}]}
```

- **User Prompt**: `{{articles}}`

### Node 7: `save_summaries` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles/summarize`
- **Headers**: `Content-Type: application/json`
- **Body**: output text từ node `summarize`

### Node 8: `write_digest` (LLM)

- **Input variable**: `summaries` ← output từ node `summarize`
- **System Prompt**:

```
Dựa trên kết quả tóm tắt, viết 1 đoạn digest 3-5 câu bằng tiếng Việt. Nêu xu hướng nổi bật nhất.

Trả về JSON format:
{"summary_text": "...", "top_article_ids": ["id1", "id2", "id3"]}

Chọn 3-5 bài có hot_score cao nhất làm top_article_ids.
```

- **User Prompt**: `{{summaries}}`

### Node 9: `save_digest` (HTTP Request)

- **Method**: POST
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/digest`
- **Headers**: `Content-Type: application/json`
- **Body**: output text từ node `write_digest`

---

## Bước 5: Chạy Workflow

### Chạy thủ công

Click **Run** (▶) ở góc trên phải.

### Scheduled Trigger (tự động)

1. Thêm **Trigger** node loại **Schedule**
2. Set cron: mỗi 3-6 giờ
3. Nối trigger → node `fetch_all`

---

## Bước 6: Test

1. Click **Run** trên Workflow
2. Kiểm tra từng node:
   - `fetch_all` → `{ ok: true, total_fetched: N }`
   - `get_titles` → danh sách bài chỉ có title (compact)
   - `screen` → `{ selected_ids: ["...", "..."] }`
   - `get_full` → full_text các bài đã chọn
   - `summarize` → JSON results
   - `save_summaries` → `{ ok: true, updated: N }`
   - `write_digest` → JSON digest
   - `save_digest` → `{ ok: true, digestId: "..." }`

---

## API Reference

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/sources` | GET | Danh sách nguồn tin |
| `/api/sources` | POST | Thêm nguồn mới `{ url, name?, group_name? }` |
| `/api/sources/:id` | PATCH | Cập nhật nguồn `{ enabled?, name?, group_name? }` |
| `/api/sources/:id` | DELETE | Xóa nguồn |
| `/api/sources/:id/fetch` | POST | Fetch bài từ nguồn (gọi scraper) |
| `/api/articles` | GET | Bài viết (filter: `tag`, `source_id`, `min_hot`, `sort`, `bookmarked`, `unsummarized`, `page`, `limit`) |
| `/api/articles/:id` | GET | Chi tiết 1 bài |
| `/api/articles/:id/bookmark` | PATCH | Bookmark `{ bookmarked: true/false }` |
| `/api/articles/:id/read` | PATCH | Đánh dấu đã đọc |
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

Worker cron chạy **mỗi 3 giờ** (`0 */3 * * *`), round-robin fetch 1 source mỗi lần. Chỉ fetch và insert bài, **không tự summarize** — phần AI do Dify agent xử lý.

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

- **Agent không gọi được API**: Kiểm tra URL trong tool config. Worker đã có CORS middleware.
- **Không có bài mới**: Cần thêm sources trước (qua frontend hoặc `POST /api/sources`).
- **Tóm tắt bị sai ngôn ngữ**: Đảm bảo system prompt yêu cầu "tóm tắt bằng tiếng Việt".
- **YouTube không fetch được**: Cần set `YOUTUBE_API_KEY` qua `wrangler secret put YOUTUBE_API_KEY`.
- **Push notification không gửi**: Cần set VAPID keys qua `wrangler secret put VAPID_PUBLIC_KEY` và `VAPID_PRIVATE_KEY`.
