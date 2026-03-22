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