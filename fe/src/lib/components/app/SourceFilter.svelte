<script lang="ts">
  import { Popover } from 'bits-ui'
  import { filters } from '$lib/stores/articles'
  import { sources } from '$lib/stores/sources'
  import { Filter, Check, X } from 'lucide-svelte'
  import type { Article } from '$lib/types'
  import CusButton from '$lib/components/ui/CusButton.svelte'

  type Props = {
    articles: Article[]
    class?: string
    /** Size variant for the trigger button */
    size?: 'sm' | 'md'
  }

  let { articles, class: className = '', size = 'md' }: Props = $props()

  let open = $state(false)

  // Derive unique source IDs present in current articles
  let activeSourceIds = $derived.by(() => {
    const ids = new Set<string>()
    for (const a of articles) {
      ids.add(a.source_id)
    }
    return ids
  })

  // Sources that have articles in current day's data, sorted by name
  let availableSources = $derived.by(() => {
    return $sources
      .filter((s) => activeSourceIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  // Derive unique tags from current articles
  let availableTags = $derived.by(() => {
    const tagCount = new Map<string, number>()
    for (const a of articles) {
      if (!a.tags) continue
      try {
        const tags: string[] = JSON.parse(a.tags)
        for (const t of tags) {
          const lower = t.toLowerCase()
          tagCount.set(lower, (tagCount.get(lower) || 0) + 1)
        }
      } catch {
        /* ignore */
      }
    }
    // Sort by count descending, take top 20
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }))
  })

  // Check if any filter is active
  let hasActiveFilter = $derived(!!$filters.sourceId || !!$filters.tag)

  function selectSource(sourceId: string) {
    if ($filters.sourceId === sourceId) {
      $filters.sourceId = ''
    } else {
      $filters.sourceId = sourceId
    }
    open = false
  }

  function selectTag(tag: string) {
    if ($filters.tag.toLowerCase() === tag.toLowerCase()) {
      $filters.tag = ''
    } else {
      $filters.tag = tag
    }
    open = false
  }

  function clearAll() {
    $filters.sourceId = ''
    $filters.tag = ''
    open = false
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <CusButton
        {...props}
        class="{size === 'sm' ? 'size-8' : 'size-10'} {className}"
      >
        <div class="relative">
          <Filter size={size === 'sm' ? 14 : 16} />
          {#if hasActiveFilter}
            <span
              class="absolute -top-1 -right-1 size-2 rounded-full bg-blue-500 dark:bg-blue-400"
            ></span>
          {/if}
        </div>
      </CusButton>
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
  <Popover.Content
    align="end"
    sideOffset={8}
    class="z-50 w-72 p-0 max-h-[70vh] flex flex-col rounded-3xl border border-white bg-bg-btn dark:border-white/10 dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
  >
    <!-- Header -->
    <!-- <div class="flex items-center justify-between px-4 pt-3 pb-2">
      <span
        class="text-xs font-semibold uppercase tracking-wider text-text-secondary"
        >Bộ lọc</span
      >
      {#if hasActiveFilter}
        <button
          class="text-[0.625rem] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
          onclick={clearAll}
        >
          <X size={10} />
          Xoá bộ lọc
        </button>
      {/if}
    </div> -->

    <div class="overflow-y-auto flex flex-col p-1">
      <!-- Sources Section -->
      {#if availableSources.length > 0}
        <div>
          <div class="flex flex-col gap-1">
            {#each availableSources as source (source.id)}
              {@const isSelected = $filters.sourceId === source.id}
              {@const articleCount = articles.filter(
                (a) => a.source_id === source.id,
              ).length}
              <button
                class="flex items-center gap-2 w-full px-4 py-2.5 rounded-full text-left text-sm transition-colors cursor-pointer
                  {isSelected
                  ? ' bg-black/10 text-text-main dark:bg-white/10 '
                  : 'hover:bg-black/5 dark:hover:bg-white/5 text-text-main'}"
                onclick={() => selectSource(source.id)}
              >
                <span class="flex-1 truncate text-sm">{source.name}</span>
                <span
                  class="text-[0.625rem] text-text-secondary tabular-nums shrink-0"
                  >{articleCount}</span
                >
                <!-- {#if isSelected}
                  <Check
                    size={12}
                    class="text-blue-600 dark:text-blue-400 shrink-0"
                  />
                {/if} -->
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Separator -->
      <!-- {#if availableSources.length > 0 && availableTags.length > 0}
        <div class="h-px bg-border"></div>
      {/if} -->

      <!-- Tags Section -->
      <!-- {#if availableTags.length > 0}
        <div>
          <div class="flex flex-wrap gap-1.5">
            {#each availableTags as { tag, count } (tag)}
              {@const isSelected =
                $filters.tag.toLowerCase() === tag.toLowerCase()}
              <button
                class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[0.625rem] font-medium transition-colors cursor-pointer
                  {isSelected
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}"
                onclick={() => selectTag(tag)}
              >
                {tag}
                <span class="opacity-60">{count}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if} -->

      <!-- Empty state -->
      {#if availableSources.length === 0 && availableTags.length === 0}
        <div class="text-xs text-text-secondary text-center py-4">
          Không có dữ liệu để lọc.
        </div>
      {/if}
    </div>
  </Popover.Content>
  </Popover.Portal>
</Popover.Root>
