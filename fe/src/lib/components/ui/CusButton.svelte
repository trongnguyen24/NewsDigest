<script lang="ts">
  import type { Snippet } from 'svelte'

  type Props = {
    class?: string
    children: Snippet
    href?: string
    target?: string
    rel?: string
    disabled?: boolean
    onclick?: (e: Event) => void
    [key: string]: unknown
  }

  let {
    class: className = '',
    children,
    href,
    disabled = false,
    ...rest
  }: Props = $props()

  let bgSpanA = $state<HTMLSpanElement | null>(null)
  let bgSpanBtn = $state<HTMLSpanElement | null>(null)

  function playPress(el: HTMLSpanElement | null) {
    el?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.85)' },
        { transform: 'scale(1)' },
      ],
      { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)' },
    )
  }
</script>

{#if href}
  <a
    {href}
    aria-disabled={disabled}
    onpointerdown={() => playPress(bgSpanA)}
    class="relative inline-flex items-center justify-center rounded-full cursor-pointer {disabled
      ? 'pointer-events-none'
      : ''} {className}"
    {...rest}
  >
    <span
      bind:this={bgSpanA}
      class="absolute inset-0 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)]"
    ></span>
    <span
      class="relative z-10 inline-flex items-center justify-center {disabled
        ? 'opacity-50'
        : ''}"
    >
      {@render children()}
    </span>
  </a>
{:else}
  <button
    {disabled}
    onpointerdown={() => !disabled && playPress(bgSpanBtn)}
    class="relative inline-flex items-center justify-center rounded-full cursor-pointer disabled:cursor-default {className}"
    {...rest}
  >
    <span
      bind:this={bgSpanBtn}
      class="absolute inset-0 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)]"
    ></span>
    <span
      class="relative z-10 inline-flex items-center justify-center transition-opacity"
      class:opacity-50={disabled}
    >
      {@render children()}
    </span>
  </button>
{/if}
