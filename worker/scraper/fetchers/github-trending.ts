import { Source, ArticleInput } from '../../types';

export async function fetchGitHubTrending(source: Source): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub Trending failed: ${response.status}`);

  const results: ArticleInput[] = [];
  let currentRepo = '';
  let currentDesc = '';
  let currentStars = '';
  let currentStarsToday = '';
  let inRepoLink = false;
  let inDesc = false;
  let inStarsToday = false;

  const rewriter = new HTMLRewriter()
    // Mỗi article.Box-row là 1 trending repo row
    .on('article.Box-row', {
      element() {
        // Flush previous repo
        if (currentRepo) {
          const repoUrl = `https://github.com${currentRepo.trim()}`;
          const repoName = currentRepo.trim().replace(/^\//, '');
          const stars = currentStars.trim();
          const todayStars = currentStarsToday.trim();
          const desc = currentDesc.trim();
          const meta = `⭐${stars}${todayStars ? ` 📈${todayStars}` : ''}`;
          results.push({
            url: repoUrl,
            title: repoName,
            description: desc ? `${meta}\n${desc}` : meta,
            published_at: new Date().toISOString(),
          });
        }
        currentRepo = '';
        currentDesc = '';
        currentStars = '';
        currentStarsToday = '';
      }
    })
    // Repo link: h2 > a with href like /owner/repo
    .on('article.Box-row h2 a', {
      element(el: Element) {
        const href = el.getAttribute('href');
        if (href && href.match(/^\/[^/]+\/[^/]+$/)) {
          currentRepo = href;
          inRepoLink = true;
        }
      },
      text(text: Text) {
        if (inRepoLink && text.lastInTextNode) {
          inRepoLink = false;
        }
      }
    })
    // Description paragraph
    .on('article.Box-row p', {
      element() {
        inDesc = true;
        currentDesc = '';
      },
      text(text: Text) {
        if (inDesc) {
          currentDesc += text.text;
        }
        if (text.lastInTextNode) {
          inDesc = false;
        }
      }
    })
    // Total star count (first a with /stargazers href)
    .on('article.Box-row a[href$="/stargazers"]', {
      text(text: Text) {
        currentStars += text.text.trim();
      }
    })
    // Stars today (span.d-inline-block.float-sm-right)
    .on('article.Box-row span.d-inline-block.float-sm-right', {
      element() {
        inStarsToday = true;
        currentStarsToday = '';
      },
      text(text: Text) {
        if (inStarsToday) {
          currentStarsToday += text.text;
        }
        if (text.lastInTextNode) {
          inStarsToday = false;
        }
      }
    });

  await rewriter.transform(response).text();

  // Flush last repo
  if (currentRepo) {
    const repoUrl = `https://github.com${currentRepo.trim()}`;
    const repoName = currentRepo.trim().replace(/^\//, '');
    const stars = currentStars.trim();
    const todayStars = currentStarsToday.trim();
    const desc = currentDesc.trim();
    const meta = `⭐${stars}${todayStars ? ` 📈${todayStars}` : ''}`;
    results.push({
      url: repoUrl,
      title: repoName,
      description: desc ? `${meta}\n${desc}` : meta,
      published_at: new Date().toISOString(),
    });
  }

  console.log(`[scraper] GitHub Trending: found ${results.length} repos`);
  return results.filter(r => r.url && r.title).slice(0, 15);
}
