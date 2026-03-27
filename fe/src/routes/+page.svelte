<script lang="ts">
  import { goto } from '$app/navigation'
  import { filters } from '$lib/stores/articles'
  import {
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Settings,
    Sparkles,
  } from 'lucide-svelte'
  import type { Article } from '$lib/types'
  import { sources } from '$lib/stores/sources'
  import { marked } from 'marked'
  import { OverlayScrollbarsComponent } from 'overlayscrollbars-svelte'
  import { slideScaleFade } from '$lib/transitions/slideScaleFade'
  import CusButton from '$lib/components/ui/CusButton.svelte'

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

  let sideView: 'list' | 'digest' = $state('list')
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
          sideView = 'digest'
          selectedArticle = null
        } else if (filteredArticles.length > 0) {
          sideView = 'list'
          selectedArticle = filteredArticles[0]
        } else {
          sideView = 'list'
          selectedArticle = null
        }
      } else {
        sideView = 'list'
        selectedArticle = null
      }
    }
  })

  function selectArticle(a: Article) {
    selectedArticle = a
  }

  function getSourceName(id: string) {
    return $sources.find((s) => s.id === id)?.name || 'Unknown'
  }

  // Parse digest summary_text: replace <id:uuid> with clickable article anchors
  let parsedDigestHtml = $derived.by(() => {
    if (!data.digest?.summary_text) return ''
    // Replace <id:uuid> in raw markdown BEFORE marked parses it
    const processed = data.digest.summary_text.replace(/<id:([a-f0-9-]+)>/gi, (_match, id) => {
      const article = (data.articles || []).find((a: Article) => a.id === id)
      const title = article?.title || 'Bài viết'
      return `<button class="digest-article-ref" data-article-id="${id}">↗</button>`
    })
    return marked.parse(processed) as string
  })

  function handleDigestClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('.digest-article-ref') as HTMLElement | null
    if (!target) return
    const articleId = target.dataset.articleId
    if (!articleId) return
    const article = (data.articles || []).find((a) => a.id === articleId)
    if (article) selectArticle(article)
  }
</script>

<svelte:window bind:innerWidth />

<svelte:head>
  <title>NewsDigest - {formattedDate}</title>
</svelte:head>

<div class="flex mx-auto max-w-7xl">
  <aside class="h-svh sticky top-0 border-r w-108 flex flex-col">
    <!-- Top Header / Navigator -->
    <nav class=" absolute z-10 flex justify-between px-6 top-6 left-0 right-0">
      <div class="flex gap-1">
        <CusButton onclick={() => goToDate(-1)} class="size-8">
          <ChevronLeft size={20} />
        </CusButton>
        <CusButton class="h-8 w-24 text-sm">{formattedDate}</CusButton>
        <CusButton onclick={() => goToDate(1)} class="size-8" disabled={isToday}
          ><ChevronRight size={20} />
        </CusButton>
      </div>
      <!-- svelte-ignore a11y_consider_explicit_label -->
      <CusButton
        onclick={() => {
          sideView = sideView === 'digest' ? 'list' : 'digest'
        }}
        class="size-8"
      >
        <div class="grid place-items-center">
          {#if sideView === 'digest'}
            <div
              class="col-start-1 row-start-1"
              in:slideScaleFade={{ duration: 250, startScale: 0.5, startOpacity: 0 }}
              out:slideScaleFade={{ duration: 200, startScale: 0.5, startOpacity: 0 }}
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
              in:slideScaleFade={{ duration: 250, startScale: 0.5, startOpacity: 0 }}
              out:slideScaleFade={{ duration: 200, startScale: 0.5, startOpacity: 0 }}
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
    </nav>
    <div
      class="left-0 z-5 absolute right-2.5 top-0 h-24 bg-linear-to-b from-[#F5F4EC] from-10% to-[#F5F4EC]/0"
    ></div>
    <!-- Aside Content: Digest or Article List -->
    <OverlayScrollbarsComponent
      defer
      options={{ scrollbars: { autoHide: 'leave', autoHideDelay: 300 } }}
      class="px-6 py-24"
    >
      {#if sideView === 'digest'}
        {#if data.digest}
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
                class="flex items-center text-[0.625rem] text-text-secondary uppercase tracking-wider mb-2"
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
                class="font-serif text-[1rem] leading-[1.4] mb-2 font-semibold text-text-main group-hover:underline underline-offset-4 transition-all"
              >
                {@html article.title}
              </h3>
              <p class="text-sm text-text-secondary leading-relaxed">
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
      {/if}
    </OverlayScrollbarsComponent>
  </aside>
  <OverlayScrollbarsComponent
    element="main"
    defer
    options={{ scrollbars: { autoHide: 'leave', autoHideDelay: 300 } }}
    class="flex-1 py-6 px-16 bg-[#FAF9F6]"
  >
    {#if selectedArticle}
      <div class="flex gap-1">
        <CusButton class="size-8"><ChevronLeft size={20} /></CusButton>
        <CusButton class="size-8"><ChevronRight size={20} /></CusButton>
        <div class="ml-auto flex gap-1">
          <CusButton
            href={selectedArticle.url}
            target="_blank"
            rel="noopener noreferrer"
            class="size-8"
          >
            <ExternalLink size={16} /></CusButton
          >
        </div>
      </div>
      <h1
        class="font-serif text-xl text-center text-balance md:text-2xl font-bold my-8 leading-[1.2] text-text-main"
      >
        {@html selectedArticle.title}
      </h1>

      <div
        class="prose text-text-main-2 prose-headings:text-text-main! prose-p:text-text-main-2! prose-li:text-text-main-2! prose-a:text-text-main-2! prose-strong:text-text-main-2! prose-blockquote:text-text-main-2! prose-code:text-text-main-2! dark:prose-invert max-w-none prose-base prose-headings:mt-8 prose-h2:text-xl prose-h3:text-lg prose-h4:text-lg prose-headings:mb-4 prose-p:leading-relaxed prose-li:leading-relaxed"
      >
        {#if selectedArticle.summary}
          {@html marked.parse(selectedArticle.summary)}
        {:else if selectedArticle.content}
          {@html marked.parse(selectedArticle.content)}
        {:else}
          <p class="text-zinc-500 italic">Nội dung đang được xử lý...</p>
        {/if}
      </div>
    {:else}
      <div class="h-full flex items-center justify-center text-zinc-500">
        <p>Chọn một bài viết để đọc</p>
      </div>
    {/if}
  </OverlayScrollbarsComponent>
</div>
