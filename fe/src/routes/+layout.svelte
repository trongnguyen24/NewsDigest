<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs } from '$lib/stores/prefs';
  import { api } from '$lib/api';
  import NavBar from '$lib/components/app/NavBar.svelte';
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { sources } from '$lib/stores/sources';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  let mounted = $state(false);

  onMount(async () => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
        $prefs.darkMode = saved === 'true';
    } else {
        $prefs.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    mounted = true;

    try {
      const res = await fetch(api('/api/sources'));
      const data = await res.json();
      if (data.sources) {
        $sources = data.sources;
        if (data.sources.length === 0 && $page.url.pathname !== '/onboarding') {
          goto('/onboarding');
        }
      }
    } catch(e) {
      // Mock sources for testing when backend is unavailable
      if ($sources.length === 0) {
        $sources = [
          { id: 'mock-1', url: 'https://news.ycombinator.com/rss', name: 'HackerNews', type: 'rss' as const, enabled: 1, group_name: 'Tech', last_fetched_at: null, created_at: new Date().toISOString() },
          { id: 'mock-2', url: 'https://vnexpress.net/rss/tin-moi-nhat.rss', name: 'VnExpress', type: 'rss' as const, enabled: 1, group_name: 'News', last_fetched_at: null, created_at: new Date().toISOString() },
          { id: 'mock-3', url: 'https://blog.cloudflare.com/rss/', name: 'Cloudflare Blog', type: 'rss' as const, enabled: 1, group_name: 'Tech', last_fetched_at: null, created_at: new Date().toISOString() },
        ];
      }
    }
  });

  $effect(() => {
    if (mounted && typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', $prefs.darkMode);
      localStorage.setItem('darkMode', String($prefs.darkMode));
    }
  });
</script>

<NavBar />
<main class="container mx-auto px-4 py-6">
  {@render children()}
</main>
