<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import ArticleCard from '$lib/components/app/ArticleCard.svelte';
  import { Bot } from 'lucide-svelte';
  import { api } from '$lib/api';

  let digest: any = null;
  let topArticles: any[] = [];
  let isLoading = true;
  let errorStr = "";

  onMount(async () => {
    try {
      const res = await fetch(api('/api/digest/latest'));
      const data = await res.json();
      if (data.error) {
        errorStr = data.error;
      } else {
        digest = data.digest;
        topArticles = data.topArticles;
      }
    } catch (e) {
      errorStr = "Failed to load digest";
    } finally {
      isLoading = false;
    }
  });
</script>

<svelte:head>
  <title>NewsDigest - Báo Cáo AI</title>
</svelte:head>

<div class="mb-8">
  <h1 class="text-3xl font-bold tracking-tight">Báo Cáo Nhanh từ AI</h1>
  <p class="text-muted-foreground mt-1">Tổng quan tự động mỗi giờ về xu hướng nổi bật.</p>
</div>

{#if isLoading}
  <div class="animate-pulse space-y-4">
    <div class="h-32 bg-muted rounded-xl bg-secondary/50"></div>
    <div class="h-64 bg-muted rounded-xl bg-secondary/50"></div>
  </div>
{:else if errorStr}
  <div class="py-12 text-center text-muted-foreground border-dashed border rounded-xl">{errorStr}</div>
{:else if digest}
  <Card class="mb-8 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
    <CardHeader class="pb-3 border-b border-primary/10">
      <CardTitle class="flex items-center gap-2 text-primary">
        <Bot size={24} /> 
        Nhận định AI - {new Date(digest.created_at).toLocaleString('vi-VN')}
      </CardTitle>
    </CardHeader>
    <CardContent class="pt-6">
      <p class="text-lg leading-relaxed font-medium">"{digest.summary_text}"</p>
    </CardContent>
  </Card>

  <h2 class="text-xl font-semibold mb-4">Top 10 bài hot nhất:</h2>
  
  <ScrollArea class="h-[600px] w-full pr-4 pb-4">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      {#each topArticles as article}
        <ArticleCard {article} />
      {/each}
    </div>
  </ScrollArea>
{/if}
