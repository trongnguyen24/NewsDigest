# NewsDigest PWA — Project Specification

> Tài liệu này mô tả toàn bộ tính năng, kiến trúc, và lộ trình triển khai.
> Dùng làm input cho agent IDE để implement từng bước.

---

## Tổng quan dự án

**NewsDigest** là một Progressive Web App cá nhân, tự động thu thập tin tức từ nhiều nguồn (RSS, blog, Reddit, VOZ, YouTube), dùng AI tóm tắt và chấm điểm độ hot, sau đó báo cáo digest mỗi giờ cho người dùng.

### Chiến lược: Cloudflare + Dify hybrid

Dự án kết hợp **Cloudflare Workers** (fetch/API/push) với **Dify Workflow** (AI summarize/scoring) để **tối ưu chi phí**:

- **Cloudflare Workers** (Free tier): xử lý mọi logic không cần AI — fetch bài, API cho frontend, cron, push notification.
- **Dify Workflow** (Free tier + Gemini): xử lý phần AI — tóm tắt, chấm điểm, viết digest. Dùng HTTP Request nodes gọi API Worker + LLM node cho AI (chỉ 1 lần gọi).

> Cách này loại bỏ nhu cầu Vertex AI, CF Queues, và CF R2 trong giai đoạn MVP, giảm chi phí về gần ~$0.

### Tech stack

| Layer | Công nghệ |
|---|---|
| Frontend | SvelteKit + TypeScript |
| UI components | shadcn-svelte + Tailwind CSS v4 |
| Icons | lucide-svelte |
| Hosting frontend | Cloudflare Pages |
| Backend / API | Cloudflare Workers (Hono + TypeScript) |
| Scheduler | Cloudflare Workers Cron Trigger |
| Database | Cloudflare D1 (SQLite at edge) |
| KV Store | Cloudflare KV |
| AI tóm tắt + scoring | Dify Workflow (HTTP nodes + LLM node, Gemini Flash) |
| Push notification | Web Push API (VAPID) qua CF Worker |

### Kiến trúc tổng thể

```
[Nguồn tin]           [Cloudflare Edge]                    [Dify Workflow]
  RSS/Atom  ──────▶  Cron Worker (3h, round-robin)
  HTML Blog ──────▶    │ fetch + parse via scraper
  Reddit    ──────▶    │ dedup (INSERT OR IGNORE)
  YouTube   ──────▶    ▼
  VOZ       ──────▶  CF D1 (articles, sources, digests)
                       ▲                                   Dify Workflow:
                       │                                     [HTTP] fetch-all
[Frontend]             │                                     [HTTP] get articles
  SvelteKit PWA ────▶ API Worker (Hono)                     [Code] parse
  CF Pages             │ CORS                                [IF] has articles?
                       │ articles/sources/digest/push        [LLM] summarize (1 call)
                       ▼                                     [HTTP] save summaries
                     Web Push (VAPID, RFC 8291)              [HTTP] save digest
                       │
                     Browser notification
```

---

## Lộ trình

| Phase | Nội dung | Mục tiêu |
|---|---|---|
| **MVP** | Core features bên dưới | Hệ thống chạy end-to-end |
| **V1** | Nâng cao: trending, deep summarize, filter nâng cao | UX tốt hơn |
| **V2** | Personalized ranking, Telegram/Email digest, chat với tin tức | Mở rộng |

---

## Phase 1 — MVP Core

> Implement theo thứ tự các bước dưới đây. Mỗi bước là một đơn vị có thể test độc lập.

---

### Bước 1 — Khởi tạo project

#### 1.1 SvelteKit + Cloudflare Pages

```bash
npm create cloudflare@latest newsdigest -- --framework=sveltekit
cd newsdigest
```

Cấu hình `svelte.config.js` dùng `@sveltejs/adapter-cloudflare`.

#### 1.2 shadcn-svelte + Tailwind CSS v4

```bash
# Khởi tạo shadcn-svelte (chọn Tailwind v4 khi được hỏi)
npx shadcn-svelte@latest init

# Cài các components dùng trong MVP
npx shadcn-svelte@latest add button card badge input label
npx shadcn-svelte@latest add switch select separator skeleton
npx shadcn-svelte@latest add toast dialog dropdown-menu
npx shadcn-svelte@latest add scroll-area toggle tabs

# Icons
npm install lucide-svelte
```

