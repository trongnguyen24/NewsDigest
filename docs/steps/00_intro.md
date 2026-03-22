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