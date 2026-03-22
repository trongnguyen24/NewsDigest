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