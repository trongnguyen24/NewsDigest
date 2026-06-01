<script lang="ts">
  import { onMount } from 'svelte';
  import { storage } from '@wxt-dev/storage';
  import { browser } from 'wxt/browser';
  import { getRedditSources } from '../../lib/api';
  import type { RedditSource, ScrapeStatus } from '../../lib/types';
  import { Sun, Moon, Settings, RefreshCw, Play, AlertCircle, Terminal, Ban, Link2, ShieldAlert, Trash2 } from 'lucide-svelte';

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
    retryTotal: 0,
    retryDone: 0,
    retrySkipped: 0,
    log: [],
  };

  let apiUrl = $state('http://localhost:8787');
  let adminKey = $state('');
  let sources = $state<RedditSource[]>([]);
  let status = $state<ScrapeStatus>(DEFAULT_STATUS);
  let isLoadingSources = $state(false);
  let settingsSaved = $state(false);
  let error = $state('');
  let darkMode = $state(false);

  // Connection and navigation states
  let isVerified = $state(false);
  let isTesting = $state(false);
  let isCheckingOnMount = $state(false);
  let testError = $state('');
  let activeTab = $state<'scraper' | 'settings'>('settings');

  let activeTabIndex = $derived(
    activeTab === 'scraper' ? 0 : 1
  );

  let canStart = $derived(Boolean(apiUrl.trim() && adminKey.trim() && !status.running && isVerified));

  function formatDate(value?: string | null): string {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
  }

  async function saveAndTestSettings() {
    testError = '';
    isTesting = true;
    try {
      // 1. Fetch sources to test connectivity & adminKey authentication
      const fetchedSources = await getRedditSources(apiUrl, adminKey);
      
      // 2. Save settings to storage only if verification succeeded
      await storage.setItem('local:apiUrl', apiUrl.trim());
      await storage.setItem('local:adminKey', adminKey.trim());
      
      sources = fetchedSources;
      settingsSaved = true;
      isVerified = true;
      setTimeout(() => (settingsSaved = false), 1200);
      
      // 3. Switch to main scraper console
      activeTab = 'scraper';
    } catch (err) {
      isVerified = false;
      testError = err instanceof Error ? err.message : String(err);
    } finally {
      isTesting = false;
    }
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

  async function clearLog() {
    const response = await browser.runtime.sendMessage({ action: 'clear-log' });
    if (response?.status) status = response.status;
  }

  async function startScrape() {
    error = '';
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

  async function retryFailed() {
    error = '';
    const response = await browser.runtime.sendMessage({ action: 'retry-failed', apiUrl, adminKey });
    if (!response?.ok) {
      error = response?.error || 'Failed to start retry';
      if (response?.status) status = response.status;
      return;
    }
    status = response.status;
  }

  function toggleDarkMode() {
    darkMode = !darkMode;
    localStorage.setItem('local:darkMode', String(darkMode));
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', darkMode);
    }
  }

  function handlePress(event: MouseEvent | PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    target?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.95)' },
        { transform: 'scale(1)' },
      ],
      { duration: 250, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' }
    );
  }

  onMount(() => {
    const handler = (message: { action?: string; status?: ScrapeStatus }) => {
      if (message?.action === 'scrape-progress' && message.status) status = message.status;
    };

    void (async () => {
      // Dark Mode setup
      const savedDarkMode = localStorage.getItem('local:darkMode');
      if (savedDarkMode !== null) {
        darkMode = savedDarkMode === 'true';
      } else {
        darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', darkMode);
      }

      apiUrl = (await storage.getItem<string>('local:apiUrl')) || apiUrl;
      adminKey = (await storage.getItem<string>('local:adminKey')) || '';
      await refreshStatus();

      // Silent connection verify if settings exist
      if (apiUrl) {
        isCheckingOnMount = true;
        try {
          sources = await getRedditSources(apiUrl, adminKey);
          isVerified = true;
          activeTab = 'scraper';
        } catch (err) {
          isVerified = false;
          activeTab = 'settings';
          testError = 'Initial connection failed. Please check settings.';
        } finally {
          isCheckingOnMount = false;
        }
      } else {
        isVerified = false;
        activeTab = 'settings';
      }
    })();

    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  });
