import { ContentUnavailableError, NetworkError } from '../../errors';
import type { ContentFetcher } from './index';
import { SCRAPER_SETTINGS } from '../../settings';

const MAX_CHARS = SCRAPER_SETTINGS.github.readmeMaxChars;

/**
 * Fetch README from a GitHub repo.
 * 1) GitHub API /repos/{owner}/{repo}/readme → download_url (handles docs/, .github/, etc.)
 * 2) Fallback: raw githubusercontent.com candidates
 *
 * @throws {ContentUnavailableError} if README genuinely does not exist
 * @throws {NetworkError}            on transient HTTP errors
 */
async function fetchGitHubReadme(repoUrl: string): Promise<string> {
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) {
    throw new ContentUnavailableError(`Cannot parse repo path from URL: ${repoUrl}`);
  }

  const ownerRepo = match[1];

  // 1) GitHub API — returns the accurate download_url for the README
  try {
    const apiRes = await fetch(`https://api.github.com/repos/${ownerRepo}/readme`, {
      headers: {
        'User-Agent': 'NewsDigest/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(SCRAPER_SETTINGS.github.apiTimeoutMs),
    });

    if (apiRes.ok) {
      const data: any = await apiRes.json();
      const downloadUrl = data?.download_url;
      if (downloadUrl) {
        const readmeRes = await fetch(downloadUrl, {
          headers: { 'User-Agent': 'NewsDigest/1.0' },
          signal: AbortSignal.timeout(SCRAPER_SETTINGS.github.rawTimeoutMs),
        });
        if (readmeRes.ok) {
          const text = await readmeRes.text();
          if (text.length > 50) {
            console.log(`[github] Fetched README for ${ownerRepo} via API (${text.length} chars, path: ${data.path})`);
            return text.slice(0, MAX_CHARS);
          }
        }
      }
    } else if (apiRes.status === 404) {
      // Repo exists but has no README — permanent, do not retry
      throw new ContentUnavailableError(`No README found for ${ownerRepo}`);
    } else {
      throw new NetworkError(`GitHub API error ${apiRes.status} for ${ownerRepo}`, apiRes.status);
    }
  } catch (err: unknown) {
    // Rethrow typed errors so the orchestrator can handle them correctly
    if (err instanceof ContentUnavailableError || err instanceof NetworkError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[github] API fallback for ${ownerRepo}: ${msg}`);
  }

  // 2) Fallback — try common raw URL patterns
  const candidates = [
    `https://raw.githubusercontent.com/${ownerRepo}/main/README.md`,
    `https://raw.githubusercontent.com/${ownerRepo}/master/README.md`,
    `https://raw.githubusercontent.com/${ownerRepo}/HEAD/README.md`,
  ];

  for (const rawUrl of candidates) {
    try {
      const res = await fetch(rawUrl, {
        headers: { 'User-Agent': 'NewsDigest/1.0' },
        signal: AbortSignal.timeout(SCRAPER_SETTINGS.github.rawTimeoutMs),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 50) {
          console.log(`[github] Fetched README for ${ownerRepo} via raw (${text.length} chars)`);
          return text.slice(0, MAX_CHARS);
        }
      }
    } catch {
      // Try next candidate
    }
  }

  // All attempts exhausted
  console.log(`[github] No README found for ${ownerRepo}`);
  throw new ContentUnavailableError(`No README found for ${ownerRepo}`);
}

export const githubFetcher: ContentFetcher = {
  /** Only matches exact repo URLs — not issue/PR/wiki pages */
  matches(url) {
    return /^https?:\/\/github\.com\/[^/]+\/[^/]+$/.test(url);
  },

  fetch(url) {
    return fetchGitHubReadme(url);
  },
};
