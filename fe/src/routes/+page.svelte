<script lang="ts">
  import { goto } from '$app/navigation';
  import { filters } from '$lib/stores/articles';
  import ArticleCard from '$lib/components/app/ArticleCard.svelte';
  import DigestBlock from '$lib/components/app/DigestBlock.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import type { Article } from '$lib/types';

  const TAGS = ['AI', 'Security', 'Tech', 'Business', 'Vietnam', 'World', 'Dev', 'Science', 'Crypto', 'Policy'];

  let { data } = $props();

  // ── Date navigation ───────────────────────────────────
  let todayStr = $derived.by(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  let isToday = $derived(data.currentDate === todayStr);

  let formattedDate = $derived.by(() => {
    const d = new Date(`${data.currentDate}T00:00:00`);
    return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  });

  function goToDate(offset: number) {
    const current = new Date(`${data.currentDate}T00:00:00`);
    current.setDate(current.getDate() + offset);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    const newDate = `${y}-${m}-${d}`;
    // If navigating to today, remove date param for clean URL
    const todayNow = new Date();
    const todayFormatted = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, '0')}-${String(todayNow.getDate()).padStart(2, '0')}`;
    if (newDate === todayFormatted) {
      goto('/', { invalidateAll: true });
    } else {
      goto(`/?date=${newDate}`, { invalidateAll: true });
    }
  }

  // ── Filters ───────────────────────────────────────────
  let filteredArticles = $derived.by(() => {
    let result: Article[] = data.articles;

    if ($filters.tag) {
      result = result.filter(a => {
        try {
          const tags: string[] = a.tags ? JSON.parse(a.tags) : [];
          return tags.some(t => t.toLowerCase() === $filters.tag.toLowerCase());
        } catch { return false; }
      });
    }

    if ($filters.sourceId) {
      result = result.filter(a => a.source_id === $filters.sourceId);
    }

    if ($filters.minHot > 0) {
      result = result.filter(a => (a.hot_score ?? 0) >= $filters.minHot);
    }

    if ($filters.sort === 'hot') {
      result = [...result].sort((a, b) => (b.hot_score ?? 0) - (a.hot_score ?? 0));
    } else {
      result = [...result].sort((a, b) => {
        const da = a.published_at || a.fetched_at;
        const db = b.published_at || b.fetched_at;
        return new Date(db).getTime() - new Date(da).getTime();
      });
    }

    return result;
  });

  function setTag(tag: string) {
    $filters.tag = $filters.tag === tag ? '' : tag;
  }

  function toggleSort() {
    $filters.sort = $filters.sort === 'hot' ? 'date' : 'hot';
  }

  function setMinHot(val: number) {
    $filters.minHot = $filters.minHot === val ? 0 : val;
  }
</script>

<svelte:head>
  <title>NewsDigest - {formattedDate}</title>
</svelte:head>

<div class="mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Tin tức mới nhất</h1>
    <p class="text-muted-foreground mt-1">Được tổng hợp và phân tích bởi AI.</p>
  </div>
  <div class="flex gap-2 items-center">
     <Button variant={$filters.sort === 'hot' ? 'default' : 'outline'} size="sm" onclick={toggleSort}>
       {$filters.sort === 'hot' ? '🔥 Hot nhất' : '🕐 Mới nhất'}
     </Button>
     <Button variant={$filters.minHot >= 7 ? 'default' : 'outline'} size="sm" onclick={() => setMinHot(7)}>
       Hot ≥ 7
     </Button>
  </div>
</div>

<!-- Date navigator -->
<div class="flex items-center justify-center gap-3 mb-6 py-3 px-4 rounded-lg border bg-card">
  <Button variant="ghost" size="sm" onclick={() => goToDate(-1)} class="gap-1">
    <ChevronLeft size={16} />
    <span class="hidden sm:inline">Ngày trước</span>
  </Button>
  <div class="text-center min-w-[180px]">
    <span class="font-semibold text-sm sm:text-base capitalize">{formattedDate}</span>
    {#if isToday}
      <Badge variant="default" class="ml-2 text-xs">Hôm nay</Badge>
    {/if}
  </div>
  {#if !isToday}
    <Button variant="ghost" size="sm" onclick={() => goToDate(1)} class="gap-1">
      <span class="hidden sm:inline">Ngày sau</span>
      <ChevronRight size={16} />
    </Button>
  {:else}
    <div class="w-[100px] sm:w-[110px]"></div>
  {/if}
</div>

<!-- Digest block (ngay dưới date navigator) -->
{#if data.digest}
  <DigestBlock digest={data.digest} articles={data.articles} />
{/if}

<!-- Tag filter bar -->
<div class="flex gap-2 flex-wrap mb-6">
  {#each TAGS as tag}
    <button onclick={() => setTag(tag)}>
      <Badge variant={$filters.tag === tag ? 'default' : 'outline'} class="cursor-pointer hover:bg-primary/10 transition-colors">
        {tag}
      </Badge>
    </button>
  {/each}
  {#if $filters.tag || $filters.minHot > 0}
    <button onclick={() => { $filters.tag = ''; $filters.minHot = 0; }}>
      <Badge variant="secondary" class="cursor-pointer">✕ Bỏ lọc</Badge>
    </button>
  {/if}
</div>

{#if data.error}
  <div class="py-20 text-center border rounded-lg border-dashed text-muted-foreground">
    ⚠️ Không thể kết nối tới server. Vui lòng kiểm tra lại kết nối hoặc thử lại sau.
    <br />
    <a href="/" class="mt-4 text-primary underline text-sm">Thử lại</a>
  </div>
{:else if filteredArticles.length === 0}
  <div class="py-20 text-center border rounded-lg border-dashed text-muted-foreground">
    {$filters.tag || $filters.minHot > 0 ? 'Không tìm thấy bài viết phù hợp. Thử bỏ bộ lọc.' : isToday ? 'Chưa có bài viết nào hôm nay. Đang đợi Cron Worker...' : 'Không có bài viết nào trong ngày này.'}
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each filteredArticles as article (article.id)}
      <ArticleCard {article} />
    {/each}
  </div>
{/if}
