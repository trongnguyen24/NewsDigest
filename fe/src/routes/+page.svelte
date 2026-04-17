<script lang="ts">
  import { tick, onMount, untrack } from 'svelte'
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { filters } from '$lib/stores/articles'
  import { prefs, cycleFontSize } from '$lib/stores/prefs'
  import {
    CaseSensitive,
    ChevronLeft,
    ChevronRight,
    Clock,
    Link2,
    Loader2,
    Moon,
    Sparkles,
    Sun,
    X,
  } from 'lucide-svelte'
  import type { Article } from '$lib/types'
  import { sources } from '$lib/stores/sources'
  import { api } from '$lib/api'
  import { marked } from 'marked'
  import { OverlayScrollbarsComponent } from 'overlayscrollbars-svelte'
  import { slideScaleFade } from '$lib/transitions/slideScaleFade'
  import CusButton from '$lib/components/ui/CusButton.svelte'
  import { articleCache } from '$lib/stores/articleCache.svelte'
  import SourceFilter from '$lib/components/app/SourceFilter.svelte'
  import MobileArticleSheet from '$lib/components/app/MobileArticleSheet.svelte'
  import PullToRefresh from '$lib/components/app/PullToRefresh.svelte'
  import { getStoredAdminKey } from '$lib/admin'

  let { data } = $props()

  // ── Derived from cache store ─────────────────────────────────
  let articles = $derived(articleCache.articles)
  let digest = $derived(articleCache.digest)
  // loading: full network fetch with no cache (shows skeleton)
  // initializing: IDB check in progress (shows nothing — avoids flash)
  let loading = $derived(articleCache.loading || articleCache.initializing)
  let unsummarizedCount = $derived(articleCache.unsummarizedCount)

  let resummarizing = $state(false)
  // Timestamp (ms) until which the AI button is hidden after enqueue.
  // null = show button normally.
  let aiHideUntil = $state<number | null>(null)
  // Number of articles enqueued in the last action (for the toast message).
  let lastEnqueued = $state(0)
  // Whether the toast is visible
  let showEnqueueToast = $state(false)
  let isAdmin = $state(false)

  // Derived: is the button still within its hide window?
  let aiButtonHidden = $derived(
    aiHideUntil !== null && Date.now() < aiHideUntil,
  )

  // Human-readable countdown label (e.g. "~2 phút")
  let aiEstimateLabel = $derived.by(() => {
    if (!aiHideUntil) return ''
    const remainSec = Math.ceil((aiHideUntil - Date.now()) / 1000)
    if (remainSec <= 0) return ''
    if (remainSec < 60) return `~${remainSec}s`
    return `~${Math.ceil(remainSec / 60)} phút`
  })

  // ── Mobile / Drawer state ──────────────────────────────────
  let drawerOpen = $state(false)
  // True while PullToRefresh indicator is visible → nav becomes transparent
  let ptrActive = $state(false)

  // Also fetch sources client-side
  async function fetchSources() {
    try {
      const res = await fetch(api('/api/sources'))
      const data = await res.json()
      $sources = data.sources ?? []
    } catch (e) {
      console.error('Failed to fetch sources', e)
    }
  }

  // Trigger on mount and when currentDate changes
  // Only track data.currentDate — do NOT re-run when articles/loading change
  $effect(() => {
    const date = data.currentDate
    if (browser) {
      untrack(() => articleCache.loadDate(date))
    }
  })

  onMount(() => {
    fetchSources()
    // Check admin auth from localStorage (shared with /sources page)
    isAdmin = getStoredAdminKey().length > 0

    // PWA resume: detect when app comes back from background
    // Track what "today" was when the user last saw the page,
    // so we only auto-navigate if the calendar day actually rolled over
    // while the user was viewing today (not an intentionally chosen past date).
    let lastKnownToday = todayStr

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      clockTick = Date.now()

      const now = new Date()
      const currentTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

      if (
        currentTodayStr !== lastKnownToday &&
        data.currentDate === lastKnownToday
      ) {
        // The calendar day rolled over while the user was viewing "today" → navigate to the new today
        lastKnownToday = currentTodayStr
        goto('/', { invalidateAll: true })
      } else {
        lastKnownToday = currentTodayStr
        // Same day or user was viewing a past date → just refresh current view
        articleCache.forceRefresh(data.currentDate)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Update clock every minute to detect midnight transitions
    const tickInterval = setInterval(() => {
      clockTick = Date.now()
    }, 60_000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearInterval(tickInterval)
    }
  })

  // Resummarize handler
  async function handleResummarize() {
    if (resummarizing || aiButtonHidden) return
    resummarizing = true
    try {
      const res = await fetch(api('/api/articles/enqueue-scrape'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await res.json()
      if (result.ok !== false) {
        const enqueued = result.enqueued ?? 0
        lastEnqueued = enqueued

        // Estimated processing time: 6s per article, minimum 30s, max 3 minutes
        const estimatedMs = Math.min(
          Math.max(30_000, enqueued * 6_000),
          3 * 60_000,
        )
        aiHideUntil = Date.now() + estimatedMs

        // Show toast
        showEnqueueToast = true
        setTimeout(() => (showEnqueueToast = false), 6000)

        // Refresh after estimated time so button can reappear if still needed
        setTimeout(() => {
          aiHideUntil = null
          articleCache.forceRefresh(data.currentDate)
        }, estimatedMs)
      }
    } catch (e) {
      console.error('Resummarize failed', e)
    } finally {
      resummarizing = false
    }
  }

  // Reactive clock tick — re-evaluates todayStr periodically (see interval in onMount)
  let clockTick = $state(Date.now())

  let todayStr = $derived.by(() => {
    void clockTick
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })

  let isToday = $derived(data.currentDate === todayStr)

  let formattedDate = $derived.by(() => {
    const d = new Date(`${data.currentDate}T00:00:00`)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  })

  function goToDate(offset: number) {
    const current = new Date(`${data.currentDate}T00:00:00`)
    current.setDate(current.getDate() + offset)
    const y = current.getFullYear()
    const m = String(current.getMonth() + 1).padStart(2, '0')
    const d = String(current.getDate()).padStart(2, '0')
    const newDate = `${y}-${m}-${d}`
    const todayNow = new Date()
    const todayFormatted = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, '0')}-${String(todayNow.getDate()).padStart(2, '0')}`
    if (newDate === todayFormatted) {
      goto('/')
    } else {
      goto(`/?date=${newDate}`)
    }
  }

  let filteredArticles = $derived.by(() => {
    let result: Article[] = articles
    if ($filters.sourceId) {
      result = result.filter((a) => a.source_id === $filters.sourceId)
    }
    if ($filters.tag) {
      result = result.filter((a) => {
        try {
          const tags: string[] = a.tags ? JSON.parse(a.tags) : []
          return tags.some(
            (t) => t.toLowerCase() === $filters.tag.toLowerCase(),
          )
        } catch {
          return false
        }
      })
    }
    if ($filters.minHot > 0) {
      result = result.filter((a) => (a.hot_score ?? 0) >= $filters.minHot)
    }
    return result
  })

  // Auto-select first article when filter changes (desktop)
  let prevFilterKey = $state('')
  $effect(() => {
    const filterKey = `${$filters.sourceId}|${$filters.tag}|${$filters.minHot}`
    const prev = untrack(() => prevFilterKey)
    if (filterKey !== prev && prev !== '') {
      untrack(() => {
        if (innerWidth >= 768 && filteredArticles.length > 0) {
          selectedArticle = filteredArticles[0]
        } else if (innerWidth >= 768) {
          selectedArticle = null
        }
      })
    }
    untrack(() => {
      prevFilterKey = filterKey
    })
  })

  let hasActiveFilter = $derived(!!$filters.sourceId || !!$filters.tag)
  let activeFilterLabel = $derived.by(() => {
    const parts: string[] = []
    if ($filters.sourceId) {
      const name = $sources.find((s) => s.id === $filters.sourceId)?.name
      if (name) parts.push(name)
    }
    if ($filters.tag) parts.push(`#${$filters.tag}`)
    return parts.join(' · ')
  })

  function clearFilters() {
    $filters.sourceId = ''
    $filters.tag = ''
  }

  let sideView: 'list' | 'digest' = $state('list')
  let selectedArticle: Article | null = $state(null)

  // State to track scroll preservation
  let lastScrollInfo = $state({ articleId: null as string | null })

  // automatically select the first article when articles load on desktop
  let innerWidth = $state(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  )
  let mobileMode = $derived(innerWidth < 768)

  // Effect to scroll to top when selectedArticle changes (desktop only)
  $effect(() => {
    const article = selectedArticle
    const isMobile = mobileMode
    if (article && !isMobile) {
      const prevId = untrack(() => lastScrollInfo.articleId)
      if (article.id !== prevId) {
        untrack(() => {
          lastScrollInfo = { articleId: article.id }
        })
        tick().then(() => {
          const viewport = document.querySelectorAll(
            '[data-overlayscrollbars-viewport]',
          )[0] as HTMLElement | undefined
          if (viewport) {
            viewport.scrollTo({ top: 0, behavior: 'instant' })
          }
        })
      }
    }
  })

  let currentDatasetId = $state('')

  $effect(() => {
    // Track only loading and currentDate — avoid tracking filteredArticles directly
    // to prevent re-running when article content changes
    const isLoading = loading
    const date = data.currentDate
    if (!isLoading) {
      untrack(() => {
        if (date !== currentDatasetId) {
          currentDatasetId = date
          if (innerWidth >= 768) {
            sideView = 'list'
            if (filteredArticles.length > 0) {
              selectedArticle = filteredArticles[0]
            } else {
              selectedArticle = null
            }
          } else {
            sideView = 'list'
            selectedArticle = null
          }
          // Reset scroll for both aside (VP1) and main (VP0) when date changes (desktop only)
          if (!mobileMode) {
            tick().then(() => {
              const viewports = document.querySelectorAll(
                '[data-overlayscrollbars-viewport]',
              )
              viewports[0]?.scrollTo({ top: 0, behavior: 'instant' })
              viewports[1]?.scrollTo({ top: 0, behavior: 'instant' })
            })
          }
        }
      })
    }
  })

  function selectArticle(a: Article) {
    selectedArticle = a
    if (mobileMode) drawerOpen = true
  }

  function goToPrevArticle() {
    if (!selectedArticle || filteredArticles.length === 0) return
    const idx = filteredArticles.findIndex((a) => a.id === selectedArticle!.id)
    if (idx > 0) {
      selectedArticle = filteredArticles[idx - 1]
    }
  }

  function goToNextArticle() {
    if (!selectedArticle || filteredArticles.length === 0) return
    const idx = filteredArticles.findIndex((a) => a.id === selectedArticle!.id)
    if (idx < filteredArticles.length - 1) {
      selectedArticle = filteredArticles[idx + 1]
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && drawerOpen) {
      e.preventDefault()
      drawerOpen = false
      return
    }
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goToPrevArticle()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goToNextArticle()
    }
  }

  function getSourceName(id: string) {
    return $sources.find((s) => s.id === id)?.name || 'Unknown'
  }

  // Parse digest summary_text: replace <id:uuid> with clickable article anchors
  let parsedDigestHtml = $derived.by(() => {
    if (!digest?.summary_text) return ''
    const processed = digest.summary_text.replace(
      /<id:([a-f0-9-]+)>/gi,
      (_match: string, id: string) => {
        return `<button class="digest-article-ref" data-article-id="${id}">↗</button>`
      },
    )
    return marked.parse(processed) as string
  })

  function handleDigestClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest(
      '.digest-article-ref',
    ) as HTMLElement | null
    if (!target) return
    const articleId = target.dataset.articleId
    if (!articleId) return
    const article = articles.find((a) => a.id === articleId)
    if (article) selectArticle(article)
  }

  $effect(() => {
    if (!mobileMode && drawerOpen) {
      drawerOpen = false
    }
  })