`components.json` được tạo tự động, components nằm ở `src/lib/components/ui/`.
Khi cần component mới thêm sau: `npx shadcn-svelte@latest add {tên}`.

**Quy ước components:**
```
src/lib/components/
├── ui/                  # shadcn-svelte generated — KHÔNG edit tay
│   ├── button/
│   ├── card/
│   ├── badge/
│   └── ...
└── app/                 # Custom components của project
    ├── ArticleCard.svelte
    ├── DigestPanel.svelte
    ├── SourceForm.svelte
    ├── HotBadge.svelte
    ├── FilterBar.svelte
    └── NavBar.svelte
```

**Dùng shadcn-svelte trong component:**
```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Flame } from 'lucide-svelte';
</script>

<Card>
  <CardHeader>
    <CardTitle>Tiêu đề bài viết</CardTitle>
  </CardHeader>
  <CardContent>
    <Badge variant="destructive">
      <Flame size={12} class="mr-1" /> Hot 9/10
    </Badge>
  </CardContent>
</Card>
```

**Hot score badge — dùng variant theo điểm:**
```svelte
<!-- HotBadge.svelte (Svelte 5 runes) -->
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  let { score }: { score: number } = $props();
  const variant = $derived(score >= 8 ? 'destructive' : score >= 5 ? 'default' : 'secondary');
  const label = $derived(score >= 8 ? `🔥 ${score}` : `${score}/10`);
</script>
<Badge {variant}>{label}</Badge>
```

#### 1.3 Cấu trúc thư mục

```
newsdigest/
├── fe/                      # Frontend (SvelteKit)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/
│   │   │   │   ├── ui/           # shadcn-svelte (generated, không edit)
│   │   │   │   └── app/          # Custom components
│   │   │   ├── stores/           # Svelte stores
│   │   │   ├── api.ts            # API client helper
│   │   │   ├── types.ts          # Shared TypeScript types
│   │   │   └── utils.ts          # Helper functions
│   │   └── routes/
│   │       ├── +layout.svelte    # App shell, nav, dark mode
│   │       ├── +page.svelte      # Feed chính
│   │       ├── digest/
│   │       │   └── +page.svelte  # Digest view
│   │       ├── sources/
│   │       │   └── +page.svelte  # Quản lý nguồn
│   │       ├── bookmarks/
│   │       │   └── +page.svelte  # Bài đã lưu
│   │       └── onboarding/
│   │           └── +page.svelte  # Onboarding flow
│   └── components.json           # shadcn-svelte config
├── worker/                  # Backend (Cloudflare Workers)
│   ├── index.ts             # Entry: fetch → API, scheduled → Cron
│   ├── types.ts             # Env, Article, Source, ArticleInput
│   ├── api/
│   │   └── index.ts         # Hono router — tất cả API endpoints
│   ├── cron/
│   │   ├── index.ts         # Cron scheduler — round-robin fetch
│   │   └── scraper.ts       # RSS, Reddit, YouTube, VOZ adapters
│   └── push/
│       └── index.ts         # Web Push (RFC 8291 + VAPID)
├── docs/
│   └── dify-setup.md        # Hướng dẫn setup Dify Agent
├── schema.sql               # D1 database schema
├── wrangler.toml
└── PROJECT_SPEC.md
```

#### 1.4 wrangler.toml

```toml
name = "newsdigest"
main = "worker/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "newsdigest"
database_id = "<auto-generated>"

[[kv_namespaces]]
binding = "SCRAPER_CONFIG"
id = "<auto-generated>"

[[kv_namespaces]]
binding = "PUSH_SUBSCRIPTIONS"
id = "<auto-generated>"

[triggers]
crons = ["0 */3 * * *"]  # Mỗi 3 giờ

[vars]
VAPID_PUBLIC_KEY = ""    # Set qua wrangler secret
VAPID_PRIVATE_KEY = ""
```

> **Không cần** CF Queues, R2, hay Vertex AI key trong MVP. Dify agent xử lý phần AI.

---

### Bước 2 — Database schema (Cloudflare D1)

