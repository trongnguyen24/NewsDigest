import { Env, Source, ArticleInput } from '../../types';
import { detectCharset, parseRssOrAtom, extractItemLink, nodeText, normalizeDate, sanitizeHtmlForAi } from '../utils';
import {
  loadStoredListingProfile,
  saveListingProfile,
  normalizeListingProfile,
  extractListingWithSelectorSet,
  buildListingArticles,
  defaultListingSelectors,
  isLikelyListingUrl,
  shouldAcceptListingCandidate,
} from '../profiles/listing';
import { generateListingProfile } from '../../ai/scraper-profile';

export async function fetchUnknown(source: Source, env: Env): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTML source failed: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    // Nếu content-type là XML (RSS/Atom feed), thử parse như RSS thay vì throw lỗi
    const isXml = contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom');
    if (isXml) {
      // Dùng ArrayBuffer để detect charset đúng (ISO-8859-1, Windows-1252, ...)
      const xmlBuffer = await response.arrayBuffer();
      const xmlCharset = detectCharset(contentType, xmlBuffer);
      let xml: string;
      try { xml = new TextDecoder(xmlCharset).decode(xmlBuffer).trim(); } catch { xml = new TextDecoder('utf-8').decode(xmlBuffer).trim(); }
      const parsed = parseRssOrAtom(xml);
      if (parsed) {
        console.log(`[scraper] HTML source ${source.url} is actually RSS/Atom (${contentType}), parsing as feed`);
        const mapped = parsed.items.slice(0, 20).map((item: any) => {
          let link = extractItemLink(item);
          if (link && !/^https?:\/\//i.test(link)) {
            try { link = new URL(link, source.url).toString(); } catch { link = ''; }
          }
          const title = nodeText(item.title);
          const desc = nodeText(item.description) || nodeText(item.content) || nodeText(item.summary);
          const published = item.pubDate || item.published || item.updated || item.dc?.date;
          return { url: link, title, description: desc, published_at: normalizeDate(published) };
        });
        return mapped.filter(item => item.url && item.title);
      }
    }
    throw new Error(`HTML source is not text/html: ${contentType || 'unknown'}`);
  }

  const finalUrl = response.url || source.url;
  const pageHost = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
  const sourceHost = new URL(source.url).hostname.replace(/^www\./, '').toLowerCase();
  const html = await response.text();
  const learnedProfile = await loadStoredListingProfile(pageHost, env);

  let activeSelectors = defaultListingSelectors(sourceHost);
  let profileUsed = 'heuristic_default';
  if (learnedProfile) {
    activeSelectors = normalizeListingProfile(learnedProfile);
    profileUsed = 'd1_listing';
    console.log(`[scraper] listing_profile_hit domain=${pageHost} source=d1`);
  } else {
    console.log(`[scraper] listing_profile_miss domain=${pageHost}`);
  }

  let candidates = await extractListingWithSelectorSet(html, activeSelectors, finalUrl, sourceHost);
  let result = buildListingArticles(candidates);

  if (learnedProfile && result.length < 3) {
    const fallbackCandidates = await extractListingWithSelectorSet(
      html,
      defaultListingSelectors(sourceHost),
      finalUrl,
      sourceHost
    );
    const fallbackResult = buildListingArticles(fallbackCandidates);
    if (fallbackResult.length > result.length) {
      result = fallbackResult;
      profileUsed = 'fallback_heuristic';
      console.log(`[scraper] fallback_used domain=${pageHost} reason=weak_listing_profile`);
    }
  }

  if (!learnedProfile && isLikelyListingUrl(finalUrl)) {
    const listingProfile = await generateListingProfile(pageHost, finalUrl, sanitizeHtmlForAi(html), env);
    if (listingProfile) {
      const learnedCandidates = await extractListingWithSelectorSet(
        html,
        normalizeListingProfile(listingProfile),
        finalUrl,
        sourceHost
      );
      const learnedResult = buildListingArticles(learnedCandidates);
      if (shouldAcceptListingCandidate(learnedResult, result)) {
        await saveListingProfile(pageHost, listingProfile, env);
        console.log(
          `[scraper] listing_profile_learned domain=${pageHost} confidence=${(listingProfile.confidence ?? 0).toFixed(2)} count=${learnedResult.length}`
        );
        if (learnedResult.length >= result.length) {
          result = learnedResult;
          profileUsed = 'learned_now';
        } else {
          console.log(`[scraper] fallback_used domain=${pageHost} reason=listing_baseline_better`);
        }
      } else {
        console.log(`[scraper] listing_profile_rejected domain=${pageHost} reason=quality_gate`);
      }
    }
  } else if (!learnedProfile) {
    console.log(`[scraper] listing_profile_learning_skipped domain=${pageHost} reason=non_listing_url`);
  }

  console.log(
    `[scraper] HTML ${pageHost}: extracted ${result.length} listing items from ${source.url} profile=${profileUsed}`
  );
  return result;
}
