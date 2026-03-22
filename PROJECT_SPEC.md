# NewsDigest PWA — Project Specification

> Tài liệu này mô tả toàn bộ tính năng, kiến trúc, và lộ trình triển khai.
> Dùng làm input cho agent IDE để implement từng bước.

---

## Tổng quan dự án

**NewsDigest** là một Progressive Web App cá nhân, tự động thu thập tin tức từ nhiều nguồn (RSS, blog, Reddit, VOZ, YouTube), dùng AI tóm tắt và chấm điểm độ hot, sau đó báo cáo digest mỗi giờ cho người dùng.

### Tech stack

| Layer | Công nghệ |
|---|---|
| Frontend | SvelteKit + TypeScript |
| UI components | shadcn-svelte + Tailwind CSS v4 |
| Icons | lucide-svelte |
| Hosting frontend | Cloudflare Pages |
| Backend / API | Cloudflare Workers (TypeScript) |
| Scheduler | Cloudflare Workers Cron Trigger |
| Queue | Cloudflare Queues |
| Database | Cloudflare D1 (SQLite at edge) |
| Cache / KV | Cloudflare KV |
| File storage | Cloudflare R2 |
| AI tóm tắt | Vertex AI — Gemini 1.5 Flash |
| Push notification | Web Push API (VAPID) qua CF Worker |

### Kiến trúc tổng thể

```
[Nguồn tin]          [Cloudflare Edge]                  [Frontend]
  RSS/Atom  ──────▶  Cron Worker (1h)                     SvelteKit PWA
  HTML Blog ──────▶    │ fetch + parse                     │
  Reddit    ──────▶    │ dedup                             │  CF Pages
  YouTube   ──────▶    ▼                                   │
  VOZ       ──────▶  CF Queues ──▶ AI Worker               │
  Custom    ──────▶                  │ Gemini Flash         │
                     CF D1           │ summarize            │
                     CF KV  ◀────────┘ score               │
                     CF R2  (cache)                        │
                       │                                   │
                     API Worker ◀──────────────────────────┘
                       │ auth / rate limit
                     Web Push ──▶ Browser notification
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
<!-- HotBadge.svelte -->
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  export let score: number;
  $: variant = score >= 8 ? 'destructive' : score >= 5 ? 'default' : 'secondary';
  $: label = score >= 8 ? `Hot ${score}` : score >= 5 ? `${score}/10` : `${score}/10`;
</script>
<Badge {variant}>{label}</Badge>
```

#### 1.3 Cấu trúc thư mục

```
newsdigest/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── ui/           # shadcn-svelte (generated, không edit)
│   │   │   └── app/          # Custom components
│   │   ├── stores/           # Svelte stores
│   │   └── utils/            # Helper functions
│   └── routes/
│       ├── +layout.svelte    # App shell, nav, dark mode
│       ├── +page.svelte      # Feed chính
│       ├── digest/
│       │   └── +page.svelte  # Digest view
│       ├── sources/
│       │   └── +page.svelte  # Quản lý nguồn
│       └── bookmarks/
│           └── +page.svelte  # Bài đã lưu
├── workers/
│   ├── cron/                 # Cron Worker: fetch + parse
│   ├── ai/                   # AI Worker: Gemini summarize
│   ├── api/                  # API Worker: endpoints cho frontend
│   └── push/                 # Push Worker: gửi notification
├── components.json           # shadcn-svelte config
├── wrangler.toml
└── PROJECT_SPEC.md
```

#### 1.4 wrangler.toml cơ bản

