/**
 * @deprecated
 * This file is a backward-compatibility shim.
 * All logic has been moved to `worker/scraper/`.
 *
 * Import from here still works, but prefer importing directly from
 * `../scraper` or its sub-modules for new code.
 */
export {
  fetchSource,
  extractArticleContent,
  extractFromHtmlWithProfile,
  normalizeProfile,
  normalizeListingProfile,
  buildListingArticles,
  extractListingWithSelectorSet,
} from '../scraper/index';
