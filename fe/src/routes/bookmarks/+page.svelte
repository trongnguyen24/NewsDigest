<script lang="ts">
  import { onMount } from 'svelte';
  import ArticleCard from '$lib/components/app/ArticleCard.svelte';
  import { BookmarkX } from 'lucide-svelte';
  import type { Article } from '$lib/types';
  import { api } from '$lib/api';

  let bookmarks = $state<Article[]>([]);
  let isLoading = $state(true);

  onMount(async () => {
    try {
      const res = await fetch(api('/api/articles?bookmarked=1&limit=50'));
      const data = await res.json();
      if (data.articles) {
        bookmarks = data.articles;
      }
    } catch (e) {
      console.error('Failed to fetch bookmarks', e);
    } finally {
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>NewsDigest - Đã Lưu</title>
</svelte:head>

<div class="mb-8">
  <h1 class="text-3xl font-bold tracking-tight">Bài viết đã lưu</h1>
  <p class="text-muted-foreground mt-1">Các bài viết bạn ấn lưu sẽ hiển thị ở đây.</p>
</div>

{#if isLoading}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each Array(3) as _}
       <div class="h-[250px] bg-muted animate-pulse rounded-lg"></div>
    {/each}
  </div>
{:else if bookmarks.length === 0}
  <div class="flex flex-col items-center justify-center py-24 text-center">
    <div class="bg-secondary/50 rounded-full p-6 mb-4">
       <BookmarkX size={48} class="text-muted-foreground" />
    </div>
    <h2 class="text-2xl font-semibold mb-2">Chưa có bài lưu</h2>
    <p class="text-muted-foreground max-w-sm">
      Bạn chưa đánh dấu bài viết nào. Hãy lưu các tin tức hữu ích ở Trang Chủ để đọc lại sau.
    </p>
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each bookmarks as article (article.id)}
      <ArticleCard {article} />
    {/each}
  </div>
{/if}
