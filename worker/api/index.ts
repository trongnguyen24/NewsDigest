import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

// ── Articles ─────────────────────────────────────────────

app.get('/api/articles', async (c) => {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
    const tag = c.req.query('tag') || '';
    const sourceId = c.req.query('source_id') || '';
    const minHot = parseInt(c.req.query('min_hot') || '0');
    const sort = c.req.query('sort') === 'hot' ? 'hot_score DESC' : 'fetched_at DESC';
    const bookmarked = c.req.query('bookmarked');
    const unsummarized = c.req.query('unsummarized');
    const compact = c.req.query('compact');
    const ids = c.req.query('ids');
    const offset = (page - 1) * limit;

    // compact=1 → chỉ trả id, title, url, source_id, published_at (không full_text)
    const fields = compact === '1'
        ? 'id, title, url, source_id, published_at'
        : '*';

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
    if (bookmarked === '1') { where += ' AND is_bookmarked = 1'; }
    if (unsummarized === '1') { where += ' AND summary IS NULL'; }

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

app.patch('/api/articles/:id/bookmark', async (c) => {
    const id = c.req.param('id');
    const { bookmarked } = await c.req.json();
    await c.env.DB.prepare('UPDATE articles SET is_bookmarked = ? WHERE id = ?')
        .bind(bookmarked ? 1 : 0, id).run();
    return c.json({ ok: true });
});

app.patch('/api/articles/:id/read', async (c) => {
    const id = c.req.param('id');
    await c.env.DB.prepare('UPDATE articles SET is_read = 1 WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
});

/**
 * POST /api/articles/enrich
 * Fetch nội dung bài viết từ URL gốc cho các article chưa có full_text tốt.
 * Body: { ids: ["id1", "id2", ...], force?: boolean }
 * Sẽ fetch song song (tối đa 5 cùng lúc) và update full_text vào DB.
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
        `SELECT id, url, full_text FROM articles WHERE id IN (${placeholders})`
    ).bind(...ids).all();

    if (!results || results.length === 0) {
        return c.json({ ok: true, enriched: 0, message: 'No articles found' });
    }

    const { extractArticleContent } = await import('../cron/scraper');
    const enrichResults: { id: string; success: boolean; chars: number; skipped?: boolean; note?: string }[] = [];

    // Kiểm tra full_text có phải rác không
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
    function extractHNArticleUrl(fullText: string): string | null {
        const match = fullText.match(/Article URL:\s*<a href="([^"]+)"/);
        return match ? match[1] : null;
    }

    const articles = results as any[];
    for (let i = 0; i < articles.length; i += 5) {
        const batch = articles.slice(i, i + 5);
        const promises = batch.map(async (art: any) => {
            // Skip nếu đã có full_text tốt (trừ khi force=true)
            if (!force && art.full_text && !isLowQuality(art.full_text)) {
                return { id: art.id, success: true, chars: art.full_text.length, skipped: true };
            }

            // Skip Reddit URLs (JS-rendered, không extract được)
            if (art.url.includes('reddit.com')) {
                return { id: art.id, success: false, chars: 0, note: 'Reddit URLs are JS-rendered' };
            }

            // Xác định URL cần fetch
            let fetchUrl = art.url;

            // Nếu bài HN, lấy article URL thay vì HN page
            if (art.full_text && extractHNArticleUrl(art.full_text)) {
                fetchUrl = extractHNArticleUrl(art.full_text)!;
            } else if (art.url.includes('news.ycombinator.com')) {
                // Ask HN / Show HN — nội dung nằm trong RSS description, chỉ cần strip HTML
                if (art.full_text) {
                    const cleaned = art.full_text
                        .replace(/<hr\s*\/?>/gi, '\n---\n')
                        .replace(/<p>/gi, '\n')
                        .replace(/<[^>]+>/g, '')
                        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
                        // Loại bỏ metadata cuối (Comments URL, Points)
                        .replace(/\n---\n[\s\S]*$/, '')
                        .trim();
                    if (cleaned.length > 50) {
                        await c.env.DB.prepare('UPDATE articles SET full_text = ? WHERE id = ?')
                            .bind(cleaned, art.id).run();
                        return { id: art.id, success: true, chars: cleaned.length };
                    }
                }
                return { id: art.id, success: false, chars: 0, note: 'HN text post with no content' };
            }

            const content = await extractArticleContent(fetchUrl);
            if (content && content.length > 50) {
                await c.env.DB.prepare('UPDATE articles SET full_text = ? WHERE id = ?')
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
 * Dify gửi digest tổng hợp.
 * Body: { summary_text, top_article_ids? }
 */
app.post('/api/digest', async (c) => {
    const { summary_text, top_article_ids } = await c.req.json();
    if (!summary_text) return c.json({ error: 'summary_text required' }, 400);

    const now = new Date();
    const periodStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const idValue = crypto.randomUUID();
    const topIds = top_article_ids || [];

    await c.env.DB.prepare(
        `INSERT INTO digests (id, created_at, period_start, period_end, summary_text, top_article_ids, total_fetched)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        idValue, now.toISOString(), periodStart.toISOString(), now.toISOString(),
        summary_text, JSON.stringify(topIds), topIds.length
    ).run();

    return c.json({ ok: true, digestId: idValue });
});

// ── Digest Read ──────────────────────────────────────────

app.get('/api/digest/latest', async (c) => {
    const { results } = await c.env.DB.prepare(
        'SELECT * FROM digests ORDER BY created_at DESC LIMIT 1'
    ).all();

    if (!results || results.length === 0) {
        return c.json({ error: 'No digest available yet' }, 404);
    }

    const latestDigest = results[0] as any;
    let topArticles: any[] = [];
    try {
        const topIds: string[] = JSON.parse(latestDigest.top_article_ids);
        if (topIds.length > 0) {
            const placeholders = topIds.map(() => '?').join(',');
            const query = await c.env.DB.prepare(
                `SELECT * FROM articles WHERE id IN (${placeholders})`
            ).bind(...topIds).all();
            topArticles = query.results;
        }
    } catch (e) {}

    return c.json({ digest: latestDigest, topArticles });
});

// ── Sources ──────────────────────────────────────────────

app.get('/api/sources', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM sources').all();
    return c.json({ sources: results });
});

app.post('/api/sources', async (c) => {
    const { url, name, group_name } = await c.req.json();
    let type = 'rss';
    if (url.includes('reddit.com')) type = 'reddit';
    else if (url.includes('youtube.com') || url.includes('youtu.be')) type = 'youtube';
    else if (url.includes('voz.vn')) type = 'voz';

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
        'INSERT INTO sources (id, url, name, type, group_name, enabled) VALUES (?, ?, ?, ?, ?, 1)'
    ).bind(id, url, name || 'Custom Source', type, group_name || 'General').run();

    return c.json({ ok: true, source: { id, url, name: name || 'Custom Source', type, group_name: group_name || 'General', enabled: 1 } });
});

app.patch('/api/sources/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const sets: string[] = [];
    const binds: any[] = [];

    if (body.enabled !== undefined) { sets.push('enabled = ?'); binds.push(body.enabled ? 1 : 0); }
    if (body.name !== undefined) { sets.push('name = ?'); binds.push(body.name); }
    if (body.group_name !== undefined) { sets.push('group_name = ?'); binds.push(body.group_name); }

    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    binds.push(id);
    await c.env.DB.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return c.json({ ok: true });
});

app.delete('/api/sources/:id', async (c) => {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
});

app.post('/api/sources/:id/fetch', async (c) => {
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
                `INSERT OR IGNORE INTO articles (id, source_id, url, title, full_text, published_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(aId, source.id, art.url, art.title, art.full_text || '', art.published_at || new Date().toISOString()).run();

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
                    `INSERT OR IGNORE INTO articles (id, source_id, url, title, full_text, published_at)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).bind(aId, src.id, art.url, art.title, art.full_text || '', art.published_at || new Date().toISOString()).run();
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

// ── Push ─────────────────────────────────────────────────

app.get('/api/push/vapid-public-key', (c) => {
    return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (c) => {
    const sub = await c.req.json();
    const hash = crypto.randomUUID();
    await c.env.PUSH_SUBSCRIPTIONS.put(`sub:${hash}`, JSON.stringify(sub));
    return c.json({ ok: true });
});

app.delete('/api/push/unsubscribe', async (c) => {
    return c.json({ ok: true });
});

export default app;
