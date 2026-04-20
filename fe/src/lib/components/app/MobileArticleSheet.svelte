<script lang="ts">
  import { marked } from 'marked'
  import { ChevronLeft, ChevronRight, Clock, Link2, X } from 'lucide-svelte'
  import type { Article } from '$lib/types'
  import CusButton from '$lib/components/ui/CusButton.svelte'

  let {
    open = false,
    selectedArticle = null,
    filteredArticles = [],
    onPrev,
    onNext,
    onClose,
  }: {
    open?: boolean
    selectedArticle?: Article | null
    filteredArticles?: Article[]
    onPrev?: () => void
    onNext?: () => void
    onClose?: () => void
  } = $props()

  let drawerContainer = $state<HTMLDivElement | null>(null)
  let drawerBackdrop = $state<HTMLButtonElement | null>(null)
  let drawerPanel = $state<HTMLDivElement | null>(null)
  let drawerBody = $state<HTMLDivElement | null>(null)

  let isDragging = $state(false)
  let startY = $state(0)
  let currentTranslateY = $state(0)
  let dragStartTime = $state(0)
  let previousTranslateY = $state(0)
  let previousMoveTime = $state(0)
  let instantVelocity = $state(0)
  let animationFrameId = $state<number | null>(null)
  let pendingBodyDrag = $state(false)
  let bodyStartY = $state(0)
  const touchMoveOptions: AddEventListenerOptions = { passive: false }
  const velocityCloseThreshold = 0.7 // px/ms
  let originalBodyOverflow = $state<string | null>(null)
  let originalBodyOverscrollBehavior = $state<string | null>(null)
  let originalHtmlOverflow = $state<string | null>(null)
  let originalHtmlOverscrollBehavior = $state<string | null>(null)

  let currentIndex = $derived.by(() => {
    if (!selectedArticle) return -1
    return filteredArticles.findIndex((a) => a.id === selectedArticle.id)
  })

  let canGoPrev = $derived(currentIndex > 0)
  let canGoNext = $derived(
    currentIndex >= 0 && currentIndex < filteredArticles.length - 1,
  )

  function syncOpenStyles() {
    if (!drawerContainer || !drawerBackdrop || !drawerPanel) return
    drawerContainer.classList.remove('pointer-events-none')
    drawerBackdrop.classList.remove('pointer-events-none')
    drawerPanel.classList.remove('pointer-events-none')

    requestAnimationFrame(() => {
      if (!drawerBackdrop || !drawerPanel) return
      drawerBackdrop.style.opacity = '1'
      drawerPanel.style.transform = 'translateY(0)'
    })
  }

  function syncCloseStyles() {
    if (!drawerContainer || !drawerBackdrop || !drawerPanel) return
    drawerContainer.classList.add('pointer-events-none')
    drawerBackdrop.classList.add('pointer-events-none')
    drawerPanel.classList.add('pointer-events-none')
    drawerBackdrop.style.opacity = '0'
    drawerPanel.style.transform = 'translateY(100%)'
  }

  function requestClose() {
    syncCloseStyles()
    onClose?.()
  }

  function lockPageScroll() {
    if (typeof document === 'undefined') return
    const body = document.body
    const html = document.documentElement

    if (originalBodyOverflow === null) {
      originalBodyOverflow = body.style.overflow
      originalBodyOverscrollBehavior = body.style.overscrollBehavior
      originalHtmlOverflow = html.style.overflow
      originalHtmlOverscrollBehavior = html.style.overscrollBehavior
    }

    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
  }

  function unlockPageScroll() {
    if (typeof document === 'undefined') return
    const body = document.body
    const html = document.documentElement

    html.style.overflow = originalHtmlOverflow ?? ''
    html.style.overscrollBehavior = originalHtmlOverscrollBehavior ?? ''
    body.style.overflow = originalBodyOverflow ?? ''
    body.style.overscrollBehavior = originalBodyOverscrollBehavior ?? ''

    originalHtmlOverflow = null
    originalHtmlOverscrollBehavior = null
    originalBodyOverflow = null
    originalBodyOverscrollBehavior = null
  }

  function getPageY(e: MouseEvent | TouchEvent) {
    if ('touches' in e) return e.touches[0]?.pageY ?? 0
    return e.pageY
  }

  function removeDragListeners() {
    document.removeEventListener('mousemove', onDragging)
    document.removeEventListener('mouseup', onDragEnd)
    document.removeEventListener('touchmove', onDragging, touchMoveOptions)
    document.removeEventListener('touchend', onDragEnd)
    document.removeEventListener('touchcancel', onDragEnd)
  }

  function onDragStart(e: MouseEvent | TouchEvent) {
    if (!drawerPanel || !drawerBackdrop || !open) return

    isDragging = true
    pendingBodyDrag = false
    startY = getPageY(e)
    dragStartTime = performance.now()
    previousTranslateY = 0
    previousMoveTime = dragStartTime
    instantVelocity = 0
    currentTranslateY = 0
    drawerPanel.style.transition = 'none'
    drawerBackdrop.style.transition = 'none'

    document.addEventListener('mousemove', onDragging)
    document.addEventListener('mouseup', onDragEnd)
    document.addEventListener('touchmove', onDragging, touchMoveOptions)
    document.addEventListener('touchend', onDragEnd)
    document.addEventListener('touchcancel', onDragEnd)
  }

  function onDragging(e: MouseEvent | TouchEvent) {
    if (!isDragging || !drawerPanel || !drawerBackdrop) return
    if (e.cancelable) e.preventDefault()

    const currentY = getPageY(e)
    const deltaY = Math.max(0, currentY - startY)
    const now = performance.now()
    const dt = Math.max(1, now - previousMoveTime)
    instantVelocity = Math.max(0, deltaY - previousTranslateY) / dt
    currentTranslateY = deltaY
    previousTranslateY = deltaY
    previousMoveTime = now

    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(() => {
        if (!drawerPanel || !drawerBackdrop) return
        drawerPanel.style.transform = `translateY(${currentTranslateY}px)`
        const panelHeight = drawerPanel.offsetHeight || 1
        const opacity = 1 - (currentTranslateY / panelHeight) * 0.8
        drawerBackdrop.style.opacity = String(Math.max(0, opacity))
        animationFrameId = null
      })
    }
  }

  function onDragEnd() {
    if (!isDragging || !drawerPanel || !drawerBackdrop) return

    isDragging = false
    pendingBodyDrag = false
    removeDragListeners()

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    drawerPanel.style.transition = ''
    drawerBackdrop.style.transition = ''

    const panelHeight = drawerPanel.offsetHeight || 1
    const distanceThreshold = panelHeight / 4
    const nowEnd = performance.now()
    const elapsed = Math.max(1, nowEnd - dragStartTime)
    const avgVelocity = currentTranslateY / elapsed
    const shouldCloseByVelocity =
      avgVelocity >= velocityCloseThreshold ||
      instantVelocity >= velocityCloseThreshold

    if (currentTranslateY > distanceThreshold || shouldCloseByVelocity) {
      requestClose()
      return
    }

    drawerBackdrop.style.opacity = '1'
    drawerPanel.style.transform = 'translateY(0)'
  }

  function onBodyTouchStart(e: TouchEvent) {
    if (!open || !drawerBody) return
    pendingBodyDrag = drawerBody.scrollTop <= 0
    bodyStartY = getPageY(e)
  }

  function onBodyTouchMove(e: TouchEvent) {
    if (!drawerBody || !pendingBodyDrag) return

    if (isDragging) {
      onDragging(e)
      return
    }

    const deltaY = getPageY(e) - bodyStartY
    if (deltaY > 6 && drawerBody.scrollTop <= 0) {
      onDragStart(e)
      onDragging(e)
      return
    }

    if (deltaY < -6) {
      pendingBodyDrag = false
    }
  }

  function onBodyTouchEnd() {
    if (!isDragging) pendingBodyDrag = false
  }

  // Scroll to top when article changes
  $effect(() => {
    if (selectedArticle && drawerBody) {
      drawerBody.scrollTop = 0
    }
  })

  $effect(() => {
    if (open) {
      syncOpenStyles()
      lockPageScroll()
    } else {
      syncCloseStyles()
      unlockPageScroll()
    }
  })

  $effect(() => {
    return () => {
      removeDragListeners()
      unlockPageScroll()
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  })
</script>

<div
  bind:this={drawerContainer}
  class="fixed inset-0 z-50 pointer-events-none"
  aria-hidden={!open}
>
  <button
    type="button"
    bind:this={drawerBackdrop}
    id="news-mobile-sheet-backdrop"
    class="absolute inset-0 opacity-0 pointer-events-none"
    aria-label="Đóng khung chi tiết bài viết"
    onclick={requestClose}
  ></button>

  <div
    bind:this={drawerPanel}
    id="news-mobile-sheet-panel"
    role="dialog"
    aria-modal="true"
    aria-label="Chi tiết bài viết"
    class="fixed inset-x-0 bottom-0 h-svh rounded-t-4xl border border-b-0 border-border bg-bg-2 shadow-2xl pointer-events-none flex flex-col"
    style="transform: translateY(100%);"
  >
    <div
      role="presentation"
      class="px-4 pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none select-none"
      onmousedown={onDragStart}
      ontouchstart={onDragStart}
    >
      <div class="mx-auto h-1.5 w-12 rounded-full bg-text-secondary/30"></div>
    </div>

    {#if selectedArticle}
      <div
        bind:this={drawerBody}
        role="presentation"
        class="drawer-body custom-scrollbar"
        style="font-size: var(--font-size-base);"
        ontouchstart={onBodyTouchStart}
        ontouchmove={onBodyTouchMove}
        ontouchend={onBodyTouchEnd}
        ontouchcancel={onBodyTouchEnd}
      >
        <div
          class="fixed top-6 left-2 right-2 h-7 pointer-events-none bg-linear-to-b from-10% from-bg-2 to-bg-2/0"
        ></div>
        <div
          class="flex justify-center gap-4 items-center text-[0.75em] text-text-secondary mb-4"
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
            class="font-serif text-[1.25em] text-center font-bold leading-[1.2] text-text-main mb-4 inline"
          >
            {@html selectedArticle.title}
          </h1>
        </a>
        <div
          class="prose prose-sm text-text-main-2 prose-headings:text-text-main! prose-p:text-text-main-2! prose-li:text-text-main-2! prose-a:text-text-main-2! prose-strong:text-text-main-2! prose-blockquote:text-text-main-2! dark:prose-invert max-w-none prose-headings:mt-6 prose-h2:text-lg prose-h3:text-base prose-headings:mb-3 prose-p:leading-relaxed prose-li:leading-relaxed"
        >
          {#if selectedArticle.summary}
            {@html marked.parse(selectedArticle.summary)}
          {:else}
            <p class="text-zinc-500 italic">Nội dung đang được xử lý...</p>
          {/if}
        </div>
      </div>

      <div
        class="fixed bottom-0 left-0 right-0 pb-8 pt-4 px-8 bg-linear-to-t from-10% from-bg-2 to-bg-2/0"
      >
        <div class="flex gap-2">
          <CusButton onclick={onPrev} disabled={!canGoPrev} class="h-12 flex-1">
            <ChevronLeft class="-translate-x-px" size={20} />
          </CusButton>
          <CusButton onclick={requestClose} class="h-12 flex-1 px-3 text-xs">
            {currentIndex + 1} / {filteredArticles.length}
          </CusButton>
          <CusButton onclick={onNext} disabled={!canGoNext} class="h-12 flex-1">
            <ChevronRight class="translate-x-px" size={20} />
          </CusButton>
        </div>
        <!-- <div class="flex gap-1">
          <CusButton onclick={requestClose} class="size-8">
            <X size={16} />
          </CusButton>
        </div> -->
      </div>
    {/if}
  </div>
</div>
