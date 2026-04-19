import { Source, ArticleInput } from '../../types';

export async function fetchReddit(source: Source): Promise<ArticleInput[]> {
  const url = source.url.endsWith('/') ? `${source.url}hot.json?limit=15` : `${source.url}/hot.json?limit=15`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'NewsDigest/1.0 (news aggregation bot)' }
  });
  if (!response.ok) throw new Error(`Reddit API failed: ${response.status}`);

  const data: any = await response.json();
  const children = data?.data?.children || [];

  return children
    .filter((item: any) => !item.data.stickied) // Skip pinned posts
    .filter((item: any) => {
      const d = item.data;
      // Lọc bài ít tương tác: cần ít nhất 50 upvotes HOẶC 15 comments
      return d.score >= 50 || d.num_comments >= 15;
    })
    .map((item: any) => {
      const d = item.data;
      const postedAt = new Date(d.created_utc * 1000).toISOString();
      const meta = `⬆${d.score} 💬${d.num_comments} r/${d.subreddit} 📅${postedAt.slice(0, 10)}`;
      return {
        url: `https://www.reddit.com${d.permalink}`,
        title: d.title,
        description: d.selftext
          ? `${meta}\n${d.selftext.slice(0, 300)}`
          : meta,
        // Dùng thời gian fetch (now) thay vì created_utc
        // → bài hot hôm nay sẽ luôn hiện khi lọc theo "hôm nay"
        published_at: new Date().toISOString(),
        reddit_score: d.score,
        reddit_comments: d.num_comments,
      };
    });
}