Tạo file `schema.sql`, chạy `wrangler d1 execute newsdigest --file=schema.sql`.

```sql
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
  summary     TEXT,                     -- tóm tắt AI (nullable, Dify điền sau)
  full_text   TEXT,                     -- nội dung gốc (optional)
  hot_score   INTEGER,                  -- 1–10, do Dify Agent chấm
  tags        TEXT,                     -- JSON array: ["AI", "Security"]
  published_at TEXT,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_bookmarked INTEGER NOT NULL DEFAULT 0,
  is_read     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_id, url)               -- dedup theo source + url
);

-- Digest report
CREATE TABLE digests (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  summary_text TEXT NOT NULL,           -- tổng hợp do Dify Agent viết
  top_article_ids TEXT NOT NULL,        -- JSON array of article IDs
  total_fetched INTEGER NOT NULL DEFAULT 0
);

-- Index để query nhanh
CREATE INDEX idx_articles_source    ON articles(source_id);
CREATE INDEX idx_articles_hot       ON articles(hot_score DESC);
CREATE INDEX idx_articles_fetched   ON articles(fetched_at DESC);
CREATE INDEX idx_articles_published ON articles(published_at DESC);
```

---

### Bước 3 — Cron Worker: thu thập bài viết

**File:** `worker/cron/index.ts`

Cron Worker chạy **mỗi 3 giờ**, round-robin fetch **1 source mỗi lần** để tránh timeout.

#### 3.1 Logic chính

```
scheduled() {
  1. Lấy danh sách sources đang enabled từ D1
  2. Đọc index tiếp theo từ KV (round-robin)
  3. Gọi fetchSource(source) cho source tại index đó
  4. INSERT OR IGNORE bài mới vào D1
  5. Cập nhật last_fetched_at
  6. Lưu index tiếp theo vào KV
}
```

> **Không đẩy vào Queue, không gọi AI.** Phần AI do Dify agent xử lý riêng.

#### 3.2 fetchSource() — smart scraper

Xử lý theo `source.type`:

| Type | Adapter | Chi tiết |
|---|---|---|
| `rss` | `fetchRSS()` | Parse RSS/Atom bằng `fast-xml-parser`, lấy tối đa 20 bài |
| `reddit` | `fetchReddit()` | Reddit JSON API: `/new.json?limit=25`, không cần auth |
| `youtube` | `fetchYouTube()` | YouTube Data API v3: channels → playlistItems (1 unit/request) |
| `voz` | `fetchVoz()` | HTMLRewriter parse `.structItem-title` + `.structItem` |
| `html` | `fetchUnknown()` | Chưa implement — trả về `[]` |

**Dedup**: dùng `INSERT OR IGNORE` với UNIQUE constraint `(source_id, url)`.

#### 3.3 Adapter chi tiết

**Reddit adapter**:
- Dùng Reddit JSON API: `https://www.reddit.com/r/{subreddit}/new.json?limit=25`
- Không cần auth cho public subreddit
- Map fields: `title`, `url`, `permalink`, `score`, `created_utc`

**YouTube adapter**:
- Lần đầu: gọi `channels?part=contentDetails&forHandle={handle}` để lấy `uploadsPlaylistId`
- Các lần sau: gọi `playlistItems?part=snippet,contentDetails&playlistId={id}&maxResults=10`
- Dùng `YOUTUBE_API_KEY` từ env var (set qua `wrangler secret put`)
- **Lưu ý**: dùng `playlistItems.list` (1 unit/request) thay vì `search.list` (100 units/request)

**VOZ adapter**:
- VOZ render SSR → fetch HTML thô
- HTMLRewriter parse `.structItem-title a` (href + text) và `.structItem`

---

### Bước 4 — Dify Workflow: tóm tắt và chấm điểm

> **Thay thế cho AI Worker nội bộ.** Dify Workflow dùng HTTP nodes cho API calls + LLM node cho AI summarize. Chỉ dùng AI 1 lần duy nhất.

Chi tiết setup Dify → xem [docs/dify-setup.md](docs/dify-setup.md).

#### 4.1 Quy trình Workflow (deterministic)

