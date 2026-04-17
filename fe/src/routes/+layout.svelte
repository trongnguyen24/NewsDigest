<script lang="ts">
  import { onMount } from 'svelte'
  import { prefs } from '$lib/stores/prefs'
  import { Toaster } from 'svelte-sonner'
  import '../app.css'
  import 'overlayscrollbars/overlayscrollbars.css'
  import { useOverlayScrollbars } from 'overlayscrollbars-svelte'
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()

  let mounted = $state(false)
  let isOnline = $state(true)

  const [initBodyScrollbars] = useOverlayScrollbars({
    defer: true,
    options: {
      scrollbars: { autoHide: 'leave', autoHideDelay: 300 },
    },
  })

  onMount(() => {
    mounted = true
    isOnline = navigator.onLine

    initBodyScrollbars({
      target: document.body,
      cancel: { body: false },
    })

    // ── Service Worker registration ──────────────────────
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err)
        })
    }

    // ── Online / Offline events ──────────────────────────
    function handleOnline() {
      isOnline = true
    }
    function handleOffline() {
      isOnline = false
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  })

  $effect(() => {
    if (mounted && typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', $prefs.darkMode)
      localStorage.setItem('darkMode', String($prefs.darkMode))

      // Update theme-color meta for iPhone status bar
      const themeColor = $prefs.darkMode ? '#222221' : '#f1f1ee'
      let meta = document.querySelector(
        'meta[name="theme-color"]',
      ) as HTMLMetaElement | null
      if (meta) {
        meta.setAttribute('content', themeColor)
        // Remove media attr so it applies unconditionally
        meta.removeAttribute('media')
      }
      // Remove second theme-color meta if present
      const allThemeMeta = document.querySelectorAll('meta[name="theme-color"]')
      allThemeMeta.forEach((el, i) => {
        if (i > 0) el.remove()
      })

      // Persist font size & apply CSS custom property
      localStorage.setItem('fontSize', String($prefs.fontSize))
      document.documentElement.style.setProperty(
        '--font-size-base',
        `${$prefs.fontSize}px`,
      )
    }
  })
</script>

<div
  class="min-h-screen bg-bg-1 sm:bg-linear-to-r sm:from-bg-1 sm:from-65% sm:to-bg-2 sm:to-65%"
>
  <Toaster richColors position="top-right" />

  <!-- Offline indicator -->
  {#if mounted && !isOnline}<div
      id="offline-banner"
      class="fixed top-6 left-1/2 md:top-auto md:bottom-0 md:inset-x-0 md:translate-x-0 z-10 flex -translate-x-1/2 items-center justify-center rounded-full overflow-hidden h-7 w-20 md:rounded-none md:w-full text-xs font-medium"
    >
      <span
        class="text-amber-600 bg-gray-200/80 flex items-center justify-center w-full h-full backdrop-blur-md"
      >
        ⚡ Offline
      </span>
    </div>{/if}

  {@render children()}
</div>
