<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs } from '$lib/stores/prefs';
  import { api } from '$lib/api';
  import NavBar from '$lib/components/app/NavBar.svelte';
  import '../app.css';

  let mounted = false;

  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { sources } from '$lib/stores/sources';

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
    } catch(e) {}
  });

  $: if (mounted && typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', $prefs.darkMode);
    localStorage.setItem('darkMode', String($prefs.darkMode));
  }
</script>

<NavBar />
<main class="container mx-auto px-4 py-6">
  <slot />
</main>
