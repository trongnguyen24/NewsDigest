# AGENTS.md — NewsDigest

> AI agent context for the NewsDigest codebase.
> For full specs, see `docs/PROJECT_SPEC.md`. For DB schema, see `schema.sql`. For API endpoints, see `worker/api/index.ts`.

---

## 1. What This Is

Personal PWA that aggregates tech news (RSS, Reddit, YouTube, VOZ, GitHub Trending, HTML blogs), summarizes articles with Gemini AI, scores them 1–10, and generates a daily digest in Vietnamese.

---

## 2. Stack

| Layer | Technology |
|---|---|
| Frontend | SvelteKit 2 + Svelte 5 (runes) + TypeScript |
| UI | shadcn-svelte + Tailwind CSS v4 + lucide-svelte + bits-ui |
| Frontend Hosting | Cloudflare Pages |
| Backend / API | Cloudflare Workers + Hono router |
| Database | Cloudflare D1 (SQLite) |
| Queue | Cloudflare Queues |
| AI | Gemini 3.1 Flash Lite via Cloudflare AI Gateway |

---

## 3. Architecture

```
[Sources]              [Cloudflare Edge]                  [AI / External]
  RSS/Atom  ────────▶  Cron Worker (3h)
  HTML Blog ────────▶    │ fetch + parse                  Gemini AI
  Reddit    ────────▶    │ dedup (INSERT OR IGNORE)       (via CF AI Gateway)
  YouTube   ────────▶    ▼                                      │
  VOZ       ────────▶  D1 Database ◄──── Queue Consumer ───────▶│
  GitHub    ────────▶    ▲               scrape + AI summarize
                         │
[Frontend]               │
  SvelteKit PWA ───────▶ API Worker (Hono)
  Cloudflare Pages
```

---

## 4. Key Entry Points

| File | Purpose |
|---|---|
| `worker/index.ts` | Exports 3 handlers: `fetch` (API), `scheduled` (cron), `queue` (consumer) |
| `worker/api/index.ts` | All Hono API routes (~744 lines) |
| `worker/cron/scraper.ts` | Source adapters: RSS, Reddit, YouTube, VOZ, GitHub, HTML |
| `worker/queue/content-scraper.ts` | Queue consumer: fetch content → AI summarize pipeline |
| `worker/ai/summarizer.ts` | Gemini calls: `summarizeArticle()`, `generateDigest()` |
| `fe/src/routes/+page.svelte` | Main feed (articles + digest) |
| `fe/src/lib/types.ts` | Shared TypeScript interfaces |

---

## 5. Data Pipeline

```
Cron (every 3h)
  → fetch sources → INSERT OR IGNORE articles → enqueue to CONTENT_QUEUE

Queue Consumer
  → fetch full content (by URL type: YouTube/Reddit/GitHub/HTML)
  → summarizeArticle() → save summary, description_vn, hot_score, tags
  → SET content = NULL  ← important: content is temporary storage only

Digest (after each cron scrape)
  → generateDigest() on today's summarized articles → UPSERT digests table

Retry (every 30min)
  → re-enqueue articles missing summary within last 3 days
```

**Reddit special case:** existing posts re-enqueue if score increases ≥ 50 or comments increase ≥ 50 → resets summary + moves to current day.

---

## 6. Conventions — Read Before Editing

### Svelte 5 Runes (mandatory)

```svelte
<!-- ✅ Correct -->
let { score }: { score: number } = $props();
let count = $state(0);
let doubled = $derived(count * 2);
$effect(() => { ... });

<!-- ❌ Wrong — DO NOT use Svelte 4 syntax -->
export let score;
$: doubled = count * 2;
```

### Other Hard Rules

- **Tailwind v4:** Config is in CSS (`@import`). No `tailwind.config.js`.
- **shadcn-svelte:** DO NOT edit `fe/src/lib/components/ui/` manually. Add components via CLI only:
  ```bash
  npx shadcn-svelte@latest add {component-name}
  ```
- **TypeScript** is mandatory everywhere (worker + frontend).
- **Timezones:** Digests use VN timezone (UTC+7). Everything else uses UTC.
- **AI calls** always go through Cloudflare AI Gateway, never directly to Google.
- **Queue:** `max_batch_size = 1` — consumer processes one article at a time.
- **Dead letter queue:** `article-content-dlq` for messages failing after 3 retries.
- **Reddit rate limit:** 7s stagger between requests inside `fetchReddit()`.

---

## 7. Dev Commands

```bash
# Local dev
npm run dev       # Worker (terminal 1)
npm run dev:fe    # Frontend (terminal 2)

# Deploy
npm run deploy          # Worker + frontend
npm run deploy:worker
npm run deploy:fe

# DB migration
wrangler d1 execute newsdigest --local --file=schema.sql   # local
wrangler d1 execute newsdigest --remote --file=schema.sql  # remote
```
