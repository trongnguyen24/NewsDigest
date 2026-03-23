<script lang="ts">
  import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  
  const SUGGESTED_SOURCES = [
    { name: 'HackerNews', url: 'https://news.ycombinator.com/rss', group: 'Tech' },
    { name: 'VnExpress', url: 'https://vnexpress.net/rss/tin-moi-nhat.rss', group: 'News' },
    { name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/', group: 'Tech' }
  ];

  let selected = $state([SUGGESTED_SOURCES[0]]);
  let customUrl = $state("");
  let isFetching = $state(false);

  function toggle(source: any) {
    if (selected.includes(source)) selected = selected.filter(s => s !== source);
    else selected = [...selected, source];
  }

  async function startOnboarding() {
    isFetching = true;
    try {
      const allToSubmit = [...selected];
      if (customUrl) {
        allToSubmit.push({ name: 'Custom', url: customUrl, group: 'Custom' });
      }

      for (const src of allToSubmit) {
        // 1. Add Source
        const res = await fetch(api('/api/sources'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: src.url, name: src.name, group_name: src.group })
        });
        const data = await res.json();
        
        // 2. Force fetch first articles
        if (data.ok && data.source) {
          await fetch(api(`/api/sources/${data.source.id}/fetch`), { method: 'POST' });
        }
      }
      
      // Go to home feed!
      goto('/');
    } catch(err) {
      console.error(err);
    } finally {
      isFetching = false;
    }
  }
</script>

<svelte:head>
  <title>Welcome to NewsDigest</title>
</svelte:head>

<div class="max-w-xl mx-auto py-12 px-4">
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-extrabold tracking-tight">Chào mừng tới NewsDigest!</h1>
    <p class="text-muted-foreground mt-4 text-lg">Hệ thống báo cáo tự động cá nhân hóa của bạn. Hãy chọn vài nguồn để bắt đầu nhé.</p>
  </div>

  <Card class="mb-8">
    <CardHeader>
      <CardTitle>Gợi ý nguồn tin (Sources)</CardTitle>
      <CardDescription>Bạn có thể thêm nhiều hơn sau khi hoàn tất thiết lập ban đầu.</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3">
      {#each SUGGESTED_SOURCES as src}
        <button 
          onclick={() => toggle(src)}
          class="flex items-center justify-between p-4 border rounded-xl hover:bg-secondary/30 transition-colors text-left {selected.includes(src) ? 'ring-2 ring-primary border-primary' : ''}">
          <div>
            <div class="font-semibold">{src.name}</div>
            <div class="text-sm text-muted-foreground">{src.url}</div>
          </div>
        </button>
      {/each}
      
      <div class="mt-4">
         <h4 class="text-sm font-medium mb-2">Hoặc thêm URL của đối tượng tuỳ chọn (RSS, Subreddit, Youtube Playlist):</h4>
         <Input bind:value={customUrl} placeholder="https://..." />
      </div>
    </CardContent>
  </Card>

  <Button class="w-full text-lg h-12" disabled={isFetching} onclick={startOnboarding}>
    {isFetching ? 'Đang đọc hiểu dữ liệu lần đầu...' : 'Bắt đầu cập nhật lưới tin'}
  </Button>
</div>
