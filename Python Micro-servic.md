# Python Micro-service: YouTube Transcript + Reddit Content

## Bối cảnh

Cloudflare Worker hiện tại **không thể** lấy:
- **YouTube transcript** — YouTube đã chặn các cách scrape truyền thống, cần thư viện chuyên biệt
- **Reddit post content** — Trang Reddit render bằng JS (React SPA), `fetch()` chỉ nhận HTML rỗng

→ Cần deploy một **micro-service riêng** trên Render (free tier) để xử lý 2 tính năng này.

## Quyết định cần xác nhận

> [!IMPORTANT]
> **Chọn runtime: Python hay Node.js?**
>
> - PRAW (Reddit) → **Python only**
> - `youtube-transcript-plus` → **Node.js only**
> - `youtube-transcript-api` → **Python** (tương đương, cũng fetch transcript không cần API key)
>
> **Đề xuất: Dùng Python** cho cả hai, với `youtube-transcript-api` + PRAW → 1 service duy nhất, đơn giản hơn.
> Nếu bạn muốn dùng `youtube-transcript-plus` (Node.js), cần tách thành 2 service hoặc dùng Node.js cho tất cả (thay PRAW bằng `snoowrap`).

> [!WARNING]
> **`youtube-transcript-api` có rủi ro khi chạy trên cloud:**
> - YouTube có thể block IP của Render (cloud provider) → `RequestBlocked` / `IpBlocked`
> - **Giải pháp: Dùng YouTube cookies** để YouTube nhận diện là logged-in user → giảm block
> - Fallback strategy: thử không cookie → retry với cookie → skip
> - Cookie có thời hạn (~vài tháng), cần export lại khi hết hạn
> - Nên dùng **account phụ** để tránh bị flag account chính

> [!NOTE]
> **Reddit API credentials cần thiết cho PRAW:**
> - Vào https://www.reddit.com/prefs/apps → tạo app (script type)
> - Lấy `client_id`, `client_secret`
> - Miễn phí, giới hạn 60 requests/phút (đủ dùng)

---

## Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────┐
│                 Cloudflare Worker (hiện tại)             │
│                                                         │
│  Cron (3h/lần) ──→ fetchSource() ──→ INSERT articles    │
│                         │                               │
│                         ▼                               │
│              Queue (CONTENT_QUEUE)                       │
│                         │                               │
│                         ▼                               │
│              content-scraper.ts                          │
│              ┌─────────────────────┐                    │
│              │ youtube.com URL?    │──YES──→ Gọi Render  │
│              │ reddit.com URL?    │──YES──→ Gọi Render  │
│              │ Trang khác?        │──YES──→ HTMLRewriter │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
                         │
                    HTTP Request
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│           Python Micro-service (Render)                  │
│           FastAPI + Gunicorn                             │
│                                                         │
│  GET /health              → healthcheck                  │
│  POST /youtube/transcript → youtube-transcript-api       │
│  POST /reddit/content     → PRAW                         │
│                                                         │
│  Auth: API_KEY header (shared secret)                    │
└─────────────────────────────────────────────────────────┘
```

---

## Proposed Changes

### Component 1: Python Micro-service (New Project)

> Tạo thư mục `services/content-fetcher/` trong repo NewsDigest.

#### [NEW] [main.py](file:///Users/nguyenle/Documents/GitHub/NewsDigest/services/content-fetcher/main.py)

FastAPI application với 3 endpoints:

```python
import os
from youtube_transcript_api import YouTubeTranscriptApi

ytt_api = YouTubeTranscriptApi()
COOKIE_PATH = "/app/cookies.txt"  # Mount từ env hoặc file

# POST /youtube/transcript
# Input:  { "video_id": "nxwkn9Dt9-I" }
# Output: { "transcript": "full transcript text...", "language": "en" }
#
# Strategy: thử không cookie → retry với cookie nếu bị block
def fetch_transcript(video_id: str) -> dict:
    try:
        # Lần 1: không cookie
        transcript = ytt_api.fetch(video_id)
        return format_transcript(transcript)
    except Exception as e:
        if "blocked" in str(e).lower() or "too many" in str(e).lower():
            # Lần 2: retry với cookie
            if os.path.exists(COOKIE_PATH):
                transcript = ytt_api.fetch(video_id, cookies=COOKIE_PATH)
                return format_transcript(transcript)
        raise e