```toml
name = "newsdigest"
compatibility_date = "2024-01-01"

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

[[r2_buckets]]
binding = "DIGEST_CACHE"
bucket_name = "newsdigest-cache"

[[queues.producers]]
binding = "AI_QUEUE"
queue = "newsdigest-ai"

[[queues.consumers]]
queue = "newsdigest-ai"
max_batch_size = 10
max_batch_timeout = 30

[triggers]
crons = ["0 * * * *"]  # Mỗi giờ đúng

[vars]
VERTEX_API_KEY = ""    # Set qua wrangler secret
VAPID_PUBLIC_KEY = ""
VAPID_PRIVATE_KEY = ""
```

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
```

---

### Bước 3 — Cron Worker: thu thập bài viết

**File:** `workers/cron/index.ts`

Cron Worker chạy mỗi giờ, thực hiện tuần tự:

#### 3.1 Logic chính

```
scheduled() {
  1. Lấy danh sách sources đang enabled từ D1
  2. Với mỗi source: gọi fetchSource(source)
  3. Với mỗi bài mới: insert vào D1 (IGNORE nếu trùng url)
  4. Đẩy batch bài mới vào CF Queue để AI xử lý
  5. Trigger tạo digest sau khi fetch xong
}
```

#### 3.2 fetchSource() — smart scraper

Xử lý theo thứ tự ưu tiên:

**Ưu tiên 1 — Nguồn có type cố định** (reddit, youtube, voz): dùng adapter riêng.

**Ưu tiên 2 — RSS/Atom**: kiểm tra `scraper_configs` trong D1 xem domain đã biết chưa. Nếu có `mode = 'rss'` → parse feed thẳng. Nếu chưa biết → chạy auto-detect.

**Auto-detect** (chỉ chạy lần đầu per domain):
- Thử các path RSS phổ biến: `/rss`, `/feed`, `/atom.xml`, `/rss.xml`, `/index.xml`
- Tìm `<link rel="alternate" type="application/rss+xml">` trong HTML
- Nếu không có RSS → parse HTML bằng heuristic CSS selectors
- Nếu heuristic fail → gọi Gemini extract structured data từ HTML
- Lưu kết quả vào `scraper_configs` để tái dùng

**Dedup**: dùng `INSERT OR IGNORE` vào bảng `articles` với UNIQUE constraint `(source_id, url)`.

#### 3.3 Adapter cho nguồn đặc biệt

**Reddit adapter**:
- Dùng Reddit JSON API: `https://www.reddit.com/r/{subreddit}/new.json?limit=25`
- Không cần auth cho public subreddit
- Map fields: `title`, `url`, `permalink`, `score`, `created_utc`

**YouTube adapter**:
- Lần đầu: gọi `channels?part=contentDetails&forHandle={handle}` để lấy `uploadsPlaylistId`, lưu vào `scraper_configs`
- Các lần sau: gọi `playlistItems?part=snippet,contentDetails&playlistId={uploadsPlaylistId}&maxResults=10`
- Dùng `YOUTUBE_API_KEY` từ env var
- **Lưu ý**: dùng `playlistItems.list` (1 unit/request) thay vì `search.list` (100 units/request) để tiết kiệm quota

**VOZ adapter**:
- VOZ render phía server nên có thể fetch HTML thô
- Parse `<article>` hoặc `.thread-item` bằng heuristic
- Fallback sang Gemini nếu layout thay đổi
- Thêm delay 2s giữa các request để tránh bị block

---

### Bước 4 — AI Worker: tóm tắt và chấm điểm

**File:** `workers/ai/index.ts`

AI Worker nhận message từ CF Queue, gọi Gemini Flash để xử lý batch bài viết.

#### 4.1 Queue consumer

```
queue handler nhận batch tối đa 10 bài {
  1. Gom text: title + full_text (hoặc URL snippet) của từng bài
  2. Gọi Gemini với prompt bên dưới
  3. Parse JSON response
  4. UPDATE articles SET summary, hot_score, tags WHERE id = ?
}
```

#### 4.2 Prompt cho Gemini

```
Bạn là editor tin tức. Phân tích các bài viết dưới đây và trả về JSON array.

Với mỗi bài:
- "id": giữ nguyên id được cung cấp
- "summary": tóm tắt 2–3 câu bằng tiếng Việt, súc tích, nêu điểm chính
- "hot_score": integer 1–10 đánh giá độ quan trọng/hot
  (10 = tin cực kỳ quan trọng/breaking, 1 = thông thường)
- "tags": array tối đa 3 tag từ: ["AI", "Security", "Tech", "Business",
  "Vietnam", "World", "Dev", "Science", "Crypto", "Policy"]

Chỉ trả về JSON array, không giải thích, không markdown.

Bài viết:
[{ "id": "...", "title": "...", "text": "..." }, ...]
```

#### 4.3 Retry logic

