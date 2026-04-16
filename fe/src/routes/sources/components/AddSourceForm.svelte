<script lang="ts">
  import CusButton from '$lib/components/ui/CusButton.svelte'
  import { Loader2, Link2, Plus } from 'lucide-svelte'
  import { getTypeIcon, type SourcePreview } from './utils'
  import type { Source } from '$lib/types'

  let {
    newUrl = $bindable(''),
    newName = $bindable(''),
    isResolving,
    isAdding,
    preview,
    previewError,
    onPreview,
    onAdd
  }: {
    newUrl: string
    newName: string
    isResolving: boolean
    isAdding: boolean
    preview: SourcePreview | null
    previewError: string
    onPreview: () => void
    onAdd: () => void
  } = $props()
</script>

<section
  class="mb-8 rounded-2xl border border-border/60 bg-bg-btn p-4 sm:p-5"
>
  <p
    class="text-[0.675rem] font-semibold uppercase tracking-widest text-text-secondary mb-3"
  >
    Thêm nguồn mới
  </p>
  <div class="flex flex-col sm:flex-row gap-2">
    <input
      bind:value={newUrl}
      placeholder="URL nguồn (RSS, Reddit, YouTube, blog...)"
      class="h-10 flex-1 rounded-xl border border-border/60 bg-transparent px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-text-main/10 placeholder:text-text-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
    />
    <input
      bind:value={newName}
      placeholder="Tên (tuỳ chọn)"
      class="h-10 w-full sm:w-36 rounded-xl border border-border/60 bg-transparent px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-text-main/10 placeholder:text-text-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
    />
    <div class="flex gap-2">
      <CusButton
        class="h-10 px-3.5 text-sm"
        disabled={isResolving || !newUrl.trim()}
        onclick={onPreview}
      >
        {#if isResolving}
          <Loader2 size={14} class="animate-spin" />
        {:else}
          <Link2 size={14} />
        {/if}
        <span class="ml-1.5">Preview</span>
      </CusButton>
      <CusButton
        class="h-10 px-3.5 text-sm"
        disabled={isAdding || !newUrl.trim()}
        onclick={onAdd}
      >
        {#if isAdding}
          <Loader2 size={14} class="animate-spin" />
        {:else}
          <Plus size={14} />
        {/if}
        <span class="ml-1.5">Thêm</span>
      </CusButton>
    </div>
  </div>

  <!-- Preview result -->
  {#if preview}
    {@const typeInfo = getTypeIcon(preview.detected_type)}
    <div
      class="mt-3 rounded-xl bg-bg-1/80 dark:bg-bg-1/40 border border-border/40 px-4 py-3"
    >
      <div class="flex items-center gap-2 text-sm mb-1.5">
        {#if typeInfo.icon}
          {@const Icon = typeInfo.icon}
          <Icon
            size={14}
            class={typeInfo.color}
          />
        {:else}
          <svg
            class="size-3.5 {typeInfo.color}"
            viewBox="0 0 24 24"
            fill="currentColor"
            ><path
              d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"
            /></svg
          >
        {/if}
        <span class="font-medium text-text-main">{typeInfo.label}</span>
        <span class="text-text-secondary text-xs"
          >· {preview.detection_method}</span
        >
      </div>
      <p class="text-xs text-text-secondary break-all leading-relaxed">
        {preview.resolved_url}
      </p>
    </div>
  {:else if previewError}
    <div
      class="mt-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 px-4 py-2.5 text-sm text-red-600 dark:text-red-400"
    >
      {previewError}
    </div>
  {/if}
</section>
