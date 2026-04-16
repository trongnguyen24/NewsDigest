<script lang="ts">
  import type { Source } from '$lib/types'
  import {
    Loader2,
    RefreshCw,
    Pencil,
    Trash2,
    MoreVertical,
  } from 'lucide-svelte'
  import Switch from '$lib/components/app/Switch.svelte'
  import { Popover } from 'bits-ui'

  let {
    source,
    isAuthed,
    isFetching,
    isToggling,
    typeInfo,
    formattedTime,
    onManualFetch,
    onEdit,
    onDelete,
    onToggle,
  }: {
    source: Source
    isAuthed: boolean
    isFetching: boolean
    isToggling: boolean
    typeInfo: { icon: any; color: string; label: string }
    formattedTime: string
    onManualFetch: () => void
    onEdit: () => void
    onDelete: () => void
    onToggle: () => void
  } = $props()

  let popoverOpen = $state(false)
</script>

<article
  class="group rounded-xl border border-border/50 bg-bg-btn transition-[border-color] duration-200 hover:border-border"
>
  <div class="flex items-start gap-3.5 p-4">
    <!-- Type icon -->
    <div
      class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-1 dark:bg-bg-1/60 border border-border/40"
    >
      {#if typeInfo.icon}
        {@const Icon = typeInfo.icon}
        <Icon size={16} class={typeInfo.color} />
      {:else}
        <svg
          class="size-4 {typeInfo.color}"
          viewBox="0 0 24 24"
          fill="currentColor"
          ><path
            d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"
          /></svg
        >
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 flex flex-col justify-center min-w-0">
      <div class="flex items-center gap-2">
        <h3 class="font-serif text-base font-semibold text-text-main truncate">
          {source.name} <span class="text-border">·</span>
          <span class="text-text-secondary text-[0.7rem] font-mono"
            >{formattedTime}</span
          >
        </h3>
        {#if !source.enabled}
          <span
            class="shrink-0 text-[0.6rem] font-medium uppercase tracking-wider text-text-secondary bg-bg-1 dark:bg-bg-1/60 px-2 py-0.5 rounded-full"
          >
            Tắt
          </span>
        {/if}
      </div>

      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs text-text-secondary hover:text-text-main transition-colors truncate block"
      >
        {source.url}
      </a>

      <!-- Stats row -->
      <!-- <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-text-secondary"
      >
        <span>{typeInfo.label}</span>
        <span class="text-border">·</span>
        <span>{formattedTime}</span>
      </div> -->
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-1.5 shrink-0">
      {#if isAuthed}
        <!-- Desktop Actions -->
        <div class="hidden md:flex items-center gap-1.5">
          <button
            class="flex items-center justify-center size-8 rounded-full text-text-secondary hover:text-text-main hover:bg-bg-1 dark:hover:bg-bg-1/60 transition-colors cursor-pointer disabled:opacity-40"
            title="Fetch thủ công"
            disabled={isFetching}
            onclick={onManualFetch}
          >
            {#if isFetching}
              <Loader2 size={14} class="animate-spin" />
            {:else}
              <RefreshCw size={14} />
            {/if}
          </button>
          <button
            class="flex items-center justify-center size-8 rounded-full text-text-secondary hover:text-text-main hover:bg-bg-1 dark:hover:bg-bg-1/60 transition-colors cursor-pointer"
            title="Sửa nguồn"
            onclick={onEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            class="flex items-center justify-center size-8 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
            title="Xoá nguồn"
            onclick={onDelete}
          >
            <Trash2 size={14} />
          </button>
          <Switch
            checked={source.enabled === 1}
            disabled={isToggling}
            onCheckedChange={onToggle}
          />
        </div>

        <!-- Mobile Dropdown Actions -->
        <div class="md:hidden flex items-center">
          <Popover.Root bind:open={popoverOpen}>
            <Popover.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  class="flex items-center justify-center size-8 rounded-full text-text-secondary hover:text-text-main hover:bg-bg-1 dark:hover:bg-bg-1/60 transition-colors cursor-pointer"
                >
                  <MoreVertical size={16} />
                </button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              class="z-50 w-48 p-0 flex flex-col rounded-3xl border border-white bg-bg-btn dark:border-white/10 dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
            >
              <div class="overflow-y-auto flex flex-col p-1 gap-1">
                <button
                  onclick={() => {
                    popoverOpen = false
                    onManualFetch()
                  }}
                  disabled={isFetching}
                  class="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-full text-left text-sm transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 text-text-main disabled:opacity-50"
                >
                  {#if isFetching}
                    <Loader2
                      size={16}
                      class="animate-spin text-text-secondary shrink-0"
                    />
                  {:else}
                    <RefreshCw size={16} class="text-text-secondary shrink-0" />
                  {/if}
                  <span class="flex-1 font-medium">Fetch thủ công</span>
                </button>

                <button
                  onclick={() => {
                    popoverOpen = false
                    onEdit()
                  }}
                  class="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-full text-left text-sm transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 text-text-main"
                >
                  <Pencil size={16} class="text-text-secondary shrink-0" />
                  <span class="flex-1 font-medium">Sửa nguồn</span>
                </button>

                <button
                  onclick={() => {
                    popoverOpen = false
                    onDelete()
                  }}
                  class="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-full text-left text-sm transition-colors cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400"
                >
                  <Trash2 size={16} class="shrink-0" />
                  <span class="flex-1 font-medium">Xoá nguồn</span>
                </button>

                <div
                  class="h-px bg-border max-w-[calc(100%-24px)] mx-auto w-full my-0.5"
                ></div>

                <div class="flex items-center justify-between px-3 py-2">
                  <span class="text-sm font-medium text-text-main"
                    >Kích hoạt</span
                  >
                  <Switch
                    checked={source.enabled === 1}
                    disabled={isToggling}
                    onCheckedChange={onToggle}
                  />
                </div>
              </div>
            </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      {:else}
        <span
          class="flex items-center gap-1.5 text-[0.65rem] font-medium px-2.5 py-1 rounded-full
          {source.enabled
            ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30'
            : 'text-text-secondary bg-bg-1 dark:bg-bg-1/60'}"
        >
          <span
            class="size-1.5 rounded-full {source.enabled
              ? 'bg-emerald-500'
              : 'bg-zinc-400'}"
          ></span>
          {source.enabled ? 'Bật' : 'Tắt'}
        </span>
      {/if}
    </div>
  </div>
</article>
