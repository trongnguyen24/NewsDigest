import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { XMLParser } from 'fast-xml-parser';
import { Env, Source } from '../types';
import type { Context } from 'hono';

const app = new Hono<{ Bindings: Env }>();

/** Check X-Admin-Key header against ADMIN_API_KEY secret. Returns error Response or null. */
function requireAdmin(c: Context<{ Bindings: Env }>): Response | null {
  const adminKey = c.env.ADMIN_API_KEY;
  if (!adminKey) return null; // no key configured → skip check
  const provided = c.req.header('X-Admin-Key');
  if (provided !== adminKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

/** Chuẩn hoá published_at về ISO 8601 UTC. */
function normalizeDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const COMMON_FEED_PATHS = [
  '/rss',
  '/rss/',
  '/rss.xml',
  '/feed',
  '/feed/',
  '/feed.xml',
  '/atom.xml',
  '/index.xml',
];

const ALLOWED_SOURCE_TYPES: Source['type'][] = ['rss', 'html', 'reddit', 'youtube', 'voz', 'github-trending'];

function parseFeedShape(xml: string): boolean {
  const parser = new XMLParser({
    ignoreAttributes: false,
    textNodeName: '_text',
  });
  try {
    const parsed: any = parser.parse(xml);
    return Boolean(parsed?.rss?.channel || parsed?.feed);
  } catch {
    return false;
  }
}

function isHtmlLike(contentType: string, text: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html')) return true;
  const sample = text.slice(0, 800).toLowerCase();
  return sample.includes('<!doctype html') || sample.includes('<html');
}

function getAttr(tag: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return (tag.match(re)?.[2] || '').trim();
}

function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = getAttr(tag, 'rel').toLowerCase();
    if (!rel.split(/\s+/).includes('canonical')) continue;
    const href = getAttr(tag, 'href');
    if (!href) continue;
    try {
      return new URL(href, fallbackUrl).toString();
    } catch {
      continue;
    }
  }
  return fallbackUrl;
}

function extractFeedLinksFromHtml(html: string, baseUrl: string): string[] {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const links: string[] = [];
  for (const tag of tags) {
    const rel = getAttr(tag, 'rel').toLowerCase();
    const type = getAttr(tag, 'type').toLowerCase();
    const href = getAttr(tag, 'href');
    if (!href) continue;
    if (!rel.split(/\s+/).includes('alternate')) continue;
    if (!(type.includes('application/rss+xml') || type.includes('application/atom+xml'))) continue;

    try {
      links.push(new URL(href, baseUrl).toString());
    } catch {
      // ignore invalid URLs
    }
  }
  return [...new Set(links)];
}

async function isValidFeedUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NewsDigest/1.0.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    if (isHtmlLike(contentType, text)) return false;
    return parseFeedShape(text);
  } catch {
    return false;
  }
}

function detectSpecialType(url: string): Source['type'] | null {
  const lower = url.toLowerCase();
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('voz.vn')) return 'voz';
  if (lower.includes('github.com/trending')) return 'github-trending';
  return null;
}