# Ưu tiên: English → auto-generated → any available
# Nối tất cả segments thành 1 đoạn text
# Giới hạn 5000 chars (giống extractArticleContent)

# POST /reddit/content
# Input:  { "url": "https://www.reddit.com/r/..." }
# Output: { "content": "post title + selftext + top comments..." }
#
# Dùng PRAW để:
# 1. Lấy submission.selftext (nội dung post)
# 2. Lấy top 10-20 comments (sorted by best)
# 3. Nối thành text content
# Giới hạn 5000 chars

# GET /health
# Output: { "status": "ok" }
# Dùng để ping warm-up trước khi gọi batch
```

**Xử lý lỗi:**
- YouTube transcript không có → trả `{ "transcript": "", "error": "no_transcript" }`
- Reddit URL invalid → trả `{ "content": "", "error": "invalid_url" }`
- Rate limit / IP block → HTTP 429 + retry-after header

**Bảo mật:**
- Header `X-API-Key` kiểm tra shared secret
- Reject requests không có key hợp lệ

#### [NEW] [requirements.txt](file:///Users/nguyenle/Documents/GitHub/NewsDigest/services/content-fetcher/requirements.txt)

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
gunicorn==23.0.0
youtube-transcript-api==0.6.3
praw==7.8.1
```

#### [NEW] [Dockerfile](file:///Users/nguyenle/Documents/GitHub/NewsDigest/services/content-fetcher/Dockerfile)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Startup script: ghi cookie từ env ra file, rồi start server
CMD ["sh", "-c", "echo \"$YOUTUBE_COOKIES\" > /app/cookies.txt && gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000"]
```

#### [NEW] [render.yaml](file:///Users/nguyenle/Documents/GitHub/NewsDigest/services/content-fetcher/render.yaml)

```yaml
services:
  - type: web
    name: newsdigest-content-fetcher
    runtime: docker
    plan: free
    envVars:
      - key: API_KEY
        generateValue: true
      - key: REDDIT_CLIENT_ID
        sync: false
      - key: REDDIT_CLIENT_SECRET
        sync: false
      - key: REDDIT_USER_AGENT
        value: NewsDigest/1.0
      - key: YOUTUBE_COOKIES
        sync: false  # Nội dung file cookies.txt (Netscape format)
```

---

### Component 2: Worker Integration

#### [MODIFY] [types.ts](file:///Users/nguyenle/Documents/GitHub/NewsDigest/worker/types.ts)

Thêm env variable cho Render service:
```diff
 export interface Env {
   DB: D1Database;
   SCRAPER_CONFIG: KVNamespace;
   PUSH_SUBSCRIPTIONS: KVNamespace;
   CONTENT_QUEUE: Queue;
   VAPID_PUBLIC_KEY: string;
   VAPID_PRIVATE_KEY: string;
   YOUTUBE_API_KEY: string;
+  CONTENT_SERVICE_URL: string;   // URL Render service
+  CONTENT_SERVICE_KEY: string;   // API key shared secret
 }
