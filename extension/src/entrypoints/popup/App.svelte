<script lang="ts">
  import { onMount } from 'svelte';
  import { storage } from '@wxt-dev/storage';
  import { browser } from 'wxt/browser';
  import { getRedditSources } from '../../lib/api';
  import type { RedditSource, ScrapeStatus } from '../../lib/types';

  const DEFAULT_STATUS: ScrapeStatus = {
    running: false,
    phase: 'idle',
    contentIndex: 0,
    contentTotal: 0,
    sourcesTotal: 0,
    sourcesDone: 0,
    listingsFound: 0,
    inserted: 0,
    enqueued: 0,
    errors: 0,
    log: [],
  };

  let apiUrl = $state('http://localhost:8787');
  let adminKey = $state('');
  let sources = $state<RedditSource[]>([]);
  let status = $state<ScrapeStatus>(DEFAULT_STATUS);
  let isLoadingSources = $state(false);
  let settingsSaved = $state(false);
  let error = $state('');

  let canStart = $derived(Boolean(apiUrl.trim() && adminKey.trim() && !status.running));

  function formatDate(value?: string | null): string {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  async function saveSettings() {
    await storage.setItem('local:apiUrl', apiUrl.trim());
    await storage.setItem('local:adminKey', adminKey.trim());
    settingsSaved = true;
    setTimeout(() => (settingsSaved = false), 1200);
  }

  async function loadSources() {
    error = '';
    isLoadingSources = true;
    try {
      sources = await getRedditSources(apiUrl, adminKey);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      isLoadingSources = false;
    }
  }

  async function refreshStatus() {
    const response = await browser.runtime.sendMessage({ action: 'get-status' });
    if (response?.status) status = response.status;
  }

  async function startScrape() {
    error = '';
    await saveSettings();
    const response = await browser.runtime.sendMessage({ action: 'start-scrape', apiUrl, adminKey });
    if (!response?.ok) {
      error = response?.error || 'Failed to start scrape';
      if (response?.status) status = response.status;
      return;
    }
    status = response.status;
  }

  async function cancelScrape() {
    const response = await browser.runtime.sendMessage({ action: 'cancel-scrape' });
    if (response?.status) status = response.status;
  }

  onMount(() => {
    const handler = (message: { action?: string; status?: ScrapeStatus }) => {
      if (message?.action === 'scrape-progress' && message.status) status = message.status;
    };

    void (async () => {
      apiUrl = (await storage.getItem<string>('local:apiUrl')) || apiUrl;
      adminKey = (await storage.getItem<string>('local:adminKey')) || '';
      await refreshStatus();
      await loadSources();
    })();

    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  });
</script>

<main class="w-[380px] bg-[#f6f1e8] text-stone-950">
  <section class="border-b border-stone-300/80 bg-stone-950 px-4 py-4 text-stone-50">
    <p class="text-[11px] uppercase tracking-[0.22em] text-amber-200/80">NewsDigest</p>
    <div class="mt-1 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold leading-tight">Reddit Scraper</h1>
        <p class="mt-1 text-xs text-stone-300">Browser-based old.reddit.com collector</p>
      </div>
      <span class="rounded-full border border-stone-600 px-2.5 py-1 text-[11px] capitalize text-stone-200">
        {status.phase}
      </span>
    </div>
  </section>

  <section class="space-y-3 p-4">
    <div class="rounded-2xl border border-stone-300 bg-white/70 p-3 shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Settings</h2>
        {#if settingsSaved}<span class="text-xs text-green-700">Saved</span>{/if}
      </div>
      <label class="block text-xs font-medium text-stone-600" for="api-url">API URL</label>
      <input
        id="api-url"
        class="mt-1 h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-xs outline-none focus:border-stone-900"
        bind:value={apiUrl}
        placeholder="http://localhost:8787"
      />

      <label class="mt-3 block text-xs font-medium text-stone-600" for="admin-key">Admin Key</label>
      <input
        id="admin-key"
        class="mt-1 h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-xs outline-none focus:border-stone-900"
        type="password"
        bind:value={adminKey}
        placeholder="X-Admin-Key"
      />

      <div class="mt-3 flex gap-2">
        <button class="h-9 flex-1 rounded-xl border border-stone-900 px-3 text-xs font-semibold" onclick={saveSettings}>Save</button>
        <button class="h-9 flex-1 rounded-xl border border-stone-300 px-3 text-xs font-semibold" onclick={loadSources} disabled={isLoadingSources}>
          {isLoadingSources ? 'Loading...' : 'Refresh Sources'}
        </button>
      </div>
    </div>

    {#if error}
      <div class="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
    {/if}

    <div class="rounded-2xl border border-stone-300 bg-white/70 p-3 shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Sources</h2>
        <span class="text-xs text-stone-500">{sources.length} enabled</span>
      </div>
      <div class="max-h-28 space-y-1 overflow-auto pr-1">
        {#if sources.length === 0}
          <p class="text-xs text-stone-500">No enabled Reddit sources found.</p>
        {:else}
          {#each sources as source (source.id)}
            <div class="rounded-xl bg-stone-100 px-2.5 py-2">
              <p class="truncate text-xs font-semibold">{source.name}</p>
              <p class="truncate text-[11px] text-stone-500">Last fetched: {formatDate(source.last_fetched_at)}</p>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="grid grid-cols-4 gap-2 text-center text-[11px]">
      <div class="rounded-xl bg-stone-200/70 p-2"><b class="block text-sm">{status.sourcesDone}/{status.sourcesTotal}</b>Sources</div>
      <div class="rounded-xl bg-stone-200/70 p-2"><b class="block text-sm">{status.listingsFound}</b>Found</div>
      <div class="rounded-xl bg-stone-200/70 p-2"><b class="block text-sm">{status.inserted}</b>New</div>
      <div class="rounded-xl bg-stone-200/70 p-2"><b class="block text-sm">{status.enqueued}</b>Queued</div>
    </div>

    <div class="rounded-2xl border border-stone-300 bg-white/70 p-3 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold">{status.currentSource || 'Idle'}</p>
          <p class="text-xs text-stone-500">
            {#if status.phase === 'content'}Content {status.contentIndex}/{status.contentTotal}{:else}{status.running ? 'Listing' : 'Ready'}{/if}
          </p>
        </div>
        <span class="text-xs text-red-700">{status.errors} errors</span>
      </div>

      <div class="mt-3 flex gap-2">
        <button
          class="h-10 flex-1 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={!canStart}
          onclick={startScrape}
        >
          Scrape All Reddit
        </button>
        {#if status.running}
          <button class="h-10 rounded-xl border border-stone-300 px-3 text-xs font-semibold" onclick={cancelScrape}>Cancel</button>
        {/if}
      </div>
    </div>

    <div class="rounded-2xl border border-stone-300 bg-stone-950 p-3 text-stone-100 shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Progress Log</h2>
        <button class="text-[11px] text-stone-400" onclick={refreshStatus}>Sync</button>
      </div>
      <div class="max-h-36 space-y-1 overflow-auto font-mono text-[11px] leading-5">
        {#if status.log.length === 0}
          <p class="text-stone-500">No activity yet.</p>
        {:else}
          {#each status.log as entry (entry.id)}
            <p class={entry.level === 'error' ? 'text-red-300' : entry.level === 'success' ? 'text-green-300' : 'text-stone-300'}>
              [{entry.time}] {entry.message}
            </p>
          {/each}
        {/if}
      </div>
    </div>
  </section>
</main>