async function resolveSource(url: string): Promise<{
  resolved_url: string;
  detected_type: Source['type'];
  detection_method: string;
}> {
  const normalizedInput = new URL(url).toString();
  const special = detectSpecialType(normalizedInput);
  if (special) {
    return {
      resolved_url: normalizedInput,
      detected_type: special,
      detection_method: 'known-source-type',
    };
  }

  const initial = await fetch(normalizedInput, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  if (!initial.ok) {
    throw new Error(`Source URL failed: ${initial.status}`);
  }

  const finalUrl = initial.url || normalizedInput;
  const body = await initial.text();
  const contentType = initial.headers.get('content-type') || '';

  if (!isHtmlLike(contentType, body) && parseFeedShape(body)) {
    return {
      resolved_url: finalUrl,
      detected_type: 'rss',
      detection_method: 'direct-xml',
    };
  }

  const canonicalUrl = extractCanonicalUrl(body, finalUrl);
  const fromHtml = extractFeedLinksFromHtml(body, canonicalUrl);
  for (const candidate of fromHtml) {
    if (await isValidFeedUrl(candidate)) {
      return {
        resolved_url: candidate,
        detected_type: 'rss',
        detection_method: 'html-link-alternate',
      };
    }
  }

  const canonical = new URL(canonicalUrl);
  const pathParts = canonical.pathname.split('/').filter(Boolean);
  const basePath = pathParts.length > 0 ? `/${pathParts[0]}` : '';
  const candidates = [
    ...COMMON_FEED_PATHS.map((p) => `${canonical.origin}${p}`),
    ...(basePath ? COMMON_FEED_PATHS.map((p) => `${canonical.origin}${basePath}${p}`) : []),
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (await isValidFeedUrl(candidate)) {
      return {
        resolved_url: candidate,
        detected_type: 'rss',
        detection_method: 'common-path',
      };
    }
  }

  return {
    resolved_url: canonicalUrl,
    detected_type: 'html',
    detection_method: 'html-fallback',
  };
}

app.use('/api/*', cors());

// ── Articles ─────────────────────────────────────────────

app.get('/api/articles', async (c) => {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 200);
    const tag = c.req.query('tag') || '';
    const sourceId = c.req.query('source_id') || '';
    const minHot = parseInt(c.req.query('min_hot') || '0');
    const sort = c.req.query('sort') === 'hot' ? 'hot_score DESC' : 'published_at DESC';

    const unsummarized = c.req.query('unsummarized');
    const compact = c.req.query('compact');
    const ids = c.req.query('ids');
    const offset = (page - 1) * limit;

    // compact=1 → chỉ trả id, title, url, source_id, published_at
    // default → trả tất cả trừ content (content đã được NULL sau AI xử lý)
    const fields = compact === '1'
        ? 'id, title, url, source_id, published_at'
        : 'id, source_id, url, title, summary, description, description_vn, hot_score, tags, published_at, fetched_at';

    let where = 'WHERE 1=1';
    const binds: any[] = [];

    // ids filter: GET /api/articles?ids=id1,id2,id3
    if (ids) {
        const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
        if (idList.length > 0) {
            where += ` AND id IN (${idList.map(() => '?').join(',')})`;
            binds.push(...idList);
        }
    }

    if (tag) { where += ' AND tags LIKE ?'; binds.push(`%"${tag}"%`); }
    if (sourceId) { where += ' AND source_id = ?'; binds.push(sourceId); }
    if (minHot > 0) { where += ' AND hot_score >= ?'; binds.push(minHot); }

    if (unsummarized === '1') { where += ' AND summary IS NULL'; }

    // Date range filter (ISO 8601 UTC strings — index-friendly)
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (from) { where += ' AND published_at >= ?'; binds.push(from); }
    if (to)   { where += ' AND published_at < ?';  binds.push(to); }

    const countStmt = c.env.DB.prepare(`SELECT COUNT(*) as total FROM articles ${where}`);
    const dataStmt = c.env.DB.prepare(
        `SELECT ${fields} FROM articles ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`
    );

    const countBinds = [...binds];
    const dataBinds = [...binds, limit, offset];

    const [countRes, dataRes] = await Promise.all([
        countBinds.length > 0 ? countStmt.bind(...countBinds).all() : countStmt.all(),
        dataBinds.length > 0 ? dataStmt.bind(...dataBinds).all() : dataStmt.all(),
    ]);

    const total = (countRes.results[0] as any)?.total || 0;
    return c.json({ articles: dataRes.results, total, page, nextPage: offset + limit < total ? page + 1 : null });
});

app.get('/api/articles/:id', async (c) => {
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).all();
    if (!results || results.length === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ article: results[0] });
});



/**
 * POST /api/articles/enrich
 * Fetch nội dung bài viết từ URL gốc cho các article chưa có content.
 * Body: { ids: ["id1", "id2", ...], force?: boolean }
 * Sẽ fetch song song (tối đa 5 cùng lúc) và update content vào DB.
 */