```
[HTTP] POST /api/sources/fetch-all      → Fetch tất cả bài
[HTTP] GET  /api/articles?unsummarized=1 → Lấy bài chưa tóm tắt
[Code] Parse JSON response               → Format cho LLM
[IF]   article_count > 0?                → Kiểm tra có bài
[LLM]  Summarize + Score + Digest        → AI (1 lần gọi duy nhất)
[Code] Parse LLM output                  → Tạo payloads
[HTTP] POST /api/articles/summarize      → Lưu summaries
[HTTP] POST /api/digest                  → Lưu digest
```

#### 4.2 Tại sao dùng Dify Workflow thay vì Agent hoặc AI Worker?

| | AI Worker (CF Queues) | Dify Agent (tool-calling) | Dify Workflow |
|---|---|---|---|
| Chi phí | Vertex AI pricing | Nhiều token (ReAct reasoning) | **Ít token nhất** |
| Complexity | Build queue consumer | Setup tools | **Chỉ import YML** |
| Flexibility | Hardcode prompt | Thay model/prompt qua UI | **Thay model/prompt qua UI** |
| Reliability | Phụ thuộc queue | Agent có thể bỏ bước | **Deterministic** |

#### 4.3 Endpoints cho Dify

Worker cung cấp 2 endpoint đặc biệt cho Dify:

**POST `/api/articles/summarize`** — nhận kết quả tóm tắt:
```json
{
  "results": [
    { "id": "uuid", "summary": "...", "hot_score": 8, "tags": ["AI", "Tech"] }
  ]
}
```

**POST `/api/digest`** — nhận digest tổng hợp:
```json
{
  "summary_text": "Tổng hợp xu hướng...",
  "top_article_ids": ["id1", "id2"]
}
```

---

### Bước 5 — Digest generation

Digest được tạo bởi **Dify Workflow** trong cùng 1 LLM call với bước summarize.

#### 5.1 Logic

LLM node output JSON chứa cả `summaries` và `digest_text` + `top_article_ids`. Code node parse và gửi về Worker qua 2 HTTP requests riêng.

#### 5.2 Đọc digest

Frontend gọi `GET /api/digest/latest` để lấy digest mới nhất + top articles.

---

### Bước 6 — API Worker: endpoints cho frontend

**File:** `worker/api/index.ts`

Dùng Hono làm router, có CORS middleware trên `/api/*`.

```bash
npm install hono
```

#### 6.1 Endpoints

```
# Articles
GET  /api/articles
     ?page=1&limit=20
     &tag=AI
     &source_id=xxx
     &min_hot=7
     &sort=hot|date          # default: date (fetched_at DESC)
     &bookmarked=1           # chỉ bài đã bookmark
     &unsummarized=1         # chỉ bài chưa tóm tắt
     → { articles[], total, page, nextPage }

GET  /api/articles/:id
     → { article }

PATCH /api/articles/:id/bookmark
     body: { bookmarked: true|false }
     → { ok: true }

PATCH /api/articles/:id/read
     → { ok: true }

# Dify Integration
POST /api/articles/summarize
     body: { results: [{ id, summary, hot_score, tags }] }
     → { ok, updated }

POST /api/digest
     body: { summary_text, top_article_ids? }
     → { ok, digestId }

# Digest Read
GET  /api/digest/latest
     → { digest, topArticles }

# Sources
GET  /api/sources
     → { sources[] }

POST /api/sources
     body: { url, name?, group_name? }
     → { ok, source }  (auto-detect type: rss/reddit/youtube/voz)

PATCH /api/sources/:id
     body: { enabled?, name?, group_name? }
     → { ok }

DELETE /api/sources/:id
     → { ok }

POST /api/sources/:id/fetch
     → { ok, fetched, inserted }  (trigger fetch thủ công)

# Push Notification
GET  /api/push/vapid-public-key
     → { publicKey }

POST /api/push/subscribe
     body: PushSubscription object
     → { ok }

DELETE /api/push/unsubscribe
     → { ok }
```

#### 6.2 Auth

MVP dùng simple approach: chưa có auth middleware. Đủ dùng cho personal app (1 user). Có thể thêm Bearer token sau.

---

### Bước 7 — Web Push notification

**File:** `worker/push/index.ts`

#### 7.1 Setup VAPID keys