```

#### [MODIFY] [content-scraper.ts](file:///Users/nguyenle/Documents/GitHub/NewsDigest/worker/queue/content-scraper.ts)

Cập nhật queue consumer để route YouTube/Reddit URLs tới Render service:

```typescript
export async function handleContentQueue(batch, env) {
  // Ping health endpoint trước để warm up Render (tránh cold start)
  await fetch(`${env.CONTENT_SERVICE_URL}/health`).catch(() => {});

  for (const message of batch.messages) {
    const { articleId, url } = message.body;

    let content = '';

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      // Extract video ID → gọi Render service
      const videoId = extractVideoId(url);
      if (videoId) {
        const res = await fetch(`${env.CONTENT_SERVICE_URL}/youtube/transcript`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.CONTENT_SERVICE_KEY
          },
          body: JSON.stringify({ video_id: videoId })
        });
        if (res.ok) {
          const data = await res.json();
          content = data.transcript || '';
        }
      }
    } else if (url.includes('reddit.com')) {
      // Gọi Render service
      const res = await fetch(`${env.CONTENT_SERVICE_URL}/reddit/content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.CONTENT_SERVICE_KEY
        },
        body: JSON.stringify({ url })
      });
      if (res.ok) {
        const data = await res.json();
        content = data.content || '';
      }
    } else {
      // Giữ nguyên logic cũ cho HTML sites
      content = await extractArticleContent(url);
    }

    // Update DB
    if (content) {
      await env.DB.prepare('UPDATE articles SET content = ? WHERE id = ?')
        .bind(content, articleId).run();
    }
    message.ack();
  }
}
```

#### [MODIFY] [wrangler.toml](file:///Users/nguyenle/Documents/GitHub/NewsDigest/wrangler.toml)

Thêm env var (URL là public, key là secret):
```diff
 [vars]
 VAPID_PUBLIC_KEY = ""
 VAPID_PRIVATE_KEY = ""
+CONTENT_SERVICE_URL = "https://newsdigest-content-fetcher.onrender.com"
```

`CONTENT_SERVICE_KEY` set qua `wrangler secret put` (không commit).

---

## Deploy Steps

### 1. Tạo Reddit API credentials
1. Đăng nhập Reddit → https://www.reddit.com/prefs/apps
2. Click **"create another app..."**
3. Chọn **"script"**, đặt tên `NewsDigest`
4. Redirect URI: `http://localhost:8000`
5. Copy `client_id` (dưới tên app) và `client_secret`

### 1.5. Export YouTube cookies (tránh IP block)
1. Đăng nhập YouTube bằng **account phụ** trên Chrome
2. Cài extension [**Get cookies.txt LOCALLY**](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
3. Vào youtube.com → click extension → **Export** → lưu file `cookies.txt`
4. Copy toàn bộ nội dung file → paste vào env `YOUTUBE_COOKIES` trên Render
5. ⚠️ Cookie hết hạn sau ~2-3 tháng → cần export lại khi transcript bắt đầu fail

### 2. Deploy Render service
1. Push code lên repo
2. Vào https://dashboard.render.com → **New Web Service**
3. Connect repo, chọn thư mục `services/content-fetcher`
4. Runtime: Docker
5. Plan: **Free**
6. Set environment variables:
   - `API_KEY` → generate random string
   - `REDDIT_CLIENT_ID` → từ bước 1
   - `REDDIT_CLIENT_SECRET` → từ bước 1
7. Deploy

### 3. Kết nối Worker ↔ Render
```bash
# Set secret trên Cloudflare Worker
npx wrangler secret put CONTENT_SERVICE_KEY
# Nhập cùng giá trị API_KEY đã set trên Render
```

---

## Verification Plan

### Test thủ công sau khi deploy

**1. Test Render service trực tiếp:**
```bash
# Health check
curl https://newsdigest-content-fetcher.onrender.com/health

# YouTube transcript
curl -X POST https://newsdigest-content-fetcher.onrender.com/youtube/transcript \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"video_id": "nxwkn9Dt9-I"}'

# Reddit content
curl -X POST https://newsdigest-content-fetcher.onrender.com/reddit/content \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"url": "https://www.reddit.com/r/programming/comments/xxx"}'
```

**2. Test end-to-end qua Worker:**
```bash
# Trigger fetch cho Fireship source (đã thêm)
curl -X POST https://newsdigest.trongnguyenchromeos.workers.dev/api/sources/8347c655-5685-4acc-b4e8-c5bf4a904bb8/fetch

# Chờ queue xử lý (~1-2 phút) rồi check articles có content
curl "https://newsdigest.trongnguyenchromeos.workers.dev/api/articles?source_id=8347c655-5685-4acc-b4e8-c5bf4a904bb8" | jq '.articles[0].content'
```

**3. Kiểm tra Render logs** để xác nhận requests thành công.

---

## Chi phí & Giới hạn

| Resource | Free Tier Limit | Dự kiến sử dụng |
|---|---|---|
| Render compute | 750h/tháng | ~8h/tháng (rất dư) |
| Reddit API | 60 req/phút | ~5 req/3 giờ |
| YouTube transcript | Không giới hạn chính thức | ~10 req/3 giờ |
| Cold start | ~30-50s/lần wake | 8 lần/ngày |
