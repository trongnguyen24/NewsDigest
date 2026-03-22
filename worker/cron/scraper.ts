import { XMLParser } from 'fast-xml-parser';
import { Env, Source, ArticleInput } from '../types';

export async function fetchSource(source: Source, env: Env): Promise<ArticleInput[]> {
  const type = source.type;
  if (type === 'reddit') {
    return fetchReddit(source);
  } else if (type === 'youtube') {
    return fetchYouTube(source, env.YOUTUBE_API_KEY);
  } else if (type === 'rss') {
    return fetchRSS(source);
  } else if (type === 'voz') {
    return fetchVoz(source);
  } else {
    // Basic fallback for HTML or unknown
    return fetchUnknown(source);
  }
}

async function fetchReddit(source: Source): Promise<ArticleInput[]> {
  const url = source.url.endsWith('/') ? `${source.url}new.json?limit=25` : `${source.url}/new.json?limit=25`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' }
  });
  if (!response.ok) throw new Error(`Reddit API failed: ${response.status}`);
  
  const data: any = await response.json();
  const children = data?.data?.children || [];
  
  return children.map((item: any) => {
    const d = item.data;
    return {
      url: `https://www.reddit.com${d.permalink}`,
      title: d.title,
      full_text: d.selftext || '',
      published_at: new Date(d.created_utc * 1000).toISOString()
    };
  });
}

async function fetchYouTube(source: Source, apiKey: string): Promise<ArticleInput[]> {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured.");
  
  let playlistId = "";
  let handleMatch = source.url.match(/@([a-zA-Z0-9_\\-]+)/);
  if (handleMatch) {
    const handle = handleMatch[1];
    const channelRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${handle}&key=${apiKey}`);
    const channelData: any = await channelRes.json();
    if (channelData.items && channelData.items.length > 0) {
      playlistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;
    }
  }

  if (!playlistId) {
    throw new Error(`Could not find uploads playlist for YouTube source ${source.url}`);
  }

  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=10&key=${apiKey}`);
  const data: any = await res.json();
  const items = data.items || [];
  
  return items.map((item: any) => {
    const snippet = item.snippet;
    return {
      url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
      title: snippet.title,
      full_text: snippet.description,
      published_at: snippet.publishedAt
    };
  });
}

async function fetchRSS(source: Source): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' }
  });
  if (!response.ok) throw new Error(`RSS feed failed: ${response.status}`);
  
  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    textNodeName: "_text",
  });
  const result: any = parser.parse(xml);
  
  let items = [];
  if (result.rss && result.rss.channel && result.rss.channel.item) {
    items = Array.isArray(result.rss.channel.item) ? result.rss.channel.item : [result.rss.channel.item];
  } else if (result.feed && result.feed.entry) {
    items = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
  }

  return items.slice(0, 20).map((item: any) => {
    let link = item.link;
    if (typeof link === 'object' && link['@_href']) {
      link = link['@_href'];
    }
    return {
      url: link,
      title: item.title,
      full_text: item.description || item.content || item['_text'] || '',
      published_at: item.pubDate || item.published || new Date().toISOString()
    };
  });
}

async function fetchVoz(source: Source): Promise<ArticleInput[]> {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'NewsDigest/1.0.0' }
  });
  if (!response.ok) throw new Error(`VOZ failed: ${response.status}`);

  const results: ArticleInput[] = [];
  let currentTitle = "";
  let currentUrl = "";

  class TitleHandler {
    text(text: Text) {
      if (text.text.trim()) {
         currentTitle += text.text;
      }
    }
  }
  
  class LinkHandler {
    element(element: Element) {
      const href = element.getAttribute("href");
      if (href && href.startsWith('/t/')) {
        currentUrl = `https://voz.vn${href}`;
      }
    }
  }

  class ItemHandler {
    element(element: Element) {
      if (currentTitle && currentUrl) {
        results.push({
          title: currentTitle.trim(),
          url: currentUrl,
          published_at: new Date().toISOString()
        });
      }
      currentTitle = "";
      currentUrl = "";
    }
  }

  const rewriter = new HTMLRewriter()
    .on('.structItem-title a', new LinkHandler())
    .on('.structItem-title a', new TitleHandler())
    .on('.structItem', new ItemHandler());
    
  await rewriter.transform(response).text();

  if (currentTitle && currentUrl && !results.find(r => r.url === currentUrl)) {
    results.push({
      title: currentTitle.trim(),
      url: currentUrl,
      published_at: new Date().toISOString()
    });
  }

  return results.filter(r => r.url && r.title);
}

async function fetchUnknown(source: Source): Promise<ArticleInput[]> {
  console.log(`Fallback fetch for HTML source ${source.url} not fully implemented yet.`);
  return [];
}
