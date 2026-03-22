<script lang="ts">
  import { onMount } from 'svelte';
  import { articles, isLoading, filters } from '$lib/stores/articles';
  import { api } from '$lib/api';
  import { sources } from '$lib/stores/sources';
  import ArticleCard from '$lib/components/app/ArticleCard.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';

  const TAGS = ['AI', 'Security', 'Tech', 'Business', 'Vietnam', 'World', 'Dev', 'Science', 'Crypto', 'Policy'];

  let hasMore = false;

  async function loadArticles() {
    $isLoading = true;
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('limit', '20');
      if ($filters.tag) params.set('tag', $filters.tag);
      if ($filters.sourceId) params.set('source_id', $filters.sourceId);
      if ($filters.minHot > 0) params.set('min_hot', String($filters.minHot));
      if ($filters.sort) params.set('sort', $filters.sort);

      const res = await fetch(api(`/api/articles?${params.toString()}`));
      const data = await res.json();
      if (data.articles) {
        $articles = data.articles;
        hasMore = data.nextPage !== null;
      }
    } catch (e) {
      console.error('Failed to fetch articles', e);
    } finally {
      $isLoading = false;
    }
  }

  onMount(loadArticles);

  function setTag(tag: string) {
    $filters.tag = $filters.tag === tag ? '' : tag;
    loadArticles();
  }

  function toggleSort() {
    $filters.sort = $filters.sort === 'hot' ? 'date' : 'hot';
    loadArticles();
  }

  function setMinHot(val: number) {
    $filters.minHot = $filters.minHot === val ? 0 : val;
    loadArticles();
  }
</script>

<svelte:head>
  <title>NewsDigest - Home</title>
</svelte:head>

<div class="mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Tin tức mới nhất</h1>
    <p class="text-muted-foreground mt-1">Được tổng hợp và phân tích bởi AI.</p>
  </div>
  <div class="flex gap-2 items-center">
     <Button variant={$filters.sort === 'hot' ? 'default' : 'outline'} size="sm" on:click={toggleSort}>
       {$filters.sort === 'hot' ? '🔥 Hot nhất' : '🕐 Mới nhất'}
     </Button>
     <Button variant={$filters.minHot >= 7 ? 'default' : 'outline'} size="sm" on:click={() => setMinHot(7)}>
       Hot ≥ 7
     </Button>
  </div>
</div>

<!-- Tag filter bar -->
<div class="flex gap-2 flex-wrap mb-6">
  {#each TAGS as tag}
    <button on:click={() => setTag(tag)}>
      <Badge variant={$filters.tag === tag ? 'default' : 'outline'} class="cursor-pointer hover:bg-primary/10 transition-colors">
        {tag}
      </Badge>
    </button>
  {/each}
  {#if $filters.tag}
    <button on:click={() => { $filters.tag = ''; loadArticles(); }}>
      <Badge variant="secondary" class="cursor-pointer">✕ Bỏ lọc</Badge>
    </button>
  {/if}
</div>

{#if $isLoading}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each Array(6) as _}
       <div class="h-[250px] bg-muted animate-pulse rounded-lg bg-secondary/50"></div>
    {/each}
  </div>
{:else if $articles.length === 0}
  <div class="py-20 text-center border rounded-lg border-dashed text-muted-foreground">
    {$filters.tag || $filters.minHot > 0 ? 'Không tìm thấy bài viết phù hợp. Thử bỏ bộ lọc.' : 'Chưa có bài viết nào được tải. Đang đợi Cron Worker...'}
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each $articles as article (article.id)}
      <ArticleCard {article} />
    {/each}
  </div>
  {#if hasMore}
    <div class="flex justify-center mt-8">
      <Button variant="outline" on:click={loadArticles}>Tải thêm</Button>
    </div>
  {/if}
{/if}
