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

  let { class: className = '', children, href, ...rest }: Props = $props()
</script>

{#if href}
  <a
    {href}
    class="group relative inline-flex items-center justify-center rounded-full cursor-pointer {className}"
    {...rest}
  >
    <span
      class="absolute inset-0 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] transition-all duration-300 group-active:scale-85 group-active:duration-100"
    ></span>
    <span class="relative z-10 inline-flex items-center justify-center">
      {@render children()}
    </span>
  </a>
{:else}
  <button
    class="group relative inline-flex items-center justify-center rounded-full cursor-pointer disabled:cursor-default {className}"
    {...rest}
  >
    <span
      class="absolute inset-0 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] transition-all duration-300 group-active:scale-90 group-active:duration-100"
    ></span>
    <span class="relative z-10 inline-flex items-center justify-center">
      {@render children()}
    </span>
  </button>
{/if}
