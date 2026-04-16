export interface Article {
  id: string;
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  description: string | null;
  description_vn: string | null;

  hot_score: number | null;
  tags: string | null;
  published_at: string | null;
  fetched_at: string;
}

export interface Source {
  id: string;
  url: string;
  name: string;
  type: 'rss' | 'html' | 'reddit' | 'youtube' | 'voz' | 'github-trending';
  enabled: number;
  channel_id: string | null;
  last_fetched_at: string | null;
  created_at: string;
  article_count?: number;
  summarized_count?: number;
  summarize_rate?: number;
}

export interface Digest {
  id: string;
  digest_date: string;
  created_at: string;
  updated_at: string;
  summary_text: string;
  total_fetched: number;
}