app.post('/api/articles/enrich', async (c) => {
    const body = await c.req.json();
    const ids = body.ids;
    const force = body.force === true;

    if (!Array.isArray(ids) || ids.length === 0) {
        return c.json({ error: 'ids array required' }, 400);
    }

    const placeholders = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
        `SELECT id, url, description, content FROM articles WHERE id IN (${placeholders})`
    ).bind(...ids).all();

    if (!results || results.length === 0) {
        return c.json({ ok: true, enriched: 0, message: 'No articles found' });
    }

    const { extractArticleContent } = await import('../cron/scraper');
    const enrichResults: { id: string; success: boolean; chars: number; skipped?: boolean; note?: string }[] = [];

    // Kiểm tra content có phải rác không
    function isLowQuality(text: string | null): boolean {
        if (!text || text.length < 100) return true;
        // HN RSS metadata
        if (text.includes('Article URL:') && text.includes('Points:')) return true;
        // Reddit navigation
        if (text.includes('Skip to main content') || text.includes('Go to Reddit Home')) return true;
        // Chủ yếu HTML tags
        const stripped = text.replace(/<[^>]+>/g, '').trim();
        if (stripped.length < 100) return true;
        return false;
    }

    // Trích xuất URL bài gốc từ HN RSS description
    function extractHNArticleUrl(description: string): string | null {
        const match = description.match(/Article URL:\s*<a href="([^"]+)"/);
        return match ? match[1] : null;
    }

    const articles = results as any[];
    for (let i = 0; i < articles.length; i += 5) {
        const batch = articles.slice(i, i + 5);
        const promises = batch.map(async (art: any) => {
            // Skip nếu đã có content tốt (trừ khi force=true)
            if (!force && art.content && !isLowQuality(art.content)) {
                return { id: art.id, success: true, chars: art.content.length, skipped: true };
            }

            // Skip Reddit URLs (JS-rendered, không extract được)
            if (art.url.includes('reddit.com')) {
                return { id: art.id, success: false, chars: 0, note: 'Reddit URLs are JS-rendered' };
            }

            // Xác định URL cần fetch
            let fetchUrl = art.url;

            // Nếu bài HN, lấy article URL thay vì HN page
            if (art.description && extractHNArticleUrl(art.description)) {
                fetchUrl = extractHNArticleUrl(art.description)!;
            } else if (art.url.includes('news.ycombinator.com')) {
                // Ask HN / Show HN — nội dung nằm trong RSS description, chỉ cần strip HTML
                if (art.description) {
                    const cleaned = art.description
                        .replace(/<hr\s*\/?>/gi, '\n---\n')
                        .replace(/<p>/gi, '\n')
                        .replace(/<[^>]+>/g, '')
                        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
                        // Loại bỏ metadata cuối (Comments URL, Points)
                        .replace(/\n---\n[\s\S]*$/, '')
                        .trim();
                    if (cleaned.length > 50) {
                        await c.env.DB.prepare('UPDATE articles SET content = ? WHERE id = ?')
                            .bind(cleaned, art.id).run();
                        return { id: art.id, success: true, chars: cleaned.length };
                    }
                }
                return { id: art.id, success: false, chars: 0, note: 'HN text post with no content' };
            }

            const content = await extractArticleContent(fetchUrl, c.env);
            if (content && content.length > 50) {
                await c.env.DB.prepare('UPDATE articles SET content = ? WHERE id = ?')
                    .bind(content, art.id).run();
                return { id: art.id, success: true, chars: content.length };
            }
            return { id: art.id, success: false, chars: 0, note: 'Could not extract content' };
        });

        const batchResults = await Promise.all(promises);
        enrichResults.push(...batchResults);
    }

    const enriched = enrichResults.filter(r => r.success && !r.skipped).length;
    return c.json({ ok: true, enriched, total: articles.length, results: enrichResults });
});

/**
 * POST /api/articles/enqueue-scrape
 * Enqueue articles chưa có content vào Queue để cào nội dung.
 * Body (optional): { limit?: number, force?: boolean }
 * - limit: số lượng tối đa (default 50)
 * - force: true = enqueue cả những bài đã có content
 */
