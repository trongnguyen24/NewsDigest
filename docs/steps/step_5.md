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