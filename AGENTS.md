# AGENTS.md — NewsDigest

Guidelines for AI coding agents working with this codebase.

---

## Project Overview

NewsDigest is a personal PWA news aggregator running entirely on the Cloudflare stack:

- **Worker** (`/worker`) — Cloudflare Worker built with Hono + TypeScript: cron scraper, queue consumer, REST API
- **Frontend** (`/fe`) — SvelteKit + Tailwind CSS v4 + shadcn-svelte, deployed to Cloudflare Pages
- **AI** — Gemini (via Cloudflare AI Gateway) for article summarization + daily digest generation

Main flow: Cron → scrape sources → insert articles into D1 → enqueue to Queue → queue consumer fetches content + calls AI → FE reads via REST API.

---

## Directory Structure

```
/
├── worker/                     # Cloudflare Worker (backend)
│   ├── index.ts                # Entry point: fetch / scheduled / queue handlers
│   ├── types.ts                # Env interface + all shared types
│   ├── api/
│   │   ├── index.ts            # Hono app, route mounting
│   │   └── routes/
│   │       ├── articles.ts     # GET /api/articles, POST /api/articles/resummarize, ...
│   │       ├── sources.ts      # CRUD sources
│   │       ├── digest.ts       # GET /api/digest
│   │       └── scraper.ts      # Admin: scraper config management
│   ├── cron/
│   │   ├── index.ts            # scheduled() — main scrape loop (every 3h)
│   │   ├── scraper.ts          # fetchSource() + extractArticleContent() + listing/profile logic
│   │   ├── digest.ts           # scheduledDigest() — create/update daily digest
│   │   ├── retry-failed.ts     # retryFailedArticles() — runs every 30 minutes
│   │   ├── site-profiles.ts    # Static hardcoded scraper profiles per domain
│   │   └── cleanup.ts          # cleanOldContent() — purge content older than 7 days
│   ├── queue/
│   │   └── content-scraper.ts  # handleContentQueue() — scrape content + AI summarize
│   └── ai/
│       ├── summarizer.ts       # summarizeArticle() + generateDigest() + Gemini API call logic
│       └── scraper-profile.ts  # AI-generated CSS selector profiles
├── fe/                         # SvelteKit frontend (PWA)
│   └── src/
│       ├── lib/
│       │   ├── api.ts          # API_BASE + api() helper
│       │   ├── types.ts        # Article, Source, Digest interfaces
│       │   ├── stores/         # Svelte stores (articles, sources, cache, prefs)
│       │   └── components/     # UI components (app/ and ui/)
│       └── routes/
│           ├── +page.svelte    # Main article feed
│           └── sources/        # Source management page
├── scripts/
│   ├── cf-init.mjs             # One-time Cloudflare resource setup (D1, KV, Queue, Pages)
│   ├── deploy.mjs              # Full deploy: worker + fe
│   ├── deploy-fe.mjs           # Frontend-only deploy
│   └── fix-known-sources.mjs   # Seed/fix known sources
├── schema.sql                  # D1 schema (sources, articles, digests, scraper_configs)
└── .env.example                # Environment variable template
```

---

## Database Schema (D1)

Four main tables — see `schema.sql` for full definitions:

| Table | Description |
|---|---|
| `sources` | User-added news sources. Types: `rss`, `html`, `reddit`, `youtube`, `voz`, `github-trending` |
| `articles` | Collected articles. `summary`, `hot_score`, and `tags` are populated later by AI. `content` is set to NULL after AI processing |
| `digests` | Daily AI-generated digest, one row per day (`digest_date` UNIQUE), upserted every 3h |
| `scraper_configs` | AI-learned CSS selector profiles (per domain, mode `html` or `listing`) |

**Important notes on `articles`:**
- `content` is temporary — it is SET NULL after AI summarization completes, to save D1 storage
- `summary IS NULL` = article not yet processed by AI (used as the retry condition)
- `summary = '[blocked]'` = blocked by Gemini safety filters, do not retry

---

## Cron Schedule

| Cron | Handler | What it does |
|---|---|---|
| `0 */3 * * *` | `scheduled()` → `scheduledDigest()` | Scrape all sources (except github-trending) → generate daily digest |
| `0 1 * * *` | `scheduled()` → `cleanOldContent()` | Scrape github-trending only + purge content older than 7 days |
| `*/30 * * * *` | `retryFailedArticles()` | Re-enqueue failed articles (no summary) within the last 3 days |

---

## Source Types & Fetch Strategy

Each source type has its own fetcher in `worker/cron/scraper.ts`:

| Type | Fetcher | Notes |
|---|---|---|
| `rss` | `fetchRSS()` | Supports RSS, Atom, RDF, JSON Feed. Automatic charset detection |
| `youtube` | `fetchYouTube()` | RSS feed first → fallback to YouTube Data API v3. Channel ID cached in `sources.channel_id` |
| `reddit` | `fetchReddit()` | Reddit JSON API (`/hot.json`). Sequential with 15s stagger to avoid rate limits |
| `github-trending` | `fetchGitHubTrending()` | HTMLRewriter scrape of `github.com/trending` |
| `voz` | `fetchVoz()` | HTMLRewriter scrape of `voz.vn` |
| `html` | `fetchUnknown()` | AI-learned listing profiles (CSS selectors stored in D1) |

---

## Queue Flow (Content Scraping)

