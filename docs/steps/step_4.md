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