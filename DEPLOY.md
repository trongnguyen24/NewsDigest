# DEPLOY.md — AI-Assisted Deployment Guide

> **For AI coding assistants** (Cursor, Copilot, Gemini, Claude, etc.)
>
> This file is the canonical step-by-step guide for deploying NewsDigest.
> Walk the user through each section **interactively** — ask for values,
> write them to `.env`, then run commands only after the user confirms.
> **Always start with the Orientation section below. Never jump straight to running commands.**

---

## ORIENTATION — Read this to the user first

> 🤖 **AI assistant:** Before doing anything, present this overview to the user in plain language. Wait for them to say they understand and are ready before proceeding to STEP 0.

---

Explain to the user:

**What is NewsDigest?**
NewsDigest is a self-hosted app with two parts:
- A **Worker** (backend API + cron job) running on Cloudflare Workers — it scrapes sources, calls the AI, and stores data.
- A **Frontend** (PWA) running on Cloudflare Pages — the reader interface.

Both are deployed to Cloudflare's free tier. The whole process takes about 10–15 minutes the first time.

---

**What accounts and keys will you need?**

| What | Where to get it | Required? |
|---|---|---|
| Cloudflare account | https://dash.cloudflare.com | ✅ Yes (free) |
| Gemini API key | https://aistudio.google.com/apikey | ✅ Yes (free) — *unless using AI Gateway* |
| RapidAPI key (yt-api) | https://rapidapi.com/ytjar/api/yt-api | ✅ Yes (free tier) |
| YouTube Data API v3 key | https://console.cloud.google.com/apis/credentials | ⬜ Only if using YouTube sources |
| Admin API key | Self-generated (`openssl rand -hex 32`) | ⬜ Optional, protects write endpoints |

> For AI: **Gemini API key** and **RapidAPI key** are the two keys that block progress if missing. Mention these first.

---

**What will happen during this setup?**

1. You fill in a `.env` file with your credentials (the AI will ask for each one)
2. `npm run cf:init` — the script auto-creates everything on Cloudflare:
   - A D1 database (SQLite), a KV namespace, two Queues, a Pages project
   - Uploads all your secrets directly to Cloudflare (they never leave your machine)
   - Runs the DB schema migration
3. `npm run deploy` — deploys the Worker and the Frontend

You do **not** need to manually create anything on the Cloudflare dashboard — `cf:init` handles it all.

---

**Nothing will be run until you say so.** Ask the user: *"Does this make sense? Ready to start?"*

---

## STEP 0 — Prerequisites

Once the user is ready, check the following before touching anything else:

```bash
node -v
```

- Node.js 18+ is required. If the version is too old, ask the user to upgrade before continuing.

```bash
npx wrangler whoami
```

- **If logged in:** show the account name/email and continue.
- **If not logged in:** explain — *"You need to link the CLI to your Cloudflare account. This opens a browser tab to authorize access. Your credentials are stored locally and are not sent anywhere else."* — then run:

```bash
npx wrangler login
```

---


## STEP 1 — Install dependencies

```bash
npm install
cd fe && npm install && cd ..
```

---

## STEP 2 — Create `.env` from template

> ⚠️ **Before copying the template, check if `.env` already exists:**
>
> ```bash
> ls -la .env
> ```
>
> - **If the file exists:** Tell the user — *"A `.env` file already exists. Overwriting it will erase your current keys. Do you want to (1) keep using the existing file and skip this step, or (2) overwrite it with a fresh template?"* — **do not run `cp` until they explicitly choose option 2.**
> - **If the file does not exist:** Proceed normally.

Ask the user which AI backend they want to use:

> **Option A — Direct Gemini API** *(simpler, recommended for first-time deploy)*
> → Requires only a free `GEMINI_API_KEY` from Google AI Studio.
>
> **Option B — Cloudflare AI Gateway** *(advanced: caching, logging, rate-limit dashboard)*
> → Requires setting up an AI Gateway on Cloudflare and adding `AI_GATEWAY_URL` + `AI_GATEWAY_TOKEN`.

Based on their choice:

```bash
# Option A:
cp .env.example .env

# Option B:
cp .env.example.gateway .env
```

---

## STEP 3 — Fill in `.env` (interactive)

The `.env` file has sensible defaults for all Cloudflare resource names (`WORKER_NAME`, `PAGES_PROJECT_NAME`, `D1_DATABASE_NAME`, KV, Queue names). **Do not ask about these** — leave them as-is unless the user explicitly says they want to change something.

Only ask the user for the values below.

### 3a. AI backend credentials

#### Option A — Direct Gemini API

Ask:
> "Please go to https://aistudio.google.com/apikey → Create API key → paste it here."

Set `GEMINI_API_KEY=<value>` in `.env`.

#### Option B — Cloudflare AI Gateway

Ask:
> "Please go to https://dash.cloudflare.com → AI → AI Gateway → Create Gateway.
> Then add a Provider: Google AI Studio, create a key at https://aistudio.google.com/apikey, paste it as the Provider Key with alias `default`.
> Once done, copy:
>   1. The Gateway URL (`https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_name>/google-ai-studio`)
>   2. The Auth token from gateway Settings"

