<script lang="ts">
  import { prefs } from '$lib/stores/prefs';
  import { page } from '$app/stores';
  import { Button } from '$lib/components/ui/button';
  import { Moon, Sun, Settings } from 'lucide-svelte';

  const navLinks = [
    { href: '/', label: 'Tin tức' },
    { href: '/sources', label: 'Nguồn tin' },
  ];

  function toggleDark() {
    $prefs.darkMode = !$prefs.darkMode;
  }

  function isActive(href: string, pathname: string) {
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  }
</script>

<header class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
  <div class="container mx-auto px-4 flex h-14 items-center justify-between">
    <div class="flex items-center gap-6">
      <a href="/" class="flex items-center gap-2">
        <span class="font-bold sm:inline-block">NewsDigest</span>
      </a>
      <nav class="hidden md:flex gap-6 text-sm font-medium">
        {#each navLinks as { href, label }}
          <a {href} class="transition-colors hover:text-foreground/80 {isActive(href, $page.url.pathname) ? 'text-foreground' : 'text-foreground/60'}">{label}</a>
        {/each}
      </nav>
    </div>
    
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="icon" onclick={toggleDark}>
        {#if $prefs.darkMode}
          <Moon class="h-5 w-5" />
        {:else}
          <Sun class="h-5 w-5" />
        {/if}
        <span class="sr-only">Toggle theme</span>
      </Button>
      <Button variant="ghost" size="icon">
        <Settings class="h-5 w-5" />
        <span class="sr-only">Settings</span>
      </Button>
    </div>
  </div>
</header>
