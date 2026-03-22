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