app.post('/api/articles/enqueue-scrape', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 200);
    const force = body.force === true;

    const condition = force ? '1=1' : 'summary IS NULL';
    const { results } = await c.env.DB.prepare(
        `SELECT id, url, title FROM articles WHERE ${condition} ORDER BY fetched_at DESC LIMIT ?`
    ).bind(limit).all<{ id: string; url: string; title: string }>();

    if (!results || results.length === 0) {
        return c.json({ ok: true, enqueued: 0, message: 'No articles to scrape' });
    }

    const normalArticles = results.filter(a => !a.url.includes('reddit.com'));
    const redditArticles = results.filter(a => a.url.includes('reddit.com'));

    // Enqueue normal articles in batches of 25 (Queue limit per sendBatch)
    let enqueued = 0;
    for (let i = 0; i < normalArticles.length; i += 25) {
        const batch = normalArticles.slice(i, i + 25);
        await c.env.CONTENT_QUEUE.sendBatch(
            batch.map(a => ({ body: { articleId: a.id, url: a.url, title: a.title } }))
        );
        enqueued += batch.length;
    }

    // Enqueue Reddit articles with 7 seconds delay between each (100 req/10 mins limit)
    for (let i = 0; i < redditArticles.length; i++) {
        await c.env.CONTENT_QUEUE.send(
            { articleId: redditArticles[i].id, url: redditArticles[i].url, title: redditArticles[i].title },
            { delaySeconds: i * 7 }
        );
        enqueued++;
    }

    return c.json({ ok: true, enqueued, message: `Enqueued ${enqueued} articles for content scraping` });
});

/**
 * POST /api/digest/generate
 * Manual trigger digest generation.
 */
app.post('/api/digest/generate', async (c) => {
    const { scheduledDigest } = await import('../cron/digest');
    await scheduledDigest(c.env);
    return c.json({ ok: true, message: 'Digest generation triggered' });
});

/**
 * POST /api/articles/resummarize
 * Retry AI summarization cho các bài đã có content nhưng chưa có summary
 * (do Gemini bị overload/rate-limit lúc scrape).
 * Body (optional): { limit?: number, delayMs?: number }
 * - limit: số bài tối đa (default 20, max 100)
 * - delayMs: delay giữa mỗi lần gọi Gemini (default 3000ms)
 */
app.post('/api/articles/resummarize', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 20, 100);
    const delayMs = Math.max(body.delayMs || 3000, 1000);

    const { results } = await c.env.DB.prepare(
        `SELECT id, title, content FROM articles
         WHERE content IS NOT NULL AND content != '' AND summary IS NULL
         ORDER BY fetched_at DESC LIMIT ?`
    ).bind(limit).all<{ id: string; title: string; content: string }>();

    if (!results || results.length === 0) {
        return c.json({ ok: true, summarized: 0, failed: 0, total: 0, message: 'No unsummarized articles with content found' });
    }

    const { summarizeArticle } = await import('../ai/summarizer');
    const summaryResults: { id: string; title: string; success: boolean; error?: string }[] = [];
    let summarized = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
        const art = results[i];
        try {
            const aiResult = await summarizeArticle(art.title || '', art.content, c.env);
            if (aiResult) {
                await c.env.DB.prepare(
                    'UPDATE articles SET description_vn = ?, summary = ?, hot_score = ?, tags = ?, content = NULL WHERE id = ?'
                ).bind(aiResult.description_vn, aiResult.summary, aiResult.hot_score, JSON.stringify(aiResult.tags), art.id).run();
                summarized++;
                summaryResults.push({ id: art.id, title: art.title, success: true });
                console.log(`🔄 Resummarized [${i + 1}/${results.length}]: "${art.title}" → score=${aiResult.hot_score}`);
            } else {
                failed++;
                summaryResults.push({ id: art.id, title: art.title, success: false, error: 'AI returned null' });
            }
        } catch (err: any) {
            failed++;
            summaryResults.push({ id: art.id, title: art.title, success: false, error: err.message });
            console.log(`⚠️ Resummarize failed [${i + 1}/${results.length}]: "${art.title}" — ${err.message}`);
            // Nếu 429, tăng delay lên gấp đôi cho các bài còn lại
            if (err.message?.includes('429')) {
                console.log(`⏳ Rate limited — doubling delay for remaining articles`);
                await new Promise(r => setTimeout(r, delayMs * 2));
                continue;
            }
        }

        // Delay giữa mỗi lần gọi (trừ bài cuối)
        if (i < results.length - 1) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    return c.json({ ok: true, summarized, failed, total: results.length, results: summaryResults });
});

// ── Dify Integration ─────────────────────────────────────

/**
 * POST /api/articles/summarize
 * Dify gửi kết quả AI summarize về.
 * Body: { results: [{ id, summary, hot_score, tags }] }
 */
