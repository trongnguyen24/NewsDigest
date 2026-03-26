<script lang="ts">
  import { onMount } from 'svelte'
  import { prefs } from '$lib/stores/prefs'
  import { sources } from '$lib/stores/sources'
  import '../app.css'
  import 'overlayscrollbars/overlayscrollbars.css'
  import { useOverlayScrollbars } from 'overlayscrollbars-svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import type { Snippet } from 'svelte'

  let { data, children }: { data: any; children: Snippet } = $props()

  let mounted = $state(false)

  // Sync sources from load function to store (used by ArticleCard)
  $effect(() => {
    if (data.sources) {
      $sources = data.sources
    }
  })

  // Redirect to onboarding if no sources
  $effect(() => {
    if (
      mounted &&
      data.sources.length === 0 &&
      $page.url.pathname !== '/onboarding'
    ) {
      goto('/onboarding')
    }
  })

  const [initBodyScrollbars] = useOverlayScrollbars({
    defer: true,
    options: {
      scrollbars: { autoHide: 'leave', autoHideDelay: 300 },
    },
  })

  onMount(() => {
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) {
      $prefs.darkMode = saved === 'true'
    } else {
      $prefs.darkMode = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches
    }
    mounted = true

    initBodyScrollbars({
      target: document.body,
      cancel: { body: false },
    })
  })

  $effect(() => {
    if (mounted && typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', $prefs.darkMode)
      localStorage.setItem('darkMode', String($prefs.darkMode))
    }
  })
</script>

<div
  class="min-h-screen bg-[#F8F7F2] dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-100 selection:bg-zinc-200 dark:selection:bg-zinc-800"
>
  {@render children()}
</div>
