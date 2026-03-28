<script lang="ts">
  import { sources } from '$lib/stores/sources';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Switch } from '$lib/components/ui/switch';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Plus, Trash2, RefreshCw, Lock, LockOpen } from 'lucide-svelte';
  import { api } from '$lib/api';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  const ADMIN_KEY_STORAGE = 'newsdigest_admin_key';

  let newUrl = $state('');
  let newName = $state('');
  let isAdding = $state(false);
  let loading = $state(true);
  let adminKey = $state('');
  let authError = $state('');
  let showKeyInput = $state(false);

  let isAuthed = $derived(adminKey.trim().length > 0);

  function adminHeaders(): Record<string, string> {
    return adminKey ? { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey } : { 'Content-Type': 'application/json' };
  }

  onMount(() => {
    const saved = localStorage.getItem(ADMIN_KEY_STORAGE);
    if (saved) adminKey = saved;
    fetchSources();
  });

  async function fetchSources() {
    loading = true;
    try {
      const res = await fetch(api('/api/sources'));
      const data = await res.json();
      $sources = data.sources ?? [];
    } catch (e) {
      console.error('Failed to fetch sources', e);
    } finally {
      loading = false;
    }
  }

  function saveAdminKey() {
    if (browser) {
      localStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
    }
    authError = '';
    showKeyInput = false;
  }

  function clearAdminKey() {
    adminKey = '';
    if (browser) localStorage.removeItem(ADMIN_KEY_STORAGE);
    authError = '';
  }

  async function addSource() {
    if (!newUrl.trim()) return;
    isAdding = true;
    authError = '';
    try {
      const res = await fetch(api('/api/sources'), {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ url: newUrl, name: newName || undefined, group_name: 'General' })
      });
      if (res.status === 401) {
        authError = 'Admin key không đúng!';
        isAdding = false;
        return;
      }
      const result = await res.json();
      if (result.ok && result.source) {
        newUrl = '';
        newName = '';
        // Trigger first fetch for the new source
        fetch(api(`/api/sources/${result.source.id}/fetch`), {
          method: 'POST',
          headers: adminHeaders()
        });
        await fetchSources();
      }
    } catch(e) {
      console.error('Failed to add source', e);
    } finally {
      isAdding = false;
    }
  }

  async function toggleSource(id: string, currentEnabled: number) {
    const newEnabled = currentEnabled ? false : true;
    authError = '';
    try {
      const res = await fetch(api(`/api/sources/${id}`), {
        method: 'PATCH',
        headers: adminHeaders(),
        body: JSON.stringify({ enabled: newEnabled })
      });
      if (res.status === 401) {
        authError = 'Admin key không đúng!';
        return;
      }
      // Optimistic update
      $sources = $sources.map(s => s.id === id ? { ...s, enabled: newEnabled ? 1 : 0 } : s);
    } catch(e) { console.error('Toggle failed', e); }
  }

  async function deleteSource(id: string) {
    authError = '';
    try {
      const res = await fetch(api(`/api/sources/${id}`), {
        method: 'DELETE',
        headers: adminHeaders()
      });
      if (res.status === 401) {
        authError = 'Admin key không đúng!';
        return;
      }
      $sources = $sources.filter(s => s.id !== id);
    } catch(e) { console.error('Delete failed', e); }
  }

  async function manualFetch(id: string) {
    authError = '';
    try {
      const res = await fetch(api(`/api/sources/${id}/fetch`), {
        method: 'POST',
        headers: adminHeaders()
      });
      if (res.status === 401) {
        authError = 'Admin key không đúng!';
      }
    } catch(e) { console.error('Manual fetch failed', e); }
  }
</script>

<svelte:head>
  <title>NewsDigest - Nguồn Tin</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
  <!-- Header -->
  <div class="mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Quản lý Nguồn tin</h1>
      <p class="text-muted-foreground mt-1">Danh sách các trang báo, RSS, channel.</p>
    </div>
    <!-- Admin Key Toggle -->
    <div class="flex items-center gap-2">
      {#if isAuthed}
        <span class="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <LockOpen size={12} /> Đã xác thực
        </span>
        <Button variant="outline" size="sm" onclick={clearAdminKey}>Đăng xuất</Button>
      {:else}
        {#if showKeyInput}
          <Input
            type="password"
            bind:value={adminKey}
            placeholder="Admin key..."
            class="w-48 h-8 text-sm"
            onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveAdminKey()}
          />
          <Button size="sm" onclick={saveAdminKey}>Lưu</Button>
          <Button variant="outline" size="sm" onclick={() => showKeyInput = false}>Huỷ</Button>
        {:else}
          <Button variant="outline" size="sm" onclick={() => showKeyInput = true}>
            <Lock size={14} class="mr-1" /> Đăng nhập
          </Button>
        {/if}
      {/if}
    </div>
  </div>

  {#if authError}
    <div class="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
      🔒 {authError}
    </div>
  {/if}

  <!-- Add Source Form (only if authed) -->
  {#if isAuthed}
    <div class="mb-6 flex flex-col sm:flex-row gap-2">
      <Input bind:value={newUrl} placeholder="URL Nguồn..." class="flex-1" />
      <Input bind:value={newName} placeholder="Tên (tuỳ chọn)" class="w-full sm:w-40" />
      <Button disabled={isAdding || !newUrl.trim()} onclick={addSource}>
        <Plus size={16} class="mr-2"/>{isAdding ? 'Đang thêm...' : 'Thêm mới'}
      </Button>
    </div>
  {/if}

  <!-- Sources List -->
  {#if loading}
    <div class="flex flex-col gap-4 animate-pulse">
      {#each Array(4) as _}
        <div class="rounded-lg border p-6">
          <div class="h-5 w-48 rounded bg-zinc-200 dark:bg-zinc-800 mb-2"></div>
          <div class="h-4 w-80 rounded bg-zinc-200 dark:bg-zinc-800 mb-1"></div>
          <div class="h-3 w-32 rounded bg-zinc-200 dark:bg-zinc-800"></div>
        </div>
      {/each}
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
            {#if isAuthed}
              <div class="flex items-center gap-3">
                <button class="text-muted-foreground hover:text-foreground transition-colors" title="Fetch thủ công" onclick={() => manualFetch(source.id)}>
                  <RefreshCw size={16} />
                </button>
                <button class="text-muted-foreground hover:text-destructive transition-colors" title="Xoá nguồn" onclick={() => deleteSource(source.id)}>
                  <Trash2 size={16} />
                </button>
                <Switch checked={source.enabled === 1} onCheckedChange={() => toggleSource(source.id, source.enabled)} />
              </div>
            {:else}
              <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-1 rounded-full {source.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}">
                  {source.enabled ? 'Đang bật' : 'Tắt'}
                </span>
              </div>
            {/if}
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}
</div>
