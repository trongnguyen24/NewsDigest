<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Drawer from '$lib/components/ui/drawer/index.js';
  import { buttonVariants } from '$lib/components/ui/button/index.js';
  import HotBadge from './HotBadge.svelte';
  import { Bot, ExternalLink, Sparkles, FileText } from 'lucide-svelte';
  import { marked } from 'marked';
  import { sources } from '$lib/stores/sources';
  import type { Article, Digest } from '$lib/types';

  let { digest, articles }: { digest: Digest; articles: Article[] } = $props();

  const isDesktop = new MediaQuery('(min-width: 768px)');

  // Map articles by id for quick lookup
  let articleMap = $derived.by(() => {
    const map = new Map<string, Article>();
    for (const a of articles) {
      map.set(a.id, a);
    }
    return map;
  });

  // Parse digest_text: split into segments of text and <id:uuid> references
  type Segment = { type: 'text'; content: string } | { type: 'ref'; id: string; article: Article | null };

  let segments = $derived.by(() => {
    const result: Segment[] = [];
    const regex = /<id:([0-9a-f\-]+)>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(digest.summary_text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', content: digest.summary_text.slice(lastIndex, match.index) });
      }
      const id = match[1];
      result.push({ type: 'ref', id, article: articleMap.get(id) ?? null });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < digest.summary_text.length) {
      result.push({ type: 'text', content: digest.summary_text.slice(lastIndex) });
    }

    return result;
  });

  // Dialog state for article reference popup
  let selectedArticle = $state<Article | null>(null);
  let refDialogOpen = $state(false);

  let renderedSummary = $derived(
    selectedArticle?.summary ? (marked.parse(selectedArticle.summary) as string) : ''
  );

  let selectedSourceName = $derived.by(() => {
    const art = selectedArticle;
    if (!art) return '';
    return $sources.find(s => s.id === art.source_id)?.name || 'Unknown';
  });

  function openRef(article: Article | null) {
    if (!article) return;
    selectedArticle = article;
    refDialogOpen = true;
  }

  let updatedTime = $derived(
    new Date(digest.updated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  );
</script>

<Card class="mb-6 border-primary/20 bg-linear-to-br from-primary/5 via-transparent to-primary/3 overflow-hidden">
  <CardHeader class="pb-3 border-b border-primary/10">
    <div class="flex items-center justify-between">
      <CardTitle class="flex items-center gap-2 text-primary text-base">
        <Bot size={20} />
        Nhận định AI trong ngày
      </CardTitle>
      <Badge variant="outline" class="text-xs text-muted-foreground font-normal">
        Cập nhật lúc {updatedTime} • {digest.total_fetched} bài
      </Badge>
    </div>
  </CardHeader>
  <CardContent class="pt-4">
    <div class="text-[15px] leading-relaxed text-foreground/90">
      {#each segments as seg}
        {#if seg.type === 'text'}
          {seg.content}
        {:else}
          <button
            class="inline-flex items-center gap-0.5 align-baseline text-primary hover:text-primary/80 transition-colors cursor-pointer"
            title={seg.article?.title || 'Bài viết'}
            onclick={() => openRef(seg.article)}
          >
            <FileText size={14} class="inline" />
          </button>
        {/if}
      {/each}
    </div>
  </CardContent>
</Card>

<!-- Article reference dialog/drawer -->
{#if isDesktop.current}
  <Dialog.Root bind:open={refDialogOpen}>
    <Dialog.Content class="sm:max-w-[560px]">
      {#if selectedArticle}
        <Dialog.Header>
          <Dialog.Title class="text-base leading-snug pr-6 flex items-center gap-2">
            {selectedArticle.title}
            <HotBadge score={selectedArticle.hot_score} />
          </Dialog.Title>
          <Dialog.Description class="text-xs text-muted-foreground">
            {selectedSourceName} • {new Date(selectedArticle.published_at || selectedArticle.fetched_at).toLocaleString('vi-VN')}
          </Dialog.Description>
        </Dialog.Header>
        <div class="space-y-4">
          {#if selectedArticle.summary}
            <div class="prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              {@html renderedSummary}
            </div>
          {:else if selectedArticle.description_vn || selectedArticle.description}
            <p class="text-sm text-muted-foreground">{selectedArticle.description_vn || selectedArticle.description}</p>
          {/if}
          <a
            href={selectedArticle.url}
            target="_blank"
            rel="noopener noreferrer"
            class={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Xem bài gốc
            <ExternalLink size={14} class="ml-1.5" />
          </a>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <Drawer.Root bind:open={refDialogOpen}>
    <Drawer.Content>
      {#if selectedArticle}
        <Drawer.Header class="text-start">
          <Drawer.Title class="text-base leading-snug flex items-center gap-2">
            {selectedArticle.title}
            <HotBadge score={selectedArticle.hot_score} />
          </Drawer.Title>
          <Drawer.Description class="text-xs text-muted-foreground">
            {selectedSourceName} • {new Date(selectedArticle.published_at || selectedArticle.fetched_at).toLocaleString('vi-VN')}
          </Drawer.Description>
        </Drawer.Header>
        <div class="px-4 pb-2 space-y-4">
          {#if selectedArticle.summary}
            <div class="prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              {@html renderedSummary}
            </div>
          {:else if selectedArticle.description_vn || selectedArticle.description}
            <p class="text-sm text-muted-foreground">{selectedArticle.description_vn || selectedArticle.description}</p>
          {/if}
          <a
            href={selectedArticle.url}
            target="_blank"
            rel="noopener noreferrer"
            class={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Xem bài gốc
            <ExternalLink size={14} class="ml-1.5" />
          </a>
        </div>
        <Drawer.Footer class="pt-2">
          <Drawer.Close class={buttonVariants({ variant: 'outline' })}>Đóng</Drawer.Close>
        </Drawer.Footer>
      {/if}
    </Drawer.Content>
  </Drawer.Root>
{/if}