app.post('/api/articles/summarize', async (c) => {
    const { results } = await c.req.json();
    if (!Array.isArray(results) || results.length === 0) {
        return c.json({ error: 'Invalid body: results array required' }, 400);
    }

    const statements = [];
    for (const item of results) {
        if (!item.id || !item.summary) continue;
        statements.push(
            c.env.DB.prepare('UPDATE articles SET summary = ?, hot_score = ?, tags = ? WHERE id = ?')
                .bind(item.summary, item.hot_score || 5, JSON.stringify(item.tags || []), item.id)
        );
    }

    if (statements.length > 0) {
        await c.env.DB.batch(statements);
    }

    return c.json({ ok: true, updated: statements.length });
});

/**
 * POST /api/digest
 * Manual digest submission.
 * Body: { digest_date, summary_text }
 */
app.post('/api/digest', async (c) => {
    const { digest_date, summary_text } = await c.req.json();
    if (!summary_text) return c.json({ error: 'summary_text required' }, 400);

    // Default to today VN if no date provided
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dateStr = digest_date || vnNow.toISOString().slice(0, 10);

    await c.env.DB.prepare(
        `INSERT INTO digests (id, digest_date, created_at, updated_at, summary_text, total_fetched)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(digest_date) DO UPDATE SET
           summary_text = excluded.summary_text,
           updated_at = excluded.updated_at`
    ).bind(
        crypto.randomUUID(), dateStr, now.toISOString(), now.toISOString(), summary_text
    ).run();

    return c.json({ ok: true, digest_date: dateStr });
});

// ── Digest Read ──────────────────────────────────────────

/**
 * GET /api/digest?date=YYYY-MM-DD
 * Trả về digest cho ngày cụ thể (default: hôm nay VN).
 */
app.get('/api/digest', async (c) => {
    const dateParam = c.req.query('date');
    // Default to today VN
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dateStr = dateParam || vnNow.toISOString().slice(0, 10);

    const { results } = await c.env.DB.prepare(
        'SELECT * FROM digests WHERE digest_date = ?'
    ).bind(dateStr).all();

    if (!results || results.length === 0) {
        return c.json({ digest: null });
    }

    return c.json({ digest: results[0] });
});

// ── Sources ──────────────────────────────────────────────

app.get('/api/sources', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM sources').all();
    return c.json({ sources: results });
});

app.post('/api/sources', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const { url, name, group_name } = await c.req.json();
    if (!url || typeof url !== 'string') return c.json({ error: 'url is required' }, 400);

    let resolved;
    try {
      resolved = await resolveSource(url);
    } catch (e: any) {
      return c.json({ error: e?.message || 'Failed to resolve source URL' }, 400);
    }

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
        'INSERT INTO sources (id, url, name, type, group_name, enabled) VALUES (?, ?, ?, ?, ?, 1)'
    ).bind(
      id,
      resolved.resolved_url,
      name || 'Custom Source',
      resolved.detected_type,
      group_name || 'General',
    ).run();

    return c.json({
      ok: true,
      source: {
        id,
        url: resolved.resolved_url,
        name: name || 'Custom Source',
        type: resolved.detected_type,
        group_name: group_name || 'General',
        enabled: 1
      },
      resolved_url: resolved.resolved_url,
      detected_type: resolved.detected_type,
      detection_method: resolved.detection_method,
    });
});

app.patch('/api/sources/:id', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const id = c.req.param('id');
    const body = await c.req.json();
    const sets: string[] = [];
    const binds: any[] = [];

    if (body.enabled !== undefined) { sets.push('enabled = ?'); binds.push(body.enabled ? 1 : 0); }
    if (body.name !== undefined) { sets.push('name = ?'); binds.push(body.name); }
    if (body.group_name !== undefined) { sets.push('group_name = ?'); binds.push(body.group_name); }
    if (body.url !== undefined) {
      if (typeof body.url !== 'string' || !body.url.trim()) return c.json({ error: 'Invalid url' }, 400);
      try {
        const normalizedUrl = new URL(body.url.trim()).toString();
        sets.push('url = ?');
        binds.push(normalizedUrl);
      } catch {
        return c.json({ error: 'Invalid url' }, 400);
      }
    }
    if (body.type !== undefined) {
      if (!ALLOWED_SOURCE_TYPES.includes(body.type)) return c.json({ error: 'Invalid type' }, 400);
      sets.push('type = ?');
      binds.push(body.type);
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    binds.push(id);
    await c.env.DB.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return c.json({ ok: true });
});

