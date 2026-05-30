import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from '../types';

import articles from './routes/articles';
import digest   from './routes/digest';
import reddit   from './routes/reddit';
import sources  from './routes/sources';
import scraper  from './routes/scraper';
import { requireAdmin } from './utils';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

// ── Auth verify (rate-limited) ───────────────────────────
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_SECONDS = 300; // 5 minutes

app.post('/api/auth/verify', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const kvKey = `auth_rate:${ip}`;

  // Check rate limit
  const raw = await c.env.SCRAPER_CONFIG.get(kvKey);
  const attempts = parseInt(raw || '0', 10);
  if (attempts >= AUTH_MAX_ATTEMPTS) {
    return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  }

  const authErr = requireAdmin(c);
  if (authErr) {
    // Increment failed attempts
    await c.env.SCRAPER_CONFIG.put(kvKey, String(attempts + 1), {
      expirationTtl: AUTH_WINDOW_SECONDS,
    });
    return authErr;
  }

  // Success — clear rate limit counter
  await c.env.SCRAPER_CONFIG.delete(kvKey);
  return c.json({ ok: true });
});

app.route('/api/articles', articles);
app.route('/api/digest',   digest);
app.route('/api/reddit',   reddit);
app.route('/api/sources',  sources);
app.route('/api',          scraper); // scraper routes keep their full paths (/api/scraper-configs, /api/scraper-profile/test)

export default app;