CF Queues tự động retry nếu worker throw error. Nên:
- Catch lỗi Gemini API → throw để trigger retry
- Catch lỗi parse JSON → log và ack (không retry vô tận)
- Đặt `max_retries = 3` trong wrangler.toml

---

### Bước 5 — Digest generation

Sau mỗi lần cron chạy xong, tạo một digest report.

#### 5.1 Logic tạo digest

```
createDigest(periodStart, periodEnd) {
  1. Query top 10 bài có hot_score cao nhất trong kỳ từ D1
  2. Gọi Gemini tổng hợp: "Đây là các tin hot nhất giờ qua, viết 1 đoạn tổng quan"
  3. INSERT vào bảng digests
  4. Lưu JSON digest vào R2 (key: digests/{YYYY-MM-DD}/{HH}.json) để cache
  5. Trigger Web Push notification
}
```

#### 5.2 Prompt tổng hợp digest

```
Dưới đây là các tin tức hot nhất trong 1 giờ qua được thu thập tự động.
Viết 2–3 câu tổng quan bằng tiếng Việt, nêu các chủ đề nổi bật.
Giọng văn ngắn gọn, khách quan như một biên tập viên tin tức.

Bài viết:
[{ "title": "...", "summary": "...", "hot_score": 8 }, ...]
```

---

### Bước 6 — API Worker: endpoints cho frontend

**File:** `workers/api/index.ts`

Dùng Hono (nhẹ, phù hợp CF Workers) làm router.

```bash
npm install hono
```

#### 6.1 Endpoints

```
GET  /api/articles
     ?page=1&limit=20
     &tag=AI
     &source_id=xxx
     &min_hot=7
     &sort=hot|date        # default: date
     → { articles[], total, nextPage }

GET  /api/articles/:id
     → Article object đầy đủ

GET  /api/digest/latest
     → Digest object + top articles

GET  /api/digest/:date/:hour
     → Digest cụ thể (từ R2 cache)

GET  /api/sources
     → Danh sách sources của user

POST /api/sources
     body: { url, name?, group? }
     → { source } sau khi validate + detect type

PATCH /api/sources/:id
     body: { enabled?, name?, group? }
     → source đã update

DELETE /api/sources/:id
     → { ok: true }

POST /api/sources/:id/fetch
     → Trigger fetch thủ công cho nguồn đó

PATCH /api/articles/:id/bookmark
     body: { bookmarked: true|false }
     → article đã update

PATCH /api/articles/:id/read
     body: { read: true }
     → article đã update

GET  /api/push/vapid-public-key
     → { publicKey }

POST /api/push/subscribe
     body: PushSubscription object
     → { ok: true }

DELETE /api/push/unsubscribe
     body: { endpoint }
     → { ok: true }
```

#### 6.2 Auth

MVP dùng simple secret key: user lưu key trong localStorage, gửi qua header `Authorization: Bearer {key}`. Key được set trong `wrangler.toml` vars. Đủ dùng cho personal app.

---

### Bước 7 — Web Push notification

**File:** `workers/push/index.ts`

#### 7.1 Setup VAPID keys

```bash
npx web-push generate-vapid-keys
# Lưu vào wrangler secret
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
```

#### 7.2 Lưu subscription

Khi user cho phép notification trên PWA:
- Frontend gọi `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
- Gửi `PushSubscription` object lên `POST /api/push/subscribe`
- Backend lưu vào KV: key = `sub:{endpoint_hash}`, value = subscription JSON

#### 7.3 Gửi notification

Sau khi digest được tạo:
- Lấy tất cả subscription từ KV (`list` với prefix `sub:`)
- Dùng Web Push protocol (RFC 8291) để gửi
- Payload: `{ title: "NewsDigest", body: "{digest summary}", data: { digestId } }`
- Xử lý 410 Gone response (user đã unsubscribe) → xóa subscription khỏi KV

Dùng thư viện `web-push` hoặc implement tay theo RFC (CF Workers hỗ trợ SubtleCrypto).

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

shadcn-svelte dùng class-based dark mode của Tailwind. Cách implement:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs } from '$lib/stores/prefs';
  import NavBar from '$lib/components/app/NavBar.svelte';
  import { Toaster } from '$lib/components/ui/toast';

  onMount(() => {
    // Đọc từ localStorage, fallback sang system preference
    const saved = localStorage.getItem('darkMode');
    $prefs.darkMode = saved !== null
      ? saved === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Thêm/xoá class 'dark' trên <html> — shadcn dùng class này
  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', $prefs.darkMode);
    localStorage.setItem('darkMode', String($prefs.darkMode));
  }
</script>

<NavBar />
<main class="container mx-auto px-4 py-6">
  <slot />
</main>
<Toaster />
```