app.delete('/api/sources/:id', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const id = c.req.param('id');
    // Xoá articles liên quan trước để tránh lỗi foreign key
    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM articles WHERE source_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id),
    ]);
    return c.json({ ok: true });
});

app.post('/api/sources/:id/fetch', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const sourceId = c.req.param('id');
    const { results } = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(sourceId).all();
    if (!results || results.length === 0) return c.json({ error: 'Not found' }, 404);

    const source = results[0] as any;
    const { fetchSource } = await import('../cron/scraper');
    try {
        const articles = await fetchSource(source, c.env);
        let insertedCount = 0;
        for (const art of articles) {
            const aId = crypto.randomUUID();
            const result = await c.env.DB.prepare(
                `INSERT OR IGNORE INTO articles (id, source_id, url, title, description, published_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(aId, source.id, art.url, art.title, art.description || '', normalizeDate(art.published_at)).run();

            if (result.meta && result.meta.changes > 0) insertedCount++;
        }
        return c.json({ ok: true, fetched: articles.length, inserted: insertedCount });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /api/sources/fetch-all
 * Fetch bài mới từ TẤT CẢ sources đang enabled.
 * Dùng cho Dify agent để giảm số lượng API calls.
 */
app.post('/api/sources/fetch-all', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const { results: sources } = await c.env.DB.prepare('SELECT * FROM sources WHERE enabled = 1').all();
    if (!sources || sources.length === 0) return c.json({ ok: true, results: [], message: 'No enabled sources' });

    const { fetchSource } = await import('../cron/scraper');
    const fetchResults = [];

    for (const source of sources) {
        const src = source as any;
        try {
            const articles = await fetchSource(src, c.env);
            let insertedCount = 0;
            for (const art of articles) {
                const aId = crypto.randomUUID();
                const result = await c.env.DB.prepare(
                    `INSERT OR IGNORE INTO articles (id, source_id, url, title, description, published_at)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).bind(aId, src.id, art.url, art.title, art.description || '', normalizeDate(art.published_at)).run();
                if (result.meta && result.meta.changes > 0) insertedCount++;
            }
            fetchResults.push({ source_id: src.id, name: src.name, fetched: articles.length, inserted: insertedCount });
        } catch (e: any) {
            fetchResults.push({ source_id: src.id, name: src.name, error: e.message });
        }
    }

    const totalFetched = fetchResults.reduce((sum, r) => sum + (r.fetched || 0), 0);
    const totalInserted = fetchResults.reduce((sum, r) => sum + (r.inserted || 0), 0);
    return c.json({ ok: true, total_fetched: totalFetched, total_inserted: totalInserted, results: fetchResults });
});


// ── Scraper Profile Debug ────────────────────────────────

/**
 * GET /api/scraper-configs
 * List all learned scraper profiles.
 */
app.get('/api/scraper-configs', async (c) => {
    const { results } = await c.env.DB.prepare(
        'SELECT id, domain, mode, config_json, learned_at FROM scraper_configs ORDER BY learned_at DESC'
    ).all();
    return c.json({ configs: results });
});

/**
 * DELETE /api/scraper-configs/:id
 * Delete a specific scraper profile.
 */
app.delete('/api/scraper-configs/:id', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM scraper_configs WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
});

/**
 * POST /api/scraper-profile/test
 * Manually trigger profile learning for a URL.
 * Body: { url: string, mode?: 'article' | 'listing' }
 *
 * - mode='article' (default): Learn content extraction selectors for an article page.
 * - mode='listing': Learn link extraction selectors for a listing/index page.
 *
 * Returns the generated profile, extraction results, and whether it was saved.
 */