</script>

<main class="w-[400px] h-[580px] bg-bg-1 text-text-main flex flex-col overflow-hidden">
  <!-- Header -->
  <header class="border-b border-border px-4 py-4 flex flex-col gap-3 relative shrink-0">
    <div class="flex justify-between items-center">
      <div class="flex items-center gap-2">
        <h1 class="text-xl font-bold font-serif leading-none tracking-tight text-text-main">Reddit Scraper</h1>
        <!-- Status Pill -->
        <span class="rounded-full border border-border bg-bg-btn px-2 py-0.5 text-[10px] font-medium capitalize text-text-main shadow-xs flex items-center gap-1">
          <span class="size-1.5 rounded-full 
            {status.phase === 'idle' ? 'bg-zinc-400' : ''}
            {status.phase === 'listing' ? 'bg-blue-500 animate-pulse' : ''}
            {status.phase === 'content' ? 'bg-amber-500 animate-pulse' : ''}
            {status.phase === 'retrying' ? 'bg-purple-500 animate-pulse' : ''}
            {status.phase === 'done' ? 'bg-green-500' : ''}
            {status.phase === 'error' ? 'bg-red-500' : ''}
            {status.phase === 'cancelled' ? 'bg-zinc-500' : ''}"
          ></span>
          {status.phase}
        </span>
      </div>

      <!-- Theme Toggle Button -->
      <button 
        onclick={toggleDarkMode}
        onpointerdown={handlePress}
        class="relative size-8 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] cursor-pointer flex items-center justify-center text-text-main hover:opacity-90 transition-opacity"
        aria-label="Toggle theme"
      >
        {#if darkMode}
          <Sun size={14} class="text-amber-400" />
        {:else}
          <Moon size={14} class="text-zinc-600" />
        {/if}
      </button>
    </div>

    <!-- Sliding Tab Switcher (Visible only when connected) -->
    {#if isVerified && !isCheckingOnMount}
      <div class="relative h-8 bg-black/5 dark:bg-stone-950/60 border border-border/60 dark:border-stone-800/80 rounded-full p-0.5 flex items-center w-[184px] mx-auto mt-1.5 overflow-hidden">
        <!-- Sliding Indicator -->
        <span 
          class="absolute top-0.5 bottom-0.5 w-[88px] rounded-full border border-white bg-bg-btn dark:bg-stone-800 dark:border-stone-700/50 shadow-xs dark:shadow-md transition-transform duration-300 ease-out"
          style="transform: translateX({activeTabIndex * 90}px);"
        ></span>
        <!-- Tab Buttons -->
        <button 
          onclick={() => activeTab = 'scraper'} 
          onpointerdown={handlePress}
          class="relative z-10 w-[90px] h-full text-[11px] font-semibold text-center transition-all duration-200 cursor-pointer"
          class:text-text-main={activeTab === 'scraper'}
          class:text-text-secondary={activeTab !== 'scraper'}
          class:opacity-50={activeTab !== 'scraper'}
        >Scraper</button>
        <button 
          onclick={() => activeTab = 'settings'} 
          onpointerdown={handlePress}
          class="relative z-10 w-[90px] h-full text-[11px] font-semibold text-center transition-all duration-200 cursor-pointer"
          class:text-text-main={activeTab === 'settings'}
          class:text-text-secondary={activeTab !== 'settings'}
          class:opacity-50={activeTab !== 'settings'}
        >Settings</button>
      </div>
    {/if}
  </header>

  <!-- Body -->
  <div class="p-4 space-y-4 flex-1 flex flex-col justify-start overflow-y-auto custom-scrollbar">
    
    <!-- Case 0: Verification Check on Load -->
    {#if isCheckingOnMount}
      <div class="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-center">
        <RefreshCw size={24} class="text-text-secondary animate-spin" />
        <p class="text-xs text-text-secondary font-medium">Verifying connection to NewsDigest API...</p>
      </div>

    <!-- Case 1: Unverified / Needs Setup -->
    {:else if !isVerified}
      <section class="relative rounded-2xl border border-white dark:border-white/5 bg-bg-btn shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] p-4 flex flex-col gap-4 animate-in fade-in-0 duration-300">
        <div class="flex items-start gap-3">
          <div class="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
            <Link2 size={16} />
          </div>
          <div>
            <h2 class="text-sm font-semibold font-serif text-text-main">Configure Connection</h2>
            <p class="text-[11px] text-text-secondary mt-1 leading-relaxed">
              Enter your API URL and Admin Key to verify connection and authorize scraper operations.
            </p>
          </div>
        </div>

        <div class="space-y-3 border-t border-border/40 pt-3">
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1" for="api-url">Worker API URL</label>
            <input
              id="api-url"
              class="h-9 w-full rounded-xl border border-border bg-bg-2 px-3 text-xs text-text-main outline-none focus:border-bw placeholder:text-text-secondary/55 transition-colors"
              bind:value={apiUrl}
              placeholder="http://localhost:8787"
            />
          </div>

          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1" for="admin-key">Admin Key</label>
            <input
              id="admin-key"
              class="h-9 w-full rounded-xl border border-border bg-bg-2 px-3 text-xs text-text-main outline-none focus:border-bw placeholder:text-text-secondary/55 transition-colors"
              type="password"
              bind:value={adminKey}
              placeholder="X-Admin-Key"
            />
          </div>

          <button 
            onclick={saveAndTestSettings}
            onpointerdown={handlePress}
            disabled={isTesting}
            class="h-10 w-full rounded-xl bg-bw text-bg-1 text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 shadow-sm mt-4 transition-all"
          >
            {#if isTesting}
              <RefreshCw size={12} class="animate-spin" />
              Testing Connection...
            {:else}
              Verify & Connect
            {/if}
          </button>
        </div>

        {#if testError}
          <div class="rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/30 px-3 py-2 text-[10px] text-red-800 dark:text-red-300 flex items-start gap-1.5 animate-in fade-in-0 duration-200">
            <ShieldAlert size={12} class="shrink-0 mt-0.5" />
            <div>{testError}</div>
          </div>
        {/if}
      </section>

    <!-- Case 2: Verified -> Tab Content -->
    {:else}
      
      <!-- Tab 1: Scraper Console -->
      {#if activeTab === 'scraper'}
        <div class="space-y-4 animate-in fade-in-0 duration-200">
          <!-- Scraper Controller Card -->
          <section class="relative rounded-2xl border border-white dark:border-white/5 bg-bg-btn shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-xs font-semibold text-text-main">{status.currentSource || 'Idle'}</p>
                <p class="text-[10px] text-text-secondary mt-0.5 font-medium">
                  {#if status.phase === 'content'}
                    Content {status.contentIndex}/{status.contentTotal}
                  {:else if status.phase === 'retrying'}
                    Retry {status.contentIndex}/{status.contentTotal}
                  {:else}
                    {status.running ? 'Scraping listing...' : 'Ready to scrape'}
                  {/if}
                </p>
              </div>
              <span class="text-xs font-medium text-red-600 dark:text-red-400 shrink-0 bg-red-50 dark:bg-red-950/30 px-2.5 py-0.5 rounded-full border border-red-200/20 tabular-nums">
                {status.errors} errors
              </span>
            </div>

            <div class="mt-4 flex gap-2.5">
              {#if status.running}
                <button 
                  class="h-10 flex-1 rounded-xl border border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/30 text-red-700 dark:text-red-300 px-4 text-xs font-semibold hover:bg-red-100/50 transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm" 
                  onclick={cancelScrape}
                  onpointerdown={handlePress}
                >
                  <Ban size={11} />
                  Cancel Scraping
                </button>
              {:else}
                <button
                  class="h-10 flex-1 rounded-xl bg-bw text-bg-1 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5 shadow-sm transition-opacity hover:opacity-90"
                  disabled={!canStart}
                  onclick={startScrape}
                  onpointerdown={handlePress}
                >
                  <Play size={11} fill="currentColor" />
                  Scrape All
                </button>
                <button
                  class="h-10 flex-1 rounded-xl border border-border bg-bg-btn text-text-main px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs hover:bg-bg-2/30"
                  disabled={!canStart}
                  onclick={retryFailed}
                  onpointerdown={handlePress}
                >
                  <RefreshCw size={11} />
                  Retry Failed
                </button>
              {/if}
            </div>
          </section>

          <!-- Stats Grid -->
          <div class="grid grid-cols-5 gap-2 text-center text-[10px] font-medium">
            <div class="rounded-xl bg-bg-btn border border-white dark:border-white/5 shadow-xs p-2 flex flex-col justify-between min-w-0">
              <span class="text-text-secondary truncate">Sources</span>
              <b class="text-xs font-bold text-text-main mt-1 tabular-nums">{status.sourcesDone}/{status.sourcesTotal}</b>
            </div>
            <div class="rounded-xl bg-bg-btn border border-white dark:border-white/5 shadow-xs p-2 flex flex-col justify-between min-w-0">
              <span class="text-text-secondary truncate">Found</span>
              <b class="text-xs font-bold text-text-main mt-1 tabular-nums">{status.listingsFound}</b>
            </div>
            <div class="rounded-xl bg-bg-btn border border-white dark:border-white/5 shadow-xs p-2 flex flex-col justify-between min-w-0">
              <span class="text-text-secondary truncate">New</span>
              <b class="text-xs font-bold text-text-main mt-1 tabular-nums">{status.inserted}</b>
            </div>
            <div class="rounded-xl bg-bg-btn border border-white dark:border-white/5 shadow-xs p-2 flex flex-col justify-between min-w-0">
              <span class="text-text-secondary truncate">Queued</span>
              <b class="text-xs font-bold text-text-main mt-1 tabular-nums">{status.enqueued}</b>
            </div>
            <div class="rounded-xl bg-amber-100/50 dark:bg-amber-950/20 border border-amber-200/20 shadow-xs p-2 flex flex-col justify-between min-w-0">
              <span class="text-amber-800 dark:text-amber-300 truncate">Retry</span>
              <b class="text-xs font-bold text-amber-800 dark:text-amber-300 mt-1 tabular-nums">{status.retryDone}/{status.retryTotal}</b>
            </div>
          </div>

          <!-- Error Alert inside Console -->
          {#if error}
            <div class="rounded-2xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/30 px-4 py-3 text-xs text-red-800 dark:text-red-300 flex items-start gap-2">
              <AlertCircle size={14} class="shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          {/if}

          <!-- Progress Log (Console) -->
          <section class="rounded-2xl bg-[hsl(60_3%_13%)] border border-stone-850 p-4 text-stone-100 shadow-md">
            <div class="mb-3 flex items-center justify-between border-b border-stone-800 pb-2">
              <h2 class="text-xs font-semibold font-serif text-stone-300 flex items-center gap-1.5">
                <Terminal size={12} class="text-stone-400" />
                Progress Log
              </h2>
              <button 
                class="text-[10px] text-stone-400 hover:text-stone-200 cursor-pointer flex items-center gap-0.5 transition-colors" 
                onclick={clearLog}
              >
                <Trash2 size={10} />
                Clear Log
              </button>
            </div>
            <div class="max-h-36 space-y-1.5 overflow-auto pr-1 font-mono text-[10px] leading-relaxed scrollbar-thin scrollbar-thumb-stone-700 select-text">
              {#if status.log.length === 0}
                <p class="text-stone-500 italic">No activity logs recorded yet.</p>
              {:else}
                {#each status.log as entry (entry.id)}
                  <p class="wrap-break-word">
                    <span class="text-stone-500 opacity-80">[{entry.time}]</span> 
                    <span class={
                      entry.level === 'error' ? 'text-red-400 font-semibold' : 
                      entry.level === 'success' ? 'text-green-400' : 
                      'text-stone-300'
                    }>
                      {entry.message}
                    </span>
                  </p>
                {/each}
              {/if}
            </div>
          </section>
        </div>

      <!-- Tab 2: Settings & Sources Editor -->
      {:else if activeTab === 'settings'}
        <div class="space-y-4 animate-in fade-in-0 duration-200">
          <!-- Connection Settings Card -->
          <section class="relative rounded-2xl border border-white dark:border-white/5 bg-bg-btn shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] p-4 flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold font-serif flex items-center gap-1.5">
                <Settings size={14} class="text-text-secondary" />
                Settings
              </h2>
              {#if settingsSaved}
                <span class="text-xs font-semibold text-green-600 dark:text-green-400 animate-fade-in-out">Saved</span>
              {/if}
            </div>
            
            <div class="space-y-3">
              <div>
                <label class="block text-[11px] font-medium text-text-secondary mb-1" for="api-url">Worker API URL</label>
                <input
                  id="api-url"
                  class="h-9 w-full rounded-xl border border-border bg-bg-2 px-3 text-xs text-text-main outline-none focus:border-bw placeholder:text-text-secondary/55 transition-colors"
                  bind:value={apiUrl}
                  placeholder="http://localhost:8787"
                />
              </div>

              <div>
                <label class="block text-[11px] font-medium text-text-secondary mb-1" for="admin-key">Admin Key</label>
                <input
                  id="admin-key"
                  class="h-9 w-full rounded-xl border border-border bg-bg-2 px-3 text-xs text-text-main outline-none focus:border-bw placeholder:text-text-secondary/55 transition-colors"
                  type="password"
                  bind:value={adminKey}
                  placeholder="X-Admin-Key"
                />
              </div>

              <button 
                onclick={saveAndTestSettings}
                onpointerdown={handlePress}
                disabled={isTesting}
                class="h-10 w-full rounded-xl bg-bw text-bg-1 text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 shadow-sm mt-4 transition-all"
              >
                {#if isTesting}
                  <RefreshCw size={12} class="animate-spin" />
                  Testing Connection...
                {:else}
                  Save & Reconnect
                {/if}
              </button>
            </div>

            {#if testError}
              <div class="rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/30 px-3 py-2 text-[10px] text-red-800 dark:text-red-300 flex items-start gap-1.5">
                <ShieldAlert size={12} class="shrink-0 mt-0.5" />
                <div>{testError}</div>
              </div>
            {/if}
          </section>

          <!-- Sources Card -->
          <section class="relative rounded-2xl border border-white dark:border-white/5 bg-bg-btn shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] p-4 flex flex-col justify-start">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-sm font-semibold font-serif">Sources</h2>
              <span class="text-xs text-text-secondary bg-bg-2 px-2 py-0.5 rounded-full border border-border/40 font-medium tabular-nums">{sources.length} enabled</span>
            </div>
            
            <div class="space-y-1.5">
              {#if sources.length === 0}
                <div class="text-center py-6 text-xs text-text-secondary border border-dashed border-border rounded-xl">
                  No enabled Reddit sources found.
                </div>
              {:else}
                {#each sources as source (source.id)}
                  <div class="rounded-xl bg-bg-2 border border-border/20 p-2 flex justify-between items-center gap-2 hover:border-border/60 transition-colors">
                    <div class="min-w-0">
                      <p class="truncate text-xs font-semibold text-text-main">{source.name}</p>
                      <p class="truncate text-[9px] text-text-secondary mt-0.5">Last fetched: {formatDate(source.last_fetched_at)}</p>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>

            <div class="mt-3 pt-3 border-t border-border/40 flex justify-end">
              <button 
                class="h-8 rounded-xl border border-border bg-bg-btn text-text-main text-xs font-semibold hover:bg-bg-2/50 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 px-3 shadow-xs" 
                onclick={loadSources} 
                disabled={isLoadingSources}
                onpointerdown={handlePress}
              >
                <RefreshCw size={11} class={isLoadingSources ? 'animate-spin' : ''} />
                {isLoadingSources ? 'Syncing...' : 'Sync Sources'}
              </button>
            </div>
          </section>
        </div>
      {/if}

    {/if}

  </div>
</main>