`app.css` (Tailwind v4 + shadcn CSS variables):
```css
@import 'tailwindcss';
@import './shadcn.css';   /* generated by shadcn init */
```

**Toggle dark mode trong UI:**
```svelte
<script lang="ts">
  import { Switch } from '$lib/components/ui/switch';
  import { Moon } from 'lucide-svelte';
  import { prefs } from '$lib/stores/prefs';
</script>

<div class="flex items-center gap-2">
  <Moon size={16} />
  <Switch bind:checked={$prefs.darkMode} />
</div>
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

Logic: sau mỗi lần cron, query các bài trong 2 giờ qua, nhóm theo tags, nếu một tag có ≥ 3 bài từ ≥ 2 nguồn khác nhau → đánh dấu `is_trending = 1`, hiển thị badge đặc biệt trên feed.

### Deep summarize

Khi user mở một bài, nếu `full_text` chưa có:
- Fetch URL bài gốc
- Extract main content (dùng heuristic hoặc Readability algorithm)
- Gọi Gemini tóm tắt đầy đủ
- Cache kết quả vào bài trong D1

### Filter nâng cao

- Lưu filter preset (ví dụ: "Chỉ AI + hot ≥ 8")
- Filter theo khoảng thời gian
- Tìm kiếm full-text trong title + summary (D1 FTS)

---

## Phase 3 — V2 (tương lai)

> Chỉ xét sau khi có dữ liệu thực tế từ V1.

### Personalized ranking

Học từ hành vi đọc: bài nào user click → tăng weight cho tag/source đó. Điều chỉnh `hot_score` hiển thị theo profile cá nhân.

### Email / Telegram digest

Gửi digest qua Telegram Bot API hoặc email (Resend/Mailgun). User cấu hình trong Settings.

### Chat với tin tức

Tích hợp Dify hoặc gọi Gemini trực tiếp với context là các bài trong digest. User hỏi "Hôm nay có gì về AI không?" → AI trả lời dựa trên dữ liệu đã thu thập.

---

## Checklist MVP

- [ ] Bước 1: Khởi tạo SvelteKit + shadcn-svelte + wrangler.toml
- [ ] Bước 2: Tạo D1 schema, migrate
- [ ] Bước 3: Cron Worker — fetch RSS, HTML, Reddit, YouTube
- [ ] Bước 4: AI Worker — Gemini tóm tắt + hot score
- [ ] Bước 5: Digest generation + R2 cache
- [ ] Bước 6: API Worker (Hono) — đủ endpoints
- [ ] Bước 7: Web Push — VAPID setup + gửi notification
- [ ] Bước 8: SvelteKit UI — Feed, Digest, Sources, Bookmarks, Settings
- [ ] Bước 9: Onboarding flow

---

## Ghi chú cho agent IDE

- Mỗi bước có thể implement và test độc lập trước khi chuyển bước tiếp theo.
- Bước 3 (Cron Worker) và Bước 4 (AI Worker) là phần phức tạp nhất, nên test kỹ với mock data trước.
- **shadcn-svelte**: không import từ `@shadcn/ui` (React), phải dùng `shadcn-svelte`. Components nằm ở `$lib/components/ui/`, không edit tay — chỉ add qua CLI.
- **Tailwind v4**: không có `tailwind.config.js`, cấu hình qua `@import` trong CSS. shadcn-svelte init sẽ tạo sẵn.
- YouTube adapter cần `YOUTUBE_API_KEY` riêng — dùng `wrangler secret put YOUTUBE_API_KEY`.
- Vertex AI Gemini endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={VERTEX_API_KEY}`.
- VOZ và Reddit không cần key nhưng cần User-Agent header hợp lệ.
- Dùng `wrangler dev` để test local, `wrangler deploy` để push production.
- D1 local dev: `wrangler d1 execute newsdigest --local --file=schema.sql`.