```bash
npx web-push generate-vapid-keys
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
```

#### 7.2 Implementation

Worker implement Web Push theo RFC 8291 + VAPID (RFC 8292) bằng SubtleCrypto (edge-compatible, không cần thư viện bên ngoài):

- **Lưu subscription**: `POST /api/push/subscribe` → KV key `sub:{hash}`
- **Gửi notification**: `broadcastPush(env, summaryText, digestId)` — encrypt payload bằng ECDH + AES-GCM
- **Auto-cleanup**: Xử lý 410 Gone → xóa subscription expired khỏi KV

---

### Bước 8 — SvelteKit Frontend

#### 8.1 PWA setup

Dùng `vite-plugin-pwa`:

```bash
npm install -D vite-plugin-pwa
```

Cấu hình `manifest.webmanifest`:
```json
{
  "name": "NewsDigest",
  "short_name": "NewsDigest",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a1a1a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Service Worker strategy: `NetworkFirst` cho API calls, `CacheFirst` cho static assets.

#### 8.2 Svelte stores

```typescript
// src/lib/stores/articles.ts
export const articles = writable<Article[]>([]);
export const isLoading = writable(false);
export const filters = writable({ tag: '', minHot: 0, sourceId: '', sort: 'date' });

// src/lib/stores/sources.ts
export const sources = writable<Source[]>([]);

// src/lib/stores/prefs.ts
export const prefs = writable({
  darkMode: false,     // sync với localStorage + prefers-color-scheme
  apiKey: '',
  notificationsEnabled: false,
});
```

#### 8.3 Các màn hình

**Feed chính** (`/`):
- Grid card bài viết dùng `<Card>` của shadcn-svelte
- Mỗi card: title, source name, published_at, `<HotBadge>`, tags dùng `<Badge>`, summary 2 dòng truncate
- Infinite scroll hoặc `<Button variant="outline">` load more
- Filter bar dùng `<Select>` (tag, nguồn) + `<Toggle>` (hot score)
- Click card → mở bài gốc (new tab) và mark as read

**Digest view** (`/digest`):
- Digest mới nhất: đoạn tổng quan AI + danh sách top bài dùng `<ScrollArea>`
- `<Select>` chọn digest theo giờ

**Quản lý nguồn** (`/sources`):
- List sources dùng `<Card>` với `<Switch>` bật/tắt từng nguồn
- `<Dialog>` thêm nguồn mới: nhập URL → backend auto-detect → confirm
- `<DropdownMenu>` cho action xóa / đổi tên / đổi nhóm
- Nhóm theo `group_name` dùng `<Tabs>`

**Bookmarks** (`/bookmarks`):
- Danh sách bài đã bookmark, layout giống Feed
- Offline-ready (Service Worker cache)

**Settings** (`<Dialog>` mở từ navbar):
- `<Switch>` dark mode
- `<Switch>` notification
- `<Input>` API key

#### 8.4 Dark mode

shadcn-svelte dùng class-based dark mode. Implementation (Svelte 5 runes):

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs } from '$lib/stores/prefs';
  import NavBar from '$lib/components/app/NavBar.svelte';
  import { Toaster } from '$lib/components/ui/toast';

  onMount(() => {
    const saved = localStorage.getItem('darkMode');
    $prefs.darkMode = saved !== null
      ? saved === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark', $prefs.darkMode);
    localStorage.setItem('darkMode', String($prefs.darkMode));
  });
</script>

<NavBar />
<main class="container mx-auto px-4 py-6">
  {@render children()}
</main>
<Toaster />
```

---

### Bước 9 — Thêm nguồn lần đầu (onboarding flow)

Khi user mở app lần đầu chưa có nguồn nào:

1. Hiển thị màn hình onboarding với gợi ý nguồn mẫu (Hacker News, VnExpress, Cloudflare Blog...)
2. User chọn hoặc nhập URL tuỳ chỉnh
3. Backend detect type và validate
4. Trigger fetch thủ công ngay lần đầu (không chờ cron)
5. Redirect về feed với bài đầu tiên đã có

---

## Phase 2 — Nâng cao (sau MVP)

> Implement sau khi MVP đã chạy ổn định.

### Trending detection

Phát hiện chủ đề được nhiều nguồn đăng trong cùng khung giờ.

