import type { ListingArticle, ScrapedPost } from './types';

const MIN_SCORE = 50;
const MIN_COMMENTS = 15;
const LISTING_LIMIT = 30;
const MAX_CONTENT_CHARS = 50_000;
const TOP_COMMENTS_LIMIT = 50;
const COMMENT_PREVIEW_CHARS = 800;
const REPLY_PREVIEW_CHARS = 500;
const SELFTEXT_PREVIEW_CHARS = 500;

function text(selector: string, root: ParentNode = document): string {
  return root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function parseCompactNumber(raw: string): number {
  const normalized = raw.toLowerCase().replace(/,/g, '').trim();
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/);
  if (!match) return 0;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  if (match[2] === 'k') return Math.round(value * 1_000);
  if (match[2] === 'm') return Math.round(value * 1_000_000);
  return Math.round(value);
}

function absoluteUrl(rawUrl: string): string {
  return new URL(rawUrl, window.location.href).toString();
}

function commentsUrl(thing: Element, fallback: string): string {
  const link = thing.querySelector<HTMLAnchorElement>('a.bylink.comments, a.comments');
  const dataPermalink = thing.getAttribute('data-permalink');
  if (link?.href) return absoluteUrl(link.href);
  if (dataPermalink) return absoluteUrl(dataPermalink);
  return absoluteUrl(fallback);
}

function isExternalPostUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, window.location.href);
    return !url.hostname.endsWith('reddit.com') || !url.pathname.includes('/comments/');
  } catch {
    return false;
  }
}

export function scrapeRedditListing(): ListingArticle[] {
  const things = Array.from(document.querySelectorAll('#siteTable .thing.link:not(.stickied)'));
  const articles: ListingArticle[] = [];

  for (const thing of things) {
    const titleAnchor = thing.querySelector<HTMLAnchorElement>('.title a.title');
    const title = titleAnchor?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!title || !titleAnchor) continue;

    const scoreText = text('.score.unvoted, .score.likes, .score.dislikes', thing);
    const commentsText = text('a.bylink.comments, a.comments', thing);
    const score = parseCompactNumber(scoreText);
    const num_comments = parseCompactNumber(commentsText);
    if (score < MIN_SCORE && num_comments < MIN_COMMENTS) continue;

    const selftext = text('.expando .usertext-body', thing).slice(0, SELFTEXT_PREVIEW_CHARS);
    articles.push({
      title,
      url: commentsUrl(thing, titleAnchor.href),
      score,
      num_comments,
      selftext_preview: selftext || undefined,
    });

    if (articles.length >= LISTING_LIMIT) break;
  }

  return articles;
}

export function scrapeRedditPost(): ScrapedPost {
  const post = document.querySelector('.thing.link') || document;
  const title = text('a.title', post) || document.title.replace(/\s*:.*reddit.*/i, '').trim();
  const selftext = text('.expando .usertext-body .md, .usertext-body .md', post);
  const titleLink = post.querySelector<HTMLAnchorElement>('a.title');
  const parts: string[] = [];

  if (title) parts.push(`[Post] ${title}`);
  if (selftext) parts.push(selftext);
  if (titleLink?.href && isExternalPostUrl(titleLink.href)) parts.push(`Link: ${absoluteUrl(titleLink.href)}`);

  const comments = Array.from(document.querySelectorAll('.commentarea .comment .entry')).slice(0, TOP_COMMENTS_LIMIT);
  if (comments.length > 0) {
    parts.push('\n---\n[Top Comments]');
    for (const entry of comments) {
      const author = text('.author', entry) || 'unknown';
      const score = parseCompactNumber(text('.score.unvoted, .score.likes, .score.dislikes', entry));
      const body = text('.usertext-body .md', entry).slice(0, COMMENT_PREVIEW_CHARS);
      if (!body) continue;

      parts.push(`@${author} (score: ${score}): ${body}`);

      const reply = entry.closest('.comment')?.querySelector('.child .comment .entry');
      if (reply) {
        const replyAuthor = text('.author', reply) || 'unknown';
        const replyScore = parseCompactNumber(text('.score.unvoted, .score.likes, .score.dislikes', reply));
        const replyBody = text('.usertext-body .md', reply).slice(0, REPLY_PREVIEW_CHARS);
        if (replyBody) parts.push(`  ↳ @${replyAuthor} (score: ${replyScore}): ${replyBody}`);
      }
    }
  }

  return { content: parts.join('\n').slice(0, MAX_CONTENT_CHARS) };
}
