<script lang="ts">
  import { goto } from '$app/navigation'
  import { filters } from '$lib/stores/articles'
  import { ChevronLeft, ChevronRight, Settings } from 'lucide-svelte'
  import type { Article } from '$lib/types'
  import { sources } from '$lib/stores/sources'
  import { marked } from 'marked'
  import { OverlayScrollbarsComponent } from 'overlayscrollbars-svelte'

  let { data } = $props()

  let todayStr = $derived.by(() => {
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
      goto('/', { invalidateAll: true })
    } else {
      goto(`/?date=${newDate}`, { invalidateAll: true })
    }
  }

  let filteredArticles = $derived.by(() => {
    let result: Article[] = data.articles || []
    // Keep it simple for now, can apply existing filters logic if needed
    // The design is minimalistic so we don't display tag chips, but we'll apply them if they exist in state.
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

  let viewMode: 'article' | 'digest' | 'list' = $state('list')
  let selectedArticle: Article | null = $state(null)

  // automatically select the first article when articles load on desktop
  let innerWidth = $state(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  )

  let currentDatasetId = $state('')

  $effect(() => {
    // Whenever the date changes, pick an initial selection for desktop
    if (data.currentDate !== currentDatasetId) {
      currentDatasetId = data.currentDate
      if (innerWidth >= 768) {
        if (data.digest) {
          viewMode = 'digest'
          selectedArticle = null
        } else if (filteredArticles.length > 0) {
          selectedArticle = filteredArticles[0]
          viewMode = 'article'
        } else {
          viewMode = 'list'
          selectedArticle = null
        }
      } else {
        viewMode = 'list'
        selectedArticle = null
      }
    }
  })

  function selectArticle(a: Article) {
    selectedArticle = a
    viewMode = 'article'
  }

  function getSourceName(id: string) {
    return $sources.find((s) => s.id === id)?.name || 'Unknown'
  }
</script>

<svelte:window bind:innerWidth />

<svelte:head>
  <title>NewsDigest - {formattedDate}</title>
</svelte:head>

<div class="flex mx-auto max-w-7xl">
  <aside class="h-svh relative top-0 border-r w-108 flex flex-col">
    <!-- Top Header / Navigator -->
    <nav class=" absolute z-10 flex justify-between px-6 top-6 left-0 right-0">
      <div class="flex gap-1">
        <button onclick={() => goToDate(-1)} class="cus-button size-8">
          <ChevronLeft size={20} />
        </button>
        <div class="cus-button h-8 w-24 text-sm">{formattedDate}</div>
        <button
          onclick={() => goToDate(1)}
          class="cus-button size-8"
          disabled={isToday}
          ><ChevronRight size={20} />
        </button>
      </div>
      <button class="cus-button h-8 w-24 text-sm">Summary</button>
    </nav>
    <div
      class="left-0 z-5 absolute right-1.5 top-0 h-16 bg-linear-to-b from-[#F8F7F2] from-10% to-[#F8F7F2]/0"
    ></div>
    <!-- Article List -->
    <OverlayScrollbarsComponent
      defer
      options={{ scrollbars: { autoHide: 'leave', autoHideDelay: 300 } }}
      class="px-6 py-24"
    >
      <div class=" flex flex-col gap-8">
        {#each filteredArticles as article (article.id)}
          {@const isSelected =
            selectedArticle?.id === article.id && viewMode === 'article'}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cursor-pointer group transition-all duration-300 py-1"
            onclick={() => selectArticle(article)}
          >
            <div
              class="flex justify-between items-center text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2"
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
                {new Date(
                  article.published_at || article.fetched_at,
                ).toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
            </div>
            <h3
              class="font-serif text-[1.25rem] leading-[1.3] mb-2 font-bold text-zinc-800 dark:text-zinc-200 group-hover:underline underline-offset-4 decoration-zinc-800/30 dark:decoration-zinc-200/30 transition-all"
            >
              {article.title}
            </h3>
            <p
              class="text-[0.9rem] text-zinc-600 dark:text-zinc-400 line-clamp-3 leading-relaxed"
            >
              {article.description_vn ||
                article.description ||
                article.summary?.replace(/<[^>]*>?/gm, '').substring(0, 150) ||
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
    </OverlayScrollbarsComponent>
  </aside>
  <OverlayScrollbarsComponent
    element="main"
    defer
    options={{ scrollbars: { autoHide: 'leave', autoHideDelay: 300 } }}
    class="flex-1 p-8"
  >
    {#if selectedArticle}
      <h1
        class="font-serif text-3xl md:text-4xl font-bold mb-8 leading-[1.2] text-zinc-900 dark:text-zinc-50"
      >
        {selectedArticle.title}
      </h1>

      <div
        class="prose prose-zinc dark:prose-invert max-w-none prose-base prose-headings:font-serif prose-headings:mt-8 prose-headings:mb-4 prose-p:leading-relaxed prose-li:leading-relaxed"
      >
        {#if selectedArticle.summary}
          {@html marked.parse(selectedArticle.summary)}
        {:else if selectedArticle.content}
          {@html marked.parse(selectedArticle.content)}
        {:else}
          <p class="text-zinc-500 italic">Nội dung đang được xử lý...</p>
        {/if}
      </div>

      <div
        class="mt-16 pt-8 border-t border-zinc-100 dark:border-zinc-800 pb-8"
      >
        <a
          href={selectedArticle.url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline px-6 py-3 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          Đọc bài gốc tại {getSourceName(selectedArticle.source_id)} ↗
        </a>
      </div>
    {:else}
      <div class="h-full flex items-center justify-center text-zinc-500">
        <p>Chọn một bài viết để đọc</p>
      </div>
    {/if}
  </OverlayScrollbarsComponent>
</div>
