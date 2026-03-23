<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import HotBadge from './HotBadge.svelte';
  import { Bookmark, BookmarkCheck, ExternalLink } from 'lucide-svelte';
  import type { Article } from '$lib/types';
  import { sources } from '$lib/stores/sources';
  import { api } from '$lib/api';

  let { article }: { article: Article } = $props();

  let tagsArray = $derived.by(() => {
    try {
      return article.tags ? JSON.parse(article.tags) : [];
    } catch(e) { return []; }
  });

  let sourceName = $derived($sources.find(s => s.id === article.source_id)?.name || 'Unknown');

  async function toggleBookmark() {
    const newState = article.is_bookmarked ? 0 : 1;
    try {
      await fetch(api(`/api/articles/${article.id}/bookmark`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarked: newState === 1 })
      });
      article.is_bookmarked = newState;
    } catch(e) { console.error('Bookmark failed', e); }
  }

  async function markRead() {
    if (article.is_read) return;
    try {
      await fetch(api(`/api/articles/${article.id}/read`), { method: 'PATCH' });
      article.is_read = 1;
    } catch(e) {}
  }
</script>

<Card class="flex flex-col h-full hover:shadow-md transition-shadow {article.is_read ? 'opacity-70' : ''}">
  <CardHeader class="pb-2">
    <div class="flex justify-between items-start gap-4">
      <CardTitle class="text-lg leading-tight line-clamp-2">
        <a href={article.url} target="_blank" rel="noopener noreferrer" class="hover:underline" onclick={markRead}>
          {article.title}
        </a>
      </CardTitle>
      <div>
        <HotBadge score={article.hot_score} />
      </div>
    </div>
    <div class="text-xs text-muted-foreground flex gap-2 items-center mt-1">
      <span class="font-medium text-primary">{sourceName}</span>
      •
      <span>{new Date(article.published_at || article.fetched_at).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit', day:'numeric', month:'short'})}</span>
    </div>
  </CardHeader>
  <CardContent class="grow">
    <p class="text-sm text-muted-foreground line-clamp-3">
      {article.summary || article.full_text || "Đang xử lý nội dung..."}
    </p>
    {#if tagsArray.length > 0}
      <div class="flex gap-2 flex-wrap mt-4">
        {#each tagsArray as tag}
          <Badge variant="outline" class="text-xs font-normal bg-secondary/50">{tag}</Badge>
        {/each}
      </div>
    {/if}
  </CardContent>
  <CardFooter class="pt-4 border-t flex justify-between items-center text-sm text-muted-foreground">
    <button class="flex items-center gap-1 hover:text-foreground transition-colors group" onclick={toggleBookmark}>
      {#if article.is_bookmarked}
        <BookmarkCheck size={16} class="fill-current text-primary" />
        <span class="text-primary">Đã lưu</span>
      {:else}
        <Bookmark size={16} class="group-hover:fill-current" />
        Lưu
      {/if}
    </button>
    <a href={article.url} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 hover:text-foreground transition-colors" onclick={markRead}>
      Chi tiết
      <ExternalLink size={14} />
    </a>
  </CardFooter>
</Card>