```
Cron inserts article → CONTENT_QUEUE.sendBatch()
    ↓
handleContentQueue() [worker/queue/content-scraper.ts]
    ├── YouTube URL  → RapidAPI yt-api /subtitles → parse XML transcript
    ├── Reddit URL   → reddit.com/.json (post + top comments)
    ├── GitHub repo  → GitHub API /readme → raw download
    └── Other        → extractArticleContent() (HTMLRewriter + AI profiles)
    ↓
summarizeArticle() [worker/ai/summarizer.ts]
    ├── JSON mode (Gemini, retry 3x, alternating models)
    └── Fallback: 4-step plain text (description_vn → summary → score → tags)
    ↓
UPDATE articles SET summary=?, hot_score=?, tags=?, content=NULL
```

**Reddit articles** are enqueued with per-message `delaySeconds` stagger (15s per article) to avoid 429s.

---

## AI / Gemini Integration

File: `worker/ai/summarizer.ts`

- Model pool: `gemma-4-31b-it` and `gemma-4-26b-a4b-it` — random pick + automatic failover on 429
- Called via Cloudflare AI Gateway (BYOK with Google AI Studio key)
- Auth headers: `cf-aig-authorization: Bearer <token>` + `cf-aig-byok-alias: default`
- JSON mode (`responseMimeType: 'application/json'`) — `extractJson()` handles repair/fallback parsing
- `ProhibitedContentError` = blocked by safety filters, do NOT retry, marks `summary='[blocked]'`

**Article output schema:**
```ts
{ description_vn: string, summary: string (Markdown), hot_score: 1-10, tags: string[] }
```

**Digest output schema:**
```ts
{ digest_text: string } // Markdown with inline <id:uuid> references
```

---

## REST API Endpoints

Base URL: Worker URL (local: `http://localhost:8787`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/articles` | — | List articles with pagination and filters (tag, source_id, min_hot, from/to, ids) |
| GET | `/api/articles/:id` | — | Single article detail |
| POST | `/api/articles/resummarize` | Admin | Re-run AI on articles that have content but no summary |
| POST | `/api/articles/enqueue-scrape` | — | Manually enqueue articles to the Queue for content scraping |
| GET | `/api/sources` | — | List all sources |
| POST | `/api/sources` | Admin | Add a new source |
| DELETE | `/api/sources/:id` | Admin | Delete a source |
| GET | `/api/digest` | — | Get digest (defaults to today) |
| GET | `/api/scraper-configs` | Admin | View AI-learned scraper profiles |
| DELETE | `/api/scraper-configs/:domain` | Admin | Delete a domain's scraper profile |

Admin auth: `X-Admin-Key: <ADMIN_API_KEY>` header. Auth is skipped if `ADMIN_API_KEY` is not set.

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `AI_GATEWAY_URL` | ✅ | `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/google-ai-studio` |
| `AI_GATEWAY_TOKEN` | ✅ | Auth token from Cloudflare AI Gateway |
| `RAPIDAPI_KEY` | ✅ | YouTube transcript fetching via yt-api.p.rapidapi.com |
| `YOUTUBE_API_KEY` | ☑️ | Fallback when YouTube RSS feeds are unavailable |
| `ADMIN_API_KEY` | ☑️ | Protects write endpoints |

Cloudflare bindings defined in the `Env` interface (`worker/types.ts`): `DB` (D1), `SCRAPER_CONFIG` (KV), `CONTENT_QUEUE` (Queue).

---

## Local Development

```bash
# Install dependencies
npm install && cd fe && npm install && cd ..

# Copy env files
cp .env.example .env              # fill in AI_GATEWAY_URL, AI_GATEWAY_TOKEN, RAPIDAPI_KEY
cp fe/.env.example fe/.env.local  # set VITE_API_URL=http://localhost:8787

# Terminal 1: Worker (localhost:8787)
npm run dev

# Terminal 2: Frontend (localhost:5173)
npm run dev:fe
```

---

## Deploy

```bash
# First-time setup (creates D1, KV, Queue, Pages project)
npm run cf:init

# Full deploy (worker + frontend)
npm run deploy

# Frontend only
npm run deploy:fe

# Worker only
npm run deploy:worker
```

---

## Conventions & Important Gotchas

**TypeScript / Worker:**
- All types are defined in `worker/types.ts` — do not create duplicate type definitions elsewhere
- Env bindings must match `wrangler.toml` (D1 `DB`, KV `SCRAPER_CONFIG`, Queue `CONTENT_QUEUE`)
- Workers free plan has a 6 subrequest limit — use `sendBatch()` instead of looping `send()`
- Reddit fetching is always sequential, never parallel (rate limits from Cloudflare datacenter IPs)
- `content` column is temporary storage — it is always set NULL after AI processing, do not use it as a long-term cache

**AI / Scraper:**
- `scraper_configs` caches AI-learned CSS selectors — invalidate by deleting the row via the admin API
- YouTube `channel_id` is cached in `sources.channel_id` after the first successful resolve
- Listing profiles (`mode='listing'`) and content profiles (`mode='html'`) are two distinct profile types

**Frontend (SvelteKit):**
- `API_BASE` is injected at build time via `VITE_API_URL` — never hardcode the Worker URL
- TypeScript interfaces in `fe/src/lib/types.ts` must stay in sync with `worker/types.ts`
- Deployed to Cloudflare Pages using the static adapter — no SSR
- PWA service worker is at `fe/src/service-worker.ts`

**Gemini rate limits:**
- 2 models in the pool (RPM=15 each → effective RPM=30)
- On 429, auto-switches to the other model with exponential backoff
- Digest generation uses a 120s timeout (larger prompt due to batching 40+ articles)
