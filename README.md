# NewsDigest

AI-powered daily tech news aggregator. Automatically fetches articles from RSS, Reddit, YouTube, Hacker News, and GitHub Trending — then summarizes and scores them using Gemini AI via Cloudflare AI Gateway.

## Architecture

- **Worker** (Cloudflare Workers) — cron scraper, AI summarizer, REST API
- **Frontend** (SvelteKit on Cloudflare Pages) — PWA reader

## Quick Deploy

### Prerequisites

- Node.js 18+
- A [Cloudflare](https://dash.cloudflare.com) account (free plan works)

### 1. Install dependencies

```bash
npm install
cd fe && npm install && cd ..
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Get API keys (one-time manual setup)

Before configuring `.env`, you need to obtain API keys from several services. Follow each guide below:

#### Cloudflare AI Gateway

AI Gateway routes your Gemini API calls through Cloudflare, providing caching, rate limiting, and analytics.

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **AI** → **AI Gateway**
2. Click **Create Gateway** → name it (e.g. `newsdigest`) → Create
3. Inside the gateway, click **Providers** → **Add Provider**
4. Select **Google AI Studio** as provider
5. Go to [Google AI Studio](https://aistudio.google.com/apikey) → create an API key → paste it as the Provider Key
6. Give the key an alias (e.g. `default`)
7. From the gateway page, copy:
   - **Gateway URL** → looks like `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_name>/google-ai-studio`
   - **Auth token** → from gateway settings


#### YouTube Data API v3

Used to fetch latest videos from YouTube channels you subscribe to as sources.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or select an existing one)
3. Go to **APIs & Services** → **Library** → search **YouTube Data API v3** → **Enable**
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **API Key**
5. Copy the API key

> **Tip:** Restrict the key to only YouTube Data API v3 for security.

#### RapidAPI (YouTube Transcripts)

Used to fetch video transcripts so the AI can summarize YouTube content.

1. Go to [yt-api on RapidAPI](https://rapidapi.com/ytjar/api/yt-api)
2. Sign up / log in to RapidAPI
3. Click **Subscribe** → choose the free tier (Basic)
4. Copy your **X-RapidAPI-Key** from the code examples on the right panel

#### Admin API Key (optional)

Protects write endpoints (add/delete sources, resummarize). Generate any random string:

```bash
openssl rand -hex 32
```

### 4. Configure environment

```bash
cp .env.example .env
```

Fill in the keys you obtained above. See comments in `.env.example` for which field goes where.

### 5. Initialize Cloudflare resources

This creates D1 database, KV namespaces, Queues, Pages project, sets secrets, and runs DB migration — all idempotent (safe to re-run):

```bash
npm run cf:init
```

### 6. Deploy

```bash
npm run deploy
```

This deploys the Worker, builds the frontend with the correct API URL, and deploys to Cloudflare Pages.

## API Keys Reference

| Key | Source | Purpose |
|---|---|---|
| `AI_GATEWAY_URL` | [Cloudflare AI Gateway](https://dash.cloudflare.com) → AI → AI Gateway | Gateway URL for Gemini AI calls |
| `AI_GATEWAY_TOKEN` | Same as above → gateway settings | Authorization token |
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Fetches latest videos from YouTube channels |
| `RAPIDAPI_KEY` | [RapidAPI — yt-api](https://rapidapi.com/ytjar/api/yt-api) | Fetches YouTube subtitles/transcripts |
| `ADMIN_API_KEY` | Self-generated (`openssl rand -hex 32`) | Protects write endpoints (optional) |

## Local Development

```bash
# Terminal 1: Worker
npm run dev

# Terminal 2: Frontend
npm run dev:fe
```

The frontend needs `VITE_API_URL` to point to the Worker. For local dev, copy `fe/.env.example`:

```bash
cp fe/.env.example fe/.env.local
```

## Notes

- `npm run cf:init` can be re-run to update secrets or re-apply schema migration.
- If your Worker uses a custom domain, set `WORKER_PUBLIC_URL` in `.env`.
- Never commit `.env` or `.dev.vars`.
