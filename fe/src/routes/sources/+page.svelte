<script lang="ts">
  import { onMount } from 'svelte';
  import { sources } from '$lib/stores/sources';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Switch } from '$lib/components/ui/switch';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Plus, Trash2, RefreshCw } from 'lucide-svelte';
  import { api } from '$lib/api';

  let isLoading = true;
  let newUrl = '';
  let newName = '';
  let isAdding = false;

  onMount(async () => {
    try {
      const res = await fetch(api('/api/sources'));
      const data = await res.json();
      if (data.sources) {
        $sources = data.sources;
      }
    } catch(e) {} finally { isLoading = false; }
  });

  async function addSource() {
    if (!newUrl.trim()) return;
    isAdding = true;
    try {
      const res = await fetch(api('/api/sources'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, name: newName || undefined, group_name: 'General' })
      });
      const data = await res.json();
      if (data.ok && data.source) {
        $sources = [...$sources, data.source];
        newUrl = '';
        newName = '';
        // Trigger first fetch for the new source
        fetch(api(`/api/sources/${data.source.id}/fetch`), { method: 'POST' });
      }
    } catch(e) {
      console.error('Failed to add source', e);
    } finally {
      isAdding = false;
    }
  }

  async function toggleSource(id: string, currentEnabled: number) {
    const newEnabled = currentEnabled ? false : true;
    try {
      await fetch(api(`/api/sources/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled })
      });
      $sources = $sources.map(s => s.id === id ? { ...s, enabled: newEnabled ? 1 : 0 } : s);
    } catch(e) { console.error('Toggle failed', e); }
  }

  async function deleteSource(id: string) {
    try {
      await fetch(api(`/api/sources/${id}`), { method: 'DELETE' });
      $sources = $sources.filter(s => s.id !== id);
    } catch(e) { console.error('Delete failed', e); }
  }

  async function manualFetch(id: string) {
    try {
      await fetch(api(`/api/sources/${id}/fetch`), { method: 'POST' });
    } catch(e) { console.error('Manual fetch failed', e); }
  }
</script>

<svelte:head>
  <title>NewsDigest - Nguồn Tin</title>
</svelte:head>

<div class="mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Quản lý Nguồn tin</h1>
    <p class="text-muted-foreground mt-1">Danh sách các trang báo, RSS, channel.</p>
  </div>
  <div class="flex gap-2">
     <Input bind:value={newUrl} placeholder="URL Nguồn..." class="w-64" />
     <Input bind:value={newName} placeholder="Tên (tuỳ chọn)" class="w-40" />
     <Button disabled={isAdding || !newUrl.trim()} on:click={addSource}>
       <Plus size={16} class="mr-2"/>{isAdding ? 'Đang thêm...' : 'Thêm mới'}
     </Button>
  </div>
</div>

{#if isLoading}
  <div class="animate-pulse flex flex-col gap-4">
    <div class="h-20 bg-muted rounded-xl bg-secondary/50"></div>
    <div class="h-20 bg-muted rounded-xl bg-secondary/50"></div>
  </div>
{:else if $sources.length === 0}
  <div class="py-20 text-center border rounded-lg border-dashed text-muted-foreground">
    Chưa có nguồn tin nào. Hãy thêm nguồn tin ở trên.
  </div>
{:else}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {#each $sources as source (source.id)}
      <Card>
        <CardContent class="p-6 flex items-center justify-between">
          <div class="flex flex-col gap-1 max-w-[65%]">
            <h3 class="font-semibold text-lg">{source.name}</h3>
            <a href={source.url} class="text-sm text-primary hover:underline truncate" target="_blank" rel="noopener noreferrer">
              {source.url}
            </a>
            <div class="text-xs text-muted-foreground mt-1">Loại: {source.type} • Nhóm: {source.group_name}</div>
          </div>
          <div class="flex items-center gap-3">
            <button class="text-muted-foreground hover:text-foreground transition-colors" title="Fetch thủ công" on:click={() => manualFetch(source.id)}>
              <RefreshCw size={16} />
            </button>
            <button class="text-muted-foreground hover:text-destructive transition-colors" title="Xoá nguồn" on:click={() => deleteSource(source.id)}>
              <Trash2 size={16} />
            </button>
            <Switch checked={source.enabled === 1} on:click={() => toggleSource(source.id, source.enabled)} />
          </div>
        </CardContent>
      </Card>
    {/each}
  </div>
{/if}
