import { Env } from '../types';
import { SiteProfile, resolveStaticProfile } from '../cron/site-profiles';
import { decodeEntities, sanitizeHtmlForAi } from './utils';
import {
  ExtractResult,
  loadStoredProfile,
  saveProfile,
  normalizeProfile,
  shouldAcceptCandidate,
  isLikelyArticlePage,
} from './profiles/content';
import { generateScraperProfile } from '../ai/scraper-profile';

export type { ExtractResult };
export { normalizeProfile };

const MAX_CONTENT_CHARS = 25000;

/**
 * Extract article text from HTML using a SiteProfile (content + remove selectors).
 * Used by extractArticleContent() and by api/routes/scraper.ts for testing.
 */
export async function extractFromHtmlWithProfile(html: string, profile: SiteProfile): Promise<ExtractResult> {
  const minLen = profile.minLength ?? 40;
  const paragraphs: string[] = [];
  let currentParagraph = '';
  let totalLen = 0;
  let contentDepth = 0;
  let anyContentSelectorMatched = false;

  function flushParagraph() {
    if (totalLen >= MAX_CONTENT_CHARS) return;
    if (currentParagraph.trim()) {
      const clean = decodeEntities(currentParagraph.trim());
      if (clean.length >= minLen) {
        paragraphs.push(clean);
        totalLen += clean.length;
      }
    }
    currentParagraph = '';
  }

  let rewriter = new HTMLRewriter();
  const removeSelector = profile.removeSelectors.join(', ');
  if (removeSelector) {
    rewriter = rewriter.on(removeSelector, {
      element(el: Element) {
        el.remove();
      },
    });
  }

  const contentSelector = profile.contentSelectors.join(', ');
  rewriter = rewriter.on(contentSelector, {
    element(el: Element) {
      contentDepth++;
      anyContentSelectorMatched = true;
      flushParagraph();
      el.onEndTag(() => {
        flushParagraph();
        contentDepth = Math.max(0, contentDepth - 1);
      });
    },
  });

  rewriter = rewriter.on('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, div, section, article', {
    element() {
      flushParagraph();
    },
  });

  rewriter = rewriter.on('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, td, th, span, a, em, strong, b, i, code', {
    text(text: Text) {
      if (totalLen >= MAX_CONTENT_CHARS) return;
      if (contentDepth <= 0) return;
      const t = text.text.trim();
      if (t) currentParagraph += ' ' + t;
    },
  });

  await rewriter.transform(new Response(html)).text();
  flushParagraph();

  if (!anyContentSelectorMatched && paragraphs.length === 0) {
    return { text: '', paragraphs: 0, anyContentSelectorMatched: false };
  }

  const text = paragraphs
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CONTENT_CHARS);

  return { text, paragraphs: paragraphs.length, anyContentSelectorMatched };
}

/**
 * Fetch nội dung bài viết từ URL gốc.
 * Ưu tiên profile đã học trong D1, fallback sang hardcoded profile.
 * Domain mới sẽ được AI học profile ngay lần scrape đầu tiên.
 */
export async function extractArticleContent(url: string, env: Env): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return '';

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return '';

    const finalUrl = response.url || url;
    const domain = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
    const html = await response.text();
    if (!html) return '';

    const staticProfile = resolveStaticProfile(finalUrl);
    const learnedProfile = await loadStoredProfile(domain, env);

    let activeProfile: SiteProfile = staticProfile;
    if (learnedProfile) {
      activeProfile = normalizeProfile(learnedProfile);
      console.log(`[scraper] profile_hit domain=${domain} source=d1`);
    } else {
      console.log(`[scraper] profile_miss domain=${domain} fallback=${staticProfile.matchedKey}`);
    }

    let chosen = await extractFromHtmlWithProfile(html, activeProfile);
    let usedProfile = learnedProfile ? 'd1' : 'static';

    // Fallback an toàn nếu profile D1 đã tồn tại nhưng fail ở request hiện tại
    if (learnedProfile && chosen.text.length === 0) {
      const fallback = await extractFromHtmlWithProfile(html, staticProfile);
      if (fallback.text.length > 0) {
        chosen = fallback;
        usedProfile = 'fallback_static';
        console.log(`[scraper] fallback_used domain=${domain} reason=empty_d1_result`);
      }
    }

    // Domain chưa có profile D1 -> học profile từ lần scrape đầu
    if (!learnedProfile && isLikelyArticlePage(finalUrl, html)) {
      const aiProfile = await generateScraperProfile(domain, finalUrl, sanitizeHtmlForAi(html), env);
      if (aiProfile) {
        const candidate = await extractFromHtmlWithProfile(html, normalizeProfile(aiProfile));
        if (shouldAcceptCandidate(candidate, chosen, aiProfile.minLength ?? 40)) {
          await saveProfile(domain, aiProfile, env);
          console.log(
            `[scraper] profile_learned domain=${domain} confidence=${(aiProfile.confidence ?? 0).toFixed(2)} chars=${candidate.text.length}`
          );

          if (candidate.text.length >= chosen.text.length) {
            chosen = candidate;
            usedProfile = 'learned_now';
          } else {
            console.log(`[scraper] fallback_used domain=${domain} reason=baseline_better`);
          }
        } else {
          console.log(`[scraper] profile_rejected domain=${domain} reason=quality_gate`);
        }
      }
    } else if (!learnedProfile) {
      console.log(`[scraper] profile_learning_skipped domain=${domain} reason=non_article_url`);
    }

    if (!chosen.text) return '';
    console.log(
      `[scraper] ${domain}: extracted ${chosen.text.length} chars (${chosen.paragraphs} paragraphs) profile=${usedProfile}`
    );
    return chosen.text;
  } catch (err: any) {
    console.log(`[scraper] extract_error ${url}: ${err.message}`);
    return '';
  }
}