</script>

<svelte:window bind:innerWidth onkeydown={handleKeydown} />

<svelte:head>
  <title>NewsDigest - {formattedDate}</title>
</svelte:head>

<!-- ═══════════════ MOBILE LAYOUT ═══════════════ -->
<div class=" md:hidden">
  <div
    class="fixed top-0 left-2 right-2 h-8 pointer-events-none bg-linear-to-b from-10% from-bg-1 to-bg-1/0 z-40"
  ></div>
  <div class="mobile-layout relative bg-bg-1">
    <!-- Mobile Top Header / Navigator -->
    <nav
      class="flex justify-between px-4 py-8"
      style="opacity: {ptrActive ? 0 : 1}; pointer-events: {ptrActive
        ? 'none'
        : 'auto'}; transition: opacity 0.2s ease;"
    >
      <div class="flex gap-3">
        <CusButton onclick={() => goToDate(-1)} class="size-10">
          <ChevronLeft class="-translate-x-px" size={20} />
        </CusButton>
        <!-- <CusButton class="h-10 w-24 text-sm">{formattedDate}</CusButton> -->
        <CusButton
          onclick={() => !isToday && goToDate(1)}
          class="size-10"
          disabled={isToday}
        >
          <div class="grid place-items-center">
            {#if isToday}
              <div
                class="col-start-1 row-start-1 opacity-50"
                in:slideScaleFade={{
                  duration: 250,
                  startScale: 0.5,
                  startOpacity: 0,
                }}
                out:slideScaleFade={{
                  duration: 200,
                  startScale: 0.5,
                  startOpacity: 0,
                }}
              >
                <ChevronRight class="translate-x-px" size={20} />
              </div>
            {:else}
              <div
                class="col-start-1 row-start-1"
                in:slideScaleFade={{
                  duration: 250,
                  startScale: 0.5,
                  startOpacity: 0,
                }}
                out:slideScaleFade={{
                  duration: 200,
                  startScale: 0.5,
                  startOpacity: 0,
                }}
              >
                <ChevronRight class="translate-x-px" size={20} />
              </div>
            {/if}
          </div>
        </CusButton>
      </div>
      <div class="flex gap-3">
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <CusButton
          onclick={() => ($prefs.fontSize = cycleFontSize($prefs.fontSize))}
          class="size-10"
          title="Đổi cỡ chữ"
        >
          <CaseSensitive size={18} />
        </CusButton>
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <CusButton
          onclick={() => ($prefs.darkMode = !$prefs.darkMode)}
          class="size-10"
        >
          {#if $prefs.darkMode}
            <Sun size={16} />
          {:else}
            <Moon size={16} />
          {/if}
        </CusButton>
      </div>
    </nav>
    <!-- Enqueue toast (mobile) -->
    {#if showEnqueueToast}
      <div
        class="fixed z-50 bottom-24 left-4 right-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg"
        style="background: var(--color-bg-1); border: 1px solid color-mix(in srgb, currentColor 12%, transparent);"
        in:slideScaleFade={{ duration: 250, startScale: 0.92, startOpacity: 0 }}
        out:slideScaleFade={{
          duration: 200,
          startScale: 0.92,
          startOpacity: 0,
        }}
      >
        <Sparkles size={14} class="shrink-0 text-violet-500" />
        <span
          >Đã xếp hàng <strong>{lastEnqueued}</strong> bài · hoàn tất sau {aiEstimateLabel}</span
        >
      </div>
    {/if}
    <div class=" fixed z-40 flex gap-3 bottom-6 right-4">
      {#if isAdmin && unsummarizedCount > 0 && !aiButtonHidden}
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <CusButton
          onclick={handleResummarize}
          disabled={resummarizing}
          class="size-10 px-2 text-xs gap-1"
        >
          {#if resummarizing}
            <Loader2 size={14} class="animate-spin" />
          {:else}
            <Sparkles size={14} />
          {/if}
          <span>{resummarizing ? '...' : `AI (${unsummarizedCount})`}</span>
        </CusButton>
      {/if}
      <!-- svelte-ignore a11y_consider_explicit_label -->
      <CusButton
        onclick={() => {
          sideView = sideView === 'digest' ? 'list' : 'digest'
        }}
        class="size-10"
      >
        <div class="grid place-items-center">
          {#if sideView === 'digest'}
            <div
              class="col-start-1 row-start-1"
              in:slideScaleFade={{
                duration: 250,
                startScale: 0.5,
                startOpacity: 0,
              }}
              out:slideScaleFade={{
                duration: 200,
                startScale: 0.5,
                startOpacity: 0,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                class="size-5"
              >
                <path
                  fill-rule="evenodd"
                  d="M6 4.75A.75.75 0 0 1 6.75 4h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.75ZM6 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 10Zm0 5.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75a.75.75 0 0 1-.75-.75ZM1.99 4.75a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 15.25a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 10a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1V10Z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          {:else}
            <div
              class="col-start-1 row-start-1"
              in:slideScaleFade={{
                duration: 250,
                startScale: 0.5,
                startOpacity: 0,
              }}
              out:slideScaleFade={{
                duration: 200,
                startScale: 0.5,
                startOpacity: 0,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 16 16"
              >
                <path
                  fill="currentColor"
                  d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.5 7.5 0 0 0 4.464 4.464l1.305.478a.5.5 0 0 1 0 .94l-1.305.478a7.5 7.5 0 0 0-4.464 4.464l-.478 1.305a.5.5 0 0 1-.94 0l-.478-1.305a7.5 7.5 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.5 7.5 0 0 0 4.464-4.464Z"
                />
              </svg>
            </div>
          {/if}
        </div>
      </CusButton>

      <SourceFilter {articles} size="md" />
    </div>

    <h2 class="text-2xl mb-8 font-serif text-text-main text-center font-bold">
      {formattedDate}
    </h2>
    <!-- Active filter bar (mobile) -->
    {#if hasActiveFilter}
      <div class="flex text-lg items-center gap-2 px-4 py-2">
        <span class="text-text-main font-bold truncate"
          >{activeFilterLabel}</span
        >
        <span class=" ml-2 text-text-secondary tabular-nums shrink-0"
          >{filteredArticles.length}</span
        >
        <CusButton
          onclick={clearFilters}
          class="ml-auto size-10 sm:size-8  shrink-0"
        >
          <X size={20} />
        </CusButton>
      </div>
    {/if}

    <!-- Mobile Article List / Digest (body scroll) -->
    <PullToRefresh
      onRefresh={() => articleCache.forceRefresh(data.currentDate)}
      onIndicatorChange={(v) => (ptrActive = v)}
      disabled={loading}
    >
      <div class="mobile-content" style="font-size: var(--font-size-base);">
        {#if loading}
          <div class="skeleton-container flex flex-col gap-8 animate-pulse">
            {#each Array(6) as _}
              <div>
                <div class="flex items-center gap-2 mb-2">
                  <div
                    class="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800"
                  ></div>
                  <div
                    class="h-3 w-10 rounded bg-zinc-200 dark:bg-zinc-800"
                  ></div>
                </div>
                <div
                  class="h-5 w-full rounded bg-zinc-200 dark:bg-zinc-800 mb-2"
                ></div>
                <div
                  class="h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800 mb-1"
                ></div>
                <div
                  class="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800"
                ></div>
              </div>
            {/each}
          </div>
        {:else if sideView === 'digest'}
          {#if digest}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="prose prose-sm max-w-none text-text-main-2 prose-headings:text-text-main! prose-p:text-text-main-2! prose-li:text-text-main-2! prose-a:text-text-main-2! prose-strong:text-text-main! prose-headings:text-base prose-headings:mt-6 prose-headings:mb-2 prose-p:leading-relaxed pb-16"
              onclick={handleDigestClick}
            >
              {@html parsedDigestHtml}
            </div>
          {:else}
            <div
              class="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl"
            >
              Chưa có bản tin tổng hợp cho ngày này.
            </div>
          {/if}
        {:else}
          <div class="flex flex-col gap-8 pb-16">
            {#each filteredArticles as article (article.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="cursor-pointer relative group"
                onclick={() => selectArticle(article)}
              >
                <div
                  class="flex items-center text-[0.675em] text-text-secondary uppercase tracking-wider mb-1"
                >
                  <span class="truncate pr-4"
                    >{getSourceName(article.source_id)}</span
                  >
                  <span class="whitespace-nowrap shrink-0">
                    {new Date(
                      article.published_at || article.fetched_at,
                    ).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <h3
                  class="font-serif text-[1.125em] leading-[1.4] mb-2 font-semibold text-text-main group-hover:underline underline-offset-4 transition-all line-clamp-4 wrap-break-word"
                >
                  {@html article.title}
                </h3>
                <p
                  class="text-[1em] text-text-main-2/70 leading-relaxed line-clamp-10 wrap-break-word"
                >
                  {article.description_vn ||
                    article.description ||
                    article.summary
                      ?.replace(/<[^>]*>?/gm, '')
                      .substring(0, 150) ||
                    'Đang xử lý nội dung...'}
                </p>
              </div>
            {/each}

            {#if filteredArticles.length === 0}
              <div
                class="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl"
              >
                Không có bài viết nào trong ngày này.
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </PullToRefresh>
  </div>

  <MobileArticleSheet
    open={drawerOpen}
    {selectedArticle}
    {filteredArticles}
    onPrev={goToPrevArticle}
    onNext={goToNextArticle}
    onClose={() => {
      drawerOpen = false
    }}
  />
</div>

<!-- ═══════════════ DESKTOP LAYOUT ═══════════════ -->
<div class="hidden md:contents">
  <div class="flex mx-auto max-w-340 sm:px-6">
    <aside class="h-svh sticky top-0 border-r w-88 lg:w-108 flex flex-col">
      <!-- Top Header / Navigator -->
      <nav
        class=" absolute z-10 flex justify-between px-6 top-6 left-0 right-0"
      >
        <div class="flex gap-1">
          <CusButton onclick={() => goToDate(-1)} class="size-8">
            <ChevronLeft class="-translate-x-px" size={20} />
          </CusButton>
          <!-- <CusButton class="h-8 w-24 text-sm">{formattedDate}</CusButton> -->
          <CusButton
            onclick={() => !isToday && goToDate(1)}
            class="size-8"
            disabled={isToday}
          >
            <div class="grid place-items-center">
              {#if isToday}
                <div
                  class="col-start-1 row-start-1 opacity-50"
                  in:slideScaleFade={{
                    duration: 250,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                  out:slideScaleFade={{
                    duration: 200,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                >
                  <ChevronRight class="translate-x-px" size={20} />
                </div>
              {:else}
                <div
                  class="col-start-1 row-start-1"
                  in:slideScaleFade={{
                    duration: 250,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                  out:slideScaleFade={{
                    duration: 200,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                >
                  <ChevronRight class="translate-x-px" size={20} />
                </div>
              {/if}
            </div>
          </CusButton>
        </div>
        <div class="flex gap-1">
          <SourceFilter {articles} size="sm" />
          {#if isAdmin && unsummarizedCount > 0 && !aiButtonHidden}
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <CusButton
              onclick={handleResummarize}
              disabled={resummarizing}
              class="h-8 px-2 text-xs gap-1"
            >
              {#if resummarizing}
                <Loader2 size={14} class="animate-spin" />
              {:else}
                <Sparkles size={14} />
              {/if}
              <span>{resummarizing ? '...' : `AI (${unsummarizedCount})`}</span>
            </CusButton>
          {/if}
          <!-- Enqueue toast (desktop) -->
          {#if showEnqueueToast}
            <div
              class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium"
              style="background: color-mix(in srgb, var(--color-bg-1) 80%, transparent); border: 1px solid color-mix(in srgb, currentColor 12%, transparent);"
              in:slideScaleFade={{
                duration: 250,
                startScale: 0.92,
                startOpacity: 0,
              }}
              out:slideScaleFade={{
                duration: 200,
                startScale: 0.92,
                startOpacity: 0,
              }}
            >
              <Sparkles size={12} class="text-violet-500 shrink-0" />
              <span>{lastEnqueued} bài · {aiEstimateLabel}</span>
            </div>
          {/if}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <CusButton
            onclick={() => {
              sideView = sideView === 'digest' ? 'list' : 'digest'
              tick().then(() => {
                const viewports = document.querySelectorAll(
                  '[data-overlayscrollbars-viewport]',
                )
                viewports[1]?.scrollTo({ top: 0, behavior: 'instant' })
              })
            }}
            class="size-8"
          >
            <div class="grid place-items-center">
              {#if sideView === 'digest'}
                <div
                  class="col-start-1 row-start-1"
                  in:slideScaleFade={{
                    duration: 250,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                  out:slideScaleFade={{
                    duration: 200,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                >
                  <!-- List icon -->
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="size-5"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M6 4.75A.75.75 0 0 1 6.75 4h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.75ZM6 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 10Zm0 5.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75a.75.75 0 0 1-.75-.75ZM1.99 4.75a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 15.25a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 10a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1V10Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </div>
              {:else}
                <div
                  class="col-start-1 row-start-1"
                  in:slideScaleFade={{
                    duration: 250,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                  out:slideScaleFade={{
                    duration: 200,
                    startScale: 0.5,
                    startOpacity: 0,
                  }}
                >
                  <!-- Sparkle/Digest icon -->
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fill="currentColor"
                      d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.5 7.5 0 0 0 4.464 4.464l1.305.478a.5.5 0 0 1 0 .94l-1.305.478a7.5 7.5 0 0 0-4.464 4.464l-.478 1.305a.5.5 0 0 1-.94 0l-.478-1.305a7.5 7.5 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.5 7.5 0 0 0 4.464-4.464Z"
                    />
                  </svg>
                </div>
              {/if}
            </div>
          </CusButton>
        </div>
      </nav>
      <div
        class="left-0 z-5 absolute right-2.5 top-0 h-24"
        style="background: linear-gradient(to bottom, var(--color-bg-1) 10%, transparent);"
      ></div>
      <!-- Aside Content: Digest or Article List -->
      <OverlayScrollbarsComponent
        defer
        options={{ scrollbars: { autoHide: 'leave', autoHideDelay: 300 } }}
        class="px-6 py-20"
        style="font-size: var(--font-size-base);"
      >
        <!-- Title -->
        <h2
          class="text-2xl mb-8 font-serif text-text-main text-center font-bold"
        >
          {formattedDate}
        </h2>
        <!-- Active filter bar (desktop) -->
        {#if hasActiveFilter}
          <div class="flex items-center gap-2 mb-8">
            <span class="text-sm text-text-main font-bold truncate"
              >{activeFilterLabel}</span
            >
            <span class="text-xs ml-2 text-text-secondary tabular-nums shrink-0"
              >{filteredArticles.length}</span
            >
            <CusButton onclick={clearFilters} class="size-8 ml-auto shrink-0">
              <X size={16} />
            </CusButton>
          </div>
        {/if}
        {#if loading}
          <!-- Loading skeleton -->
          <div class="skeleton-container flex flex-col gap-8 animate-pulse">
            {#each Array(6) as _}
              <div>
                <div class="flex items-center gap-2 mb-2">
                  <div
                    class="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800"
                  ></div>
                  <div
                    class="h-3 w-10 rounded bg-zinc-200 dark:bg-zinc-800"
                  ></div>
                </div>
                <div
                  class="h-5 w-full rounded bg-zinc-200 dark:bg-zinc-800 mb-2"
                ></div>
                <div
                  class="h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800 mb-1"
                ></div>
                <div
                  class="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800"
                ></div>
              </div>
            {/each}
          </div>
        {:else if sideView === 'digest'}
          {#if digest}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="prose prose-sm max-w-none text-text-main-2 prose-headings:text-text-main! prose-p:text-text-main-2! prose-li:text-text-main-2! prose-a:text-text-main-2! prose-strong:text-text-main! prose-headings:text-base prose-headings:mt-6 prose-headings:mb-2 prose-p:leading-relaxed"
              onclick={handleDigestClick}
            >
              {@html parsedDigestHtml}
            </div>
          {:else}
            <div
              class="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl"
            >
              Chưa có bản tin tổng hợp cho ngày này.
            </div>
          {/if}
        {:else}
          <div class="flex flex-col gap-8">
            {#each filteredArticles as article (article.id)}
              {@const isSelected = selectedArticle?.id === article.id}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="cursor-pointer relative group article-item {isSelected
                  ? 'article-selected'
                  : ''}"
                onclick={() => selectArticle(article)}
              >
                <div
                  class="flex items-center text-[0.675em] text-text-secondary uppercase tracking-wider mb-2"
                >
                  <span class="truncate pr-4"
                    >{getSourceName(article.source_id)}</span
                  >
                  <span class="whitespace-nowrap shrink-0">
                    {new Date(
                      article.published_at || article.fetched_at,
                    ).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <h3
                  class="font-serif text-[1.125em] leading-[1.4] mb-2 font-semibold text-text-main group-hover:underline underline-offset-4 transition-all line-clamp-4 wrap-break-word"
                >
                  {@html article.title}
                </h3>
                <p
                  class="text-[1em] text-text-secondary leading-relaxed line-clamp-10 wrap-break-word"
                >
                  {article.description_vn ||
                    article.description ||
                    article.summary
                      ?.replace(/<[^>]*>?/gm, '')
                      .substring(0, 150) ||
                    'Đang xử lý nội dung...'}
                </p>
              </div>
            {/each}

            {#if filteredArticles.length === 0}
              <div
                class="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl"
              >
                Không có bài viết nào trong ngày này.
              </div>
            {/if}
          </div>
        {/if}
      </OverlayScrollbarsComponent>
    </aside>
    <OverlayScrollbarsComponent
      element="main"
      defer
      options={{ scrollbars: { autoHide: 'leave', autoHideDelay: 300 } }}
      class="flex-1 py-6 md:px-10 xl:px-16"
      style="background-color: var(--color-bg-2);"
    >
      {#if selectedArticle}
        <div class="flex gap-1">
          <CusButton
            onclick={goToPrevArticle}
            disabled={!selectedArticle ||
              filteredArticles.findIndex((a) => a.id === selectedArticle?.id) <=
                0}
            class="size-8"
            ><ChevronLeft class="-translate-x-px" size={20} /></CusButton
          >
          <CusButton
            onclick={goToNextArticle}
            disabled={!selectedArticle ||
              filteredArticles.findIndex((a) => a.id === selectedArticle?.id) >=
                filteredArticles.length - 1}
            class="size-8"
            ><ChevronRight class="translate-x-px" size={20} /></CusButton
          >
          <div class="ml-auto flex gap-1">
            <CusButton
              onclick={() => ($prefs.fontSize = cycleFontSize($prefs.fontSize))}
              class="size-8"
              title="Đổi cỡ chữ"
            >
              <CaseSensitive size={16} />
            </CusButton>
            <CusButton
              onclick={() => ($prefs.darkMode = !$prefs.darkMode)}
              class="size-8"
            >
              {#if $prefs.darkMode}
                <Sun size={16} />
              {:else}
                <Moon size={16} />
              {/if}
            </CusButton>
          </div>
        </div>
        <div
          class="flex flex-col pb-4 pt-8 gap-4"
          style="font-size: var(--font-size-base);"
        >
          <div
            class="flex justify-center gap-4 items-center text-[0.75em] text-text-secondary"
          >
            <p class="flex items-center gap-1.5">
              <Clock size={14} />
              {new Date(
                selectedArticle.published_at || selectedArticle.fetched_at,
              ).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <a
              href={selectedArticle.url}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1.5 hover:underline underline-offset-4"
            >
              <Link2 size={14} />
              {new URL(selectedArticle.url).hostname.replace('www.', '')}
            </a>
          </div>
          <a
            href={selectedArticle.url}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:underline flex justify-center underline-offset-4"
          >
            <h1
              class="font-serif text-[1.25em] text-center text-balance md:text-[1.5em] font-bold leading-[1.2] text-text-main inline"
            >
              {@html selectedArticle.title}
            </h1>
          </a>
        </div>

        <div
          class="prose text-text-main-2 prose-headings:text-text-main! prose-p:text-text-main-2! prose-li:text-text-main-2! prose-a:text-text-main-2! prose-strong:text-text-main-2! prose-blockquote:text-text-main-2! prose-code:text-text-main-2! dark:prose-invert max-w-none prose-base prose-headings:mt-8 prose-h2:text-xl prose-h3:text-lg prose-h4:text-lg prose-headings:mb-4 prose-p:leading-relaxed prose-li:leading-relaxed"
        >
          {#if selectedArticle.summary}
            {@html marked.parse(selectedArticle.summary)}
          {:else}
            <p class="text-zinc-500 italic">Nội dung đang được xử lý...</p>
          {/if}
        </div>
      {:else}
        <div class="h-full flex items-center justify-center text-zinc-500">
          {#if loading}
            <Loader2 size={24} class="animate-spin" />
          {:else}
            <p>Chọn một bài viết để đọc</p>
          {/if}
        </div>
      {/if}
    </OverlayScrollbarsComponent>
  </div>
</div>
