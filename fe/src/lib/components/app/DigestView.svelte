<script lang="ts">
  import { browser } from '$app/environment'
  import { getStoredAdminKey } from '$lib/admin'
  import { api } from '$lib/api'
  import { articleCache } from '$lib/stores/articleCache.svelte'
  import { toast } from 'svelte-sonner'
  import { RefreshCw } from 'lucide-svelte'
  import CusButton from '$lib/components/ui/CusButton.svelte'
  import type { Digest } from '$lib/types'

  let {
    digest = null,
    parsedHtml = '',
    onArticleClick,
    class: className = '',
  }: {
    digest?: Digest | null
    parsedHtml?: string
    onArticleClick?: (e: MouseEvent) => void
    class?: string
  } = $props()

  let adminKey = $state('')
  let regenerating = $state(false)
  let pollInterval: any = null
  let initialTimeout: any = null
  let pollCount = $state(0)
  let hasTimeout = $state(false)
  let isWaitingInitial = $state(false)

  $effect(() => {
    if (browser) {
      adminKey = getStoredAdminKey()
    }
  })

  $effect(() => {
    const targetDate = digest?.digest_date
    if (digest?.summary_text === 'GENERATING' && targetDate) {
      if (!pollInterval && !initialTimeout) {
        // Reset states
        pollCount = 0
        hasTimeout = false
        isWaitingInitial = true

        // Initial delay of 1 minute (60 seconds)
        initialTimeout = setTimeout(() => {
          isWaitingInitial = false
          // Start the 10s interval
          pollInterval = setInterval(async () => {
            if (pollCount >= 24) {
              // 24 attempts at 10s = 4 minutes (total 5 minutes from start)
              clearInterval(pollInterval)
              pollInterval = null
              hasTimeout = true
              return
            }
            pollCount++
            await articleCache.forceRefresh(targetDate)
          }, 10000)
        }, 60000)
      }
    } else {
      // Clear timers and reset state on completion/exit
      if (initialTimeout) {
        clearTimeout(initialTimeout)
        initialTimeout = null
      }
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
      pollCount = 0
      hasTimeout = false
      isWaitingInitial = false
    }

    return () => {
      if (initialTimeout) {
        clearTimeout(initialTimeout)
        initialTimeout = null
      }
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    }
  })

  async function handleManualRetry() {
    const date = digest?.digest_date || articleCache.currentDate
    if (!date) return
    hasTimeout = false
    pollCount = 0
    isWaitingInitial = false
    await articleCache.forceRefresh(date)
  }

  async function handleRegenerate() {
    const date = digest?.digest_date || articleCache.currentDate
    if (regenerating || !date) return
    const key = getStoredAdminKey()
    if (!key) {
      toast.error('Admin key not found.')
      return
    }

    // Invalidate local cache in background right away
    // (so if they close the tab or switch page, next visit is guaranteed to fetch new data)
    await articleCache.invalidateCache(date)

    regenerating = true
    try {
      const response = await fetch(api('/api/digest/generate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': key
        },
        body: JSON.stringify({ date })
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || 'Request failed')
      }

      toast.success('Digest regenerated successfully!')
      
      // Force refresh the articles/digest cache to show the updated digest immediately
      await articleCache.forceRefresh(date)
    } catch (err: any) {
      console.error(err)
      toast.error(`Error: ${err.message || 'Failed to regenerate digest'}`)
    } finally {
      regenerating = false
    }
  }
</script>

{#if digest}
  {#if digest.summary_text === 'GENERATING'}
    {#if hasTimeout}
      <div class="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div class="text-sm text-amber-500 font-semibold flex items-center gap-2 justify-center">
          <span>⚠️</span> Regeneration Timed Out
        </div>
        <p class="text-xs text-text-secondary max-w-xs leading-relaxed">
          Regenerating took longer than 5 minutes. The server may be busy or failed to complete.
        </p>
        <CusButton
          class="h-9 px-4 text-xs font-semibold text-text-main mt-2"
          onclick={handleManualRetry}
        >
          <span class="flex items-center gap-1.5">
            <RefreshCw size={12} />
            <span>Try Refreshing</span>
          </span>
        </CusButton>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center py-16 gap-3 text-sm text-text-secondary text-center max-w-xs mx-auto">
        <RefreshCw size={24} class="animate-spin text-text-main" />
        <span>AI is generating the digest. Please wait...</span>
      </div>
    {/if}
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="prose prose-sm max-w-none text-text-main-2 prose-headings:text-text-main! prose-p:text-text-main-2! prose-li:text-text-main-2! prose-a:text-text-main-2! prose-strong:text-text-main! prose-headings:text-base prose-headings:mt-6 prose-headings:mb-2 prose-p:leading-relaxed {className}"
      onclick={onArticleClick}
    >
      {@html parsedHtml}
    </div>

    {#if adminKey}
      <div class="mt-8 pt-6 border-t border-dashed border-zinc-200 dark:border-zinc-800 flex justify-center">
        <CusButton
          class="h-10 px-6 text-sm font-semibold text-text-main"
          onclick={handleRegenerate}
          disabled={regenerating}
        >
          <span class="flex items-center gap-2">
            <RefreshCw size={15} class={regenerating ? 'animate-spin' : ''} />
            <span>{regenerating ? 'Regenerating...' : 'Regenerate Digest'}</span>
          </span>
        </CusButton>
      </div>
    {/if}
  {/if}
{:else}
  <div
    class="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl"
  >
    Chưa có bản tin tổng hợp cho ngày này.
  </div>
{/if}