app.post('/api/scraper-profile/test', async (c) => {
    const authErr = requireAdmin(c);
    if (authErr) return authErr;

    const body = await c.req.json().catch(() => ({}));
    const url = body.url;
    const mode = body.mode || 'article';
    const save = body.save !== false; // default: save to DB

    if (!url || typeof url !== 'string') {
        return c.json({ error: 'url is required' }, 400);
    }
    if (mode !== 'article' && mode !== 'listing') {
        return c.json({ error: 'mode must be "article" or "listing"' }, 400);
    }

    try {
        // Fetch the page
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return c.json({ error: `Fetch failed: ${response.status}` }, 400);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
            return c.json({ error: `Not HTML: ${contentType}` }, 400);
        }

        const finalUrl = response.url || url;
        const domain = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
        const html = await response.text();

        // Sanitize HTML for AI
        const cleanedHtml = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (mode === 'article') {
            const { callGemini, extractJson, normalizeConfig } = await import('../ai/scraper-profile');
            const { extractArticleContent } = await import('../cron/scraper');
            const { resolveStaticProfile } = await import('../cron/site-profiles');

            const ARTICLE_SYSTEM_PROMPT = `
You are an expert web scraping engineer.
Return only valid JSON with this exact schema:
{
  "contentSelectors": ["..."],
  "removeSelectors": ["..."],
  "minLength": 40,
  "confidence": 0.0
}

Rules:
- contentSelectors must target article body containers, most-specific first.
- removeSelectors must remove ads/navigation/sidebar/related/comments/noise.
- Never use overly generic selectors in contentSelectors: html, body, *, main, [role="main"].
- Prefer stable class/id/attribute selectors.
- minLength range 20..300.
- confidence range 0..1.
- Do not include markdown, explanations, or extra keys.
`;

            const prompt = [
                `Domain: ${domain}`,
                `Sample URL: ${finalUrl}`,
                'Task: infer robust selectors for article content extraction.',
                'HTML sample:',
                cleanedHtml.slice(0, 120000),
            ].join('\n\n');

            const debug: Record<string, any> = {
                html_length: html.length,
                cleaned_html_length: cleanedHtml.length,
                prompt_length: prompt.length,
            };

            // Step 1: Call AI
            let rawAiResponse: string;
            const modelUsed = 'gemma-4 (auto-selected)';
            try {
                rawAiResponse = await callGemini(c.env, ARTICLE_SYSTEM_PROMPT, prompt);
            } catch (err: any) {
                return c.json({
                    ok: false, domain, mode,
                    step_failed: 'callGemini',
                    error: err.message,
                    debug,
                });
            }
            debug.model_used = modelUsed;
            debug.ai_raw_response = rawAiResponse.slice(0, 2000);
            debug.ai_raw_length = rawAiResponse.length;

            // Step 2: Extract JSON
            let parsed: any;
            try {
                parsed = extractJson(rawAiResponse);
                debug.parsed_json = parsed;
            } catch (err: any) {
                return c.json({
                    ok: false, domain, mode,
                    step_failed: 'extractJson',
                    error: err.message,
                    debug,
                });
            }

            // Step 3: Normalize
            const aiProfile = normalizeConfig(parsed);
            debug.normalized_profile = aiProfile;

            if (!aiProfile) {
                return c.json({
                    ok: false, domain, mode,
                    step_failed: 'normalizeConfig',
                    message: 'normalizeConfig returned null — contentSelectors likely empty after filtering generic ones',
                    static_profile: resolveStaticProfile(finalUrl),
                    debug,
                });
            }

            aiProfile.sampleUrl = finalUrl;
            const staticProfile = resolveStaticProfile(finalUrl);

            // Step 4: Extract content with both profiles for comparison
            const { extractFromHtmlWithProfile, normalizeProfile } = await import('../cron/scraper');
            const aiSiteProfile = normalizeProfile(aiProfile);
            const aiExtraction = await extractFromHtmlWithProfile(html, aiSiteProfile);
            const staticExtraction = await extractFromHtmlWithProfile(html, staticProfile);

            // Save if requested
            let saved = false;
            if (save) {
                const now = new Date().toISOString();
                await c.env.DB.prepare(
                    `INSERT INTO scraper_configs (domain, mode, config_json, learned_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(domain, mode) DO UPDATE SET
                       config_json = excluded.config_json,
                       learned_at = excluded.learned_at`
                ).bind(domain, 'html', JSON.stringify(aiProfile), now).run();
                saved = true;
            }

            return c.json({
                ok: true, domain, mode, saved,
                ai_profile: aiProfile,
                ai_extraction: {
                    chars: aiExtraction.text.length,
                    paragraphs: aiExtraction.paragraphs,
                    matched: aiExtraction.anyContentSelectorMatched,
                    preview: aiExtraction.text.slice(0, 500),
                },
                static_profile: {
                    matchedKey: staticProfile.matchedKey,
                    contentSelectors: staticProfile.contentSelectors,
                    removeSelectors: staticProfile.removeSelectors,
                },
                static_extraction: {
                    chars: staticExtraction.text.length,
                    paragraphs: staticExtraction.paragraphs,
                    matched: staticExtraction.anyContentSelectorMatched,
                    preview: staticExtraction.text.slice(0, 500),
                },
                debug,
            });
        } else {
            // Listing mode
            const { callGemini, extractJson, normalizeListingConfig } = await import('../ai/scraper-profile');
            const { extractListingWithSelectorSet, buildListingArticles, normalizeListingProfile } = await import('../cron/scraper');

            const LISTING_SYSTEM_PROMPT = `
You are an expert web scraping engineer.
Return only valid JSON with this exact schema:
{
  "linkSelectors": ["..."],
  "removeSelectors": ["..."],
  "confidence": 0.0
}

Rules:
- linkSelectors must target links to article detail pages on listing/archive/home pages.
- Never use overly generic selectors: a, body a, html a, *.
- Prefer stable container+link selectors (for example ".post-item a.card-link").
- removeSelectors should remove nav/footer/sidebar/ads/promo/newsletter blocks.
- confidence range 0..1.
- Do not include markdown, explanations, or extra keys.
`;

            const prompt = [
                `Domain: ${domain}`,
                `Sample URL: ${finalUrl}`,
                'Task: infer robust selectors for extracting article links from a listing page.',
                'HTML sample:',
                cleanedHtml.slice(0, 120000),
            ].join('\n\n');

            const debug: Record<string, any> = {
                html_length: html.length,
                cleaned_html_length: cleanedHtml.length,
            };

            // Step 1: Call AI
            let rawAiResponse: string;
            const modelUsed = 'gemma-4 (auto-selected)';
            try {
                rawAiResponse = await callGemini(c.env, LISTING_SYSTEM_PROMPT, prompt);
            } catch (err: any) {
                return c.json({
                    ok: false, domain, mode,
                    step_failed: 'callGemini',
                    error: err.message,
                    debug,
                });
            }
            debug.model_used = modelUsed;
            debug.ai_raw_response = rawAiResponse.slice(0, 2000);

            // Step 2: Parse & normalize
            let parsed: any;
            try {
                parsed = extractJson(rawAiResponse);
            } catch (err: any) {
                return c.json({
                    ok: false, domain, mode,
                    step_failed: 'extractJson',
                    error: err.message,
                    debug,
                });
            }

            const aiProfile = normalizeListingConfig(parsed);
            if (!aiProfile) {
                return c.json({
                    ok: false, domain, mode,
                    step_failed: 'normalizeListingConfig',
                    message: 'linkSelectors empty after filtering generic ones',
                    parsed_json: parsed,
                    debug,
                });
            }
            aiProfile.sampleUrl = finalUrl;

            // Step 3: Extract links using AI profile
            const sourceHost = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
            const aiSelectors = normalizeListingProfile(aiProfile);
            const aiCandidates = await extractListingWithSelectorSet(html, aiSelectors, finalUrl, sourceHost);
            const aiArticles = buildListingArticles(aiCandidates);

            // Also extract with default 'a[href]' for comparison
            const defaultCandidates = await extractListingWithSelectorSet(
                html,
                { linkSelectors: ['a[href]'], removeSelectors: [] },
                finalUrl,
                sourceHost
            );
            const defaultArticles = buildListingArticles(defaultCandidates);

            // Save if requested
            let saved = false;
            if (save) {
                const now = new Date().toISOString();
                await c.env.DB.prepare(
                    `INSERT INTO scraper_configs (domain, mode, config_json, learned_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(domain, mode) DO UPDATE SET
                       config_json = excluded.config_json,
                       learned_at = excluded.learned_at`
                ).bind(domain, 'listing', JSON.stringify(aiProfile), now).run();
                saved = true;
            }

            return c.json({
                ok: true, domain, mode, saved,
                ai_profile: aiProfile,
                ai_articles: {
                    count: aiArticles.length,
                    items: aiArticles.map(a => ({ url: a.url, title: a.title })),
                },
                default_articles: {
                    count: defaultArticles.length,
                    items: defaultArticles.slice(0, 10).map(a => ({ url: a.url, title: a.title })),
                },
                debug,
            });
        }
    } catch (err: any) {
        return c.json({ error: err.message || 'Unknown error' }, 500);
    }
});

export default app;
