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