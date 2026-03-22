# Hướng dẫn Setup Dify Agent cho NewsDigest

## Tổng quan

Dify agent sẽ hoạt động như một **AI news reader** — tự lướt từng nguồn tin, scan tiêu đề, chọn bài hay, đọc sâu và tóm tắt, rồi gửi kết quả về Cloudflare Worker API.

## Yêu cầu

- Tài khoản [Dify](https://cloud.dify.ai) (Free plan)
- OpenRouter API key đã thêm vào Dify (Model Provider)
- Worker API đang chạy: `https://newsdigest.trongnguyenchromeos.workers.dev`

---

## Bước 1: Thêm Model Provider

1. Vào Dify → **Settings** → **Model Provider**
2. Click **+ Add Model Provider** → chọn **OpenRouter**
3. Nhập API key → **Save**

---

## Bước 2: Tạo Agent App

1. Vào **Studio** → **Create App** → chọn **Agent**
2. Đặt tên: `NewsDigest Reader`
3. Chọn model: chọn model từ OpenRouter (gợi ý: `google/gemini-2.0-flash` hoặc `meta-llama/llama-4-maverick`)

---

## Bước 3: Tạo Custom Tools

Vào tab **Tools** → **Custom Tools** → **Create Tool**, tạo 4 tools:

### Tool 1: `get_sources`

- **Name**: `get_sources`
- **Description**: `Lấy danh sách tất cả nguồn tin đã đăng ký`
- **Method**: `GET`
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/sources`
- **Headers**: (không cần)
- **Outputs**: 
  ```
  sources — array of source objects, mỗi source có: id, name, url, type, enabled
  ```

### Tool 2: `fetch_source_articles`

- **Name**: `fetch_source_articles`
- **Description**: `Fetch bài mới nhất từ một source cụ thể rồi trả về danh sách bài đã fetch`
- **Method**: `POST`
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/sources/{source_id}/fetch`
- **Path Parameters**: 
  - `source_id` (string, required): ID của source cần fetch
- **Outputs**:
  ```
  ok — boolean
  fetched — number, số bài tìm thấy
  inserted — number, số bài mới thêm vào DB
  ```

### Tool 3: `get_unsummarized_articles`

- **Name**: `get_unsummarized_articles`
- **Description**: `Lấy danh sách bài viết chưa được tóm tắt bởi AI`
- **Method**: `GET`
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles?unsummarized=1&limit=30`
- **Outputs**:
  ```
  articles — array of article objects, mỗi article có: id, title, url, full_text, source_id
  ```

### Tool 4: `save_summaries`

- **Name**: `save_summaries`
- **Description**: `Gửi kết quả tóm tắt AI về cho server lưu trữ`
- **Method**: `POST`
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/articles/summarize`
- **Headers**: `Content-Type: application/json`
- **Body** (JSON):
  ```json
  {
    "results": [
      {
        "id": "article_id",
        "summary": "Tóm tắt 2-3 câu",
        "hot_score": 8,
        "tags": ["AI", "Tech"]
      }
    ]
  }
  ```

### Tool 5 (Optional): `save_digest`

- **Name**: `save_digest`
- **Description**: `Lưu bài tổng hợp digest`
- **Method**: `POST`
- **URL**: `https://newsdigest.trongnguyenchromeos.workers.dev/api/digest`
- **Headers**: `Content-Type: application/json`
- **Body** (JSON):
  ```json
  {
    "summary_text": "Tổng hợp xu hướng hôm nay...",
    "top_article_ids": ["id1", "id2", "id3"]
  }
  ```

---

## Bước 4: Viết System Prompt cho Agent

Paste vào phần **Instructions** của Agent:

```
Bạn là một AI news reader chuyên nghiệp. Nhiệm vụ của bạn là lướt tin tức giống như một biên tập viên — vào từng nguồn tin, scan tiêu đề, chọn bài hay để đọc sâu, tóm tắt, và cuối cùng viết bản tổng hợp.

## Quy trình làm việc

1. **Lấy danh sách nguồn tin**: Gọi tool `get_sources` để biết có bao nhiêu nguồn.

2. **Fetch bài mới**: Với mỗi source đang enabled, gọi `fetch_source_articles` để cập nhật bài mới nhất.

3. **Lấy bài chưa xử lý**: Gọi `get_unsummarized_articles` để lấy danh sách bài chưa được tóm tắt.

4. **Scan và đánh giá**: Đọc tiêu đề + nội dung (full_text) từng bài rồi:
   - Tóm tắt bằng tiếng Việt, 2-3 câu ngắn gọn, súc tích
   - Chấm điểm hot_score từ 1-10 (10 = viral, hay nhất)
   - Gắn tags phù hợp (chọn từ: AI, Tech, Security, Business, Vietnam, World, Dev, Science, Crypto, Policy, Entertainment)
   
5. **Lưu kết quả**: Gọi `save_summaries` với tất cả kết quả.

6. **Viết digest**: Sau khi xử lý hết, viết 1 đoạn digest tổng hợp (3-5 câu) mô tả xu hướng nổi bật nhất, sau đó gọi `save_digest`.

## Quy tắc đánh giá hot_score
- 9-10: Tin động đất, breakthrough technology, major event
- 7-8: Tin hay, đáng đọc, nhiều người quan tâm
- 5-6: Tin bình thường, có giá trị thông tin
- 3-4: Tin nhàm, spam, quảng cáo → vẫn tóm tắt nhưng score thấp
- 1-2: Click-bait, spam rõ ràng

## Phong cách viết
- Ngắn gọn, khách quan, như biên tập viên tin tức
- Tóm tắt bằng tiếng Việt
- Nếu bài gốc tiếng Anh, dịch tóm tắt sang tiếng Việt
- Giữ nguyên thuật ngữ kỹ thuật (AI, API, Docker, etc.)
```

---

## Bước 5: Tạo Scheduled Trigger (Optional)

Để agent tự chạy định kỳ:

1. Vào **Orchestrate** → **Triggers**
2. Chọn **Schedule** → Set cron: mỗi 3 giờ (hoặc 6 giờ)
3. Input message: `Hãy lướt tin tức mới nhất và tóm tắt cho tôi`

Hoặc bạn có thể gọi thủ công bằng cách mở Agent chat và nhắn:
```
Lướt tin mới nhất đi
```

---

## Bước 6: Test

1. Vào Agent chat
2. Nhắn: `Lấy danh sách nguồn tin cho tôi xem`
3. Agent sẽ gọi tool `get_sources` → trả về danh sách
4. Nhắn: `Fetch bài mới và tóm tắt cho tôi`
5. Agent sẽ chạy toàn bộ quy trình tự động

---

## API Reference

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/sources` | GET | Danh sách nguồn tin |
| `/api/sources` | POST | Thêm nguồn mới |
| `/api/sources/:id/fetch` | POST | Fetch bài từ nguồn |
| `/api/articles?unsummarized=1` | GET | Bài chưa tóm tắt |
| `/api/articles/summarize` | POST | Gửi kết quả tóm tắt |
| `/api/digest` | POST | Gửi digest tổng hợp |
| `/api/articles` | GET | Tất cả bài viết (support filter) |
| `/api/digest/latest` | GET | Digest mới nhất |

**Base URL**: `https://newsdigest.trongnguyenchromeos.workers.dev`

---

## Troubleshooting

- **Agent không gọi được API**: Kiểm tra URL trong tool config đúng chưa
- **CORS error**: Worker đã có CORS middleware, nếu vẫn lỗi thì kiểm tra lại Dify tool settings
- **Không có bài mới**: Cần thêm sources trước (qua frontend hoặc API) 
- **Tóm tắt bị sai ngôn ngữ**: Đảm bảo prompt yêu cầu "tóm tắt bằng tiếng Việt"
