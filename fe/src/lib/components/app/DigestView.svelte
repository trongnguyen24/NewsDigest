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

  $effect(() => {
    if (browser) {
      adminKey = getStoredAdminKey()
    }
  })

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
    const toastId = toast.loading('Regenerating digest...')
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

      toast.success('Digest regenerated successfully!', { id: toastId })
      
      // Force refresh the articles/digest cache to show the updated digest immediately
      await articleCache.forceRefresh(date)
    } catch (err: any) {
      console.error(err)
      toast.error(`Error: ${err.message || 'Failed to regenerate digest'}`, { id: toastId })
    } finally {
      regenerating = false
    }
  }
</script>

{#if digest}
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
{:else}
  <div
    class="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl"
  >
    Chưa có bản tin tổng hợp cho ngày này.
  </div>
{/if}
