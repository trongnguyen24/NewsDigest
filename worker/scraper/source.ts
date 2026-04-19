import { Env, Source, ArticleInput } from '../types';
import { fetchRSS } from './fetchers/rss';
import { fetchYouTube } from './fetchers/youtube';
import { fetchReddit } from './fetchers/reddit';
import { fetchGitHubTrending } from './fetchers/github-trending';
import { fetchVoz } from './fetchers/voz';
import { fetchUnknown } from './fetchers/html';

export async function fetchSource(source: Source, env: Env): Promise<ArticleInput[]> {
  const type = source.type;
  if (type === 'reddit') {
    return fetchReddit(source);
  } else if (type === 'youtube') {
    return fetchYouTube(source, env);
  } else if (type === 'rss') {
    return fetchRSS(source);
  } else if (type === 'voz') {
    return fetchVoz(source);
  } else if (type === 'github-trending') {
    return fetchGitHubTrending(source);
  } else {
    // Basic fallback for HTML or unknown
    return fetchUnknown(source, env);
  }
}