Logic: sau mỗi lần cron, query các bài trong 6 giờ qua, nhóm theo tags, nếu một tag có ≥ 3 bài từ ≥ 2 nguồn khác nhau → đánh dấu trending, hiển thị badge đặc biệt trên feed.

### Deep summarize

Khi user mở một bài, nếu `full_text` chưa có:
- Fetch URL bài gốc
- Extract main content (dùng heuristic hoặc Readability algorithm)
- Gọi Dify/AI tóm tắt đầy đủ
- Cache kết quả vào bài trong D1

### Filter nâng cao

- Lưu filter preset (ví dụ: "Chỉ AI + hot ≥ 8")
- Filter theo khoảng thời gian
- Tìm kiếm full-text trong title + summary (D1 FTS)

### HTML auto-detect scraper

Implement `fetchUnknown()`:
- Thử các path RSS phổ biến: `/rss`, `/feed`, `/atom.xml`, `/rss.xml`, `/index.xml`
- Tìm `<link rel="alternate" type="application/rss+xml">` trong HTML
- Nếu không có RSS → parse HTML bằng heuristic CSS selectors
- Lưu kết quả vào `scraper_configs` để tái dùng

---

## Phase 3 — V2 (tương lai)

> Chỉ xét sau khi có dữ liệu thực tế từ V1.

### Personalized ranking

Học từ hành vi đọc: bài nào user click → tăng weight cho tag/source đó. Điều chỉnh `hot_score` hiển thị theo profile cá nhân.

### Email / Telegram digest

Gửi digest qua Telegram Bot API hoặc email (Resend/Mailgun). User cấu hình trong Settings.

### Chat với tin tức

Tích hợp Dify hoặc gọi AI trực tiếp với context là các bài trong digest. User hỏi "Hôm nay có gì về AI không?" → AI trả lời dựa trên dữ liệu đã thu thập.

### Tự host AI (nếu cần scale)

Nếu traffic tăng hoặc cần latency thấp, có thể chuyển từ Dify sang:
- CF Queues + AI Worker gọi Vertex AI / OpenRouter trực tiếp
- R2 để cache digest JSON
- Giữ nguyên API interface, chỉ thay backend processing

---

## Checklist MVP

- [x] Bước 1: Khởi tạo SvelteKit + shadcn-svelte + wrangler.toml
- [x] Bước 2: Tạo D1 schema, migrate
- [x] Bước 3: Cron Worker — fetch RSS, Reddit, YouTube, VOZ (round-robin)
- [x] Bước 4: Dify Workflow setup — tóm tắt + hot score (HTTP + LLM deterministic)
- [x] Bước 5: Digest generation (qua Dify Workflow, cùng 1 LLM call)
- [x] Bước 6: API Worker (Hono) — đủ endpoints
- [x] Bước 7: Web Push — VAPID + RFC 8291 implementation
- [ ] Bước 8: SvelteKit UI — Feed, Digest, Sources, Bookmarks, Settings
- [ ] Bước 9: Onboarding flow

---

## Ghi chú cho agent IDE

- Mỗi bước có thể implement và test độc lập trước khi chuyển bước tiếp theo.
- **Svelte 5 runes**: Project dùng Svelte 5 — dùng `$props()`, `$state()`, `$derived()`, `$effect()` thay cho `export let`, `$:`, `onMount` reactive.
- **shadcn-svelte**: không import từ `@shadcn/ui` (React), phải dùng `shadcn-svelte`. Components ở `$lib/components/ui/`, không edit tay — chỉ add qua CLI.
- **Tailwind v4**: không có `tailwind.config.js`, cấu hình qua `@import` trong CSS.
- **Dify Workflow thay AI Worker**: Không cần build queue consumer hay Vertex AI integration. Dify workflow dùng HTTP nodes gọi API + LLM node cho AI. Import `Daily AI News Digest.yml` để setup.
- YouTube adapter cần `YOUTUBE_API_KEY` riêng — dùng `wrangler secret put YOUTUBE_API_KEY`.
- Dùng `wrangler dev` để test local, `wrangler deploy` để push production.
- D1 local dev: `wrangler d1 execute newsdigest --local --file=schema.sql`.