Set:
- `AI_GATEWAY_URL=<value>`
- `AI_GATEWAY_TOKEN=<value>`

> ⚠️ Do NOT set both `GEMINI_API_KEY` and `AI_GATEWAY_*`. If both exist, `GEMINI_API_KEY` wins and the gateway is ignored.

### 3b. RapidAPI key (required for YouTube transcripts)

Ask:
> "Please go to https://rapidapi.com/ytjar/api/yt-api → Sign up → Subscribe (free tier) → copy your X-RapidAPI-Key from the code examples panel on the right."

Set `RAPIDAPI_KEY=<value>` in `.env`.

### 3c. Optional keys

Ask for each — make clear they are optional and the user can press Enter to skip:

| Variable | How to get | Purpose |
|---|---|---|
| `ADMIN_API_KEY` | Run `openssl rand -hex 32` | Protects write endpoints |
| `WORKER_PUBLIC_URL` | Your custom Worker domain (if any) | e.g. `https://api.example.com` |

For `ADMIN_API_KEY`, offer to generate one:
```bash
openssl rand -hex 32
```

### 3d. YouTube Data API v3 (optional, but needed for YouTube sources)

> YouTube RSS feeds have been blocked/unreliable for a long time.
> Without this key, YouTube channel sources **will not work**.
> Skip only if the user does not plan to add any YouTube sources.

Ask:
> "Do you have YouTube channels as sources? If yes, go to https://console.cloud.google.com/apis/credentials → Create Credentials → API key. Enable the YouTube Data API v3 in your project, then paste the key here."

Set `YOUTUBE_API_KEY=<value>` in `.env`.

### 3e. AI prompt configuration (optional)

These let the user customize language and topics without touching source code.
Ask the user if they want to customize — if not, skip this section (defaults are fine).

| Variable | Default | Description |
|---|---|---|
| `PROMPT_OUTPUT_LANGUAGE` | `Vietnamese` | Language for AI summaries and digest |
| `PROMPT_TOPIC_PRIORITIES` | `AI/LLM, Security, Dev Tools, Startup/Business` | Topics with higher relevance scores |
| `PROMPT_ALLOWED_TAGS` | `AI, Tech, Security, ...` | Tag whitelist for articles |
| `PROMPT_DIGEST_HEADINGS` | `AI & LLM, Security, ...` | Suggested digest section headings |
| `PROMPT_CUSTOM_CONTEXT` | *(empty)* | Extra plain-text instruction for AI |

Example — to run in English focused on finance:
```
PROMPT_OUTPUT_LANGUAGE=English
PROMPT_TOPIC_PRIORITIES="Finance, Climate, Policy, Energy"
PROMPT_ALLOWED_TAGS="Finance, Climate, Policy, Tech, Business, World, Science"
PROMPT_DIGEST_HEADINGS="Markets & Economy, Climate & Energy, Policy, Technology"
PROMPT_CUSTOM_CONTEXT="Focus on global financial and climate markets."
```

---

## STEP 4 — Provision Cloudflare resources

This command is **idempotent** — safe to re-run if something fails.

It will:
- Create D1 database, KV namespace, Queues, Pages project
- Upload all secrets from `.env` to Cloudflare
- Run the DB schema migration

```bash
npm run cf:init
```

If it fails, check:
- Are you logged in? (`npx wrangler whoami`)
- Are all required `.env` values filled in?
- Is `PAGES_PROJECT_NAME` globally unique?

---

## STEP 5 — Deploy

```bash
npm run deploy
```

This runs:
1. `npm run deploy:worker` — deploys the Cloudflare Worker
2. Detects the worker's public URL (auto or from `WORKER_PUBLIC_URL`)
3. `npm run deploy:fe` — builds the SvelteKit frontend with `VITE_API_URL` and deploys to Cloudflare Pages

After deploy, the frontend will be live at `https://<PAGES_PROJECT_NAME>.pages.dev`.

---

## Re-deploy / Update

After the first deploy, re-deploying is just:

```bash
npm run deploy
```

If you changed `.env` values (e.g. rotated secrets):

```bash
npm run cf:init   # re-uploads secrets
npm run deploy    # re-deploys with new config
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `cf:init` fails with "missing .env keys" | Fill in the listed variables in `.env` |
| `cf:init` fails with "not logged in" | Run `npx wrangler login` |
| `PAGES_PROJECT_NAME` already taken | Change it in `.env` to a unique value |
| Worker deploys but frontend 404s on API | Set `WORKER_PUBLIC_URL` in `.env` and re-run `cf:init` + `npm run deploy:fe` |
| Both `GEMINI_API_KEY` and gateway vars are set | Remove `GEMINI_API_KEY` if you want to use the gateway, or remove the gateway vars |
| Articles not summarizing | Check that `RAPIDAPI_KEY` and AI key are correctly set in Cloudflare secrets |

---

## Local Development (no deploy needed)

```bash
# Terminal 1: Worker
npm run dev

# Terminal 2: Frontend
npm run dev:fe
```

The frontend auto-connects to `http://localhost:8787` in dev mode — no `.env.local` needed.

---

> **Security reminder:** Never commit `.env` or `.dev.vars` to git.
> The `.gitignore` already excludes them. Double-check with `git status` before pushing.
