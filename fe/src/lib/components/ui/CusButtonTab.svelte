<script lang="ts">
  type Props = {
    value: boolean
    onchange?: (value: boolean) => void
    tab1Label?: string
    tab2Label?: string
  }

  let {
    value = $bindable(true),
    onchange,
    tab1Label = 'News',
    tab2Label = 'Digest',
  }: Props = $props()

  let tab1El = $state<HTMLSpanElement | null>(null)
  let tab2El = $state<HTMLSpanElement | null>(null)
  let tab1W = $state(0)
  let tab2W = $state(0)

  let indicatorW = $derived(value ? tab1W : tab2W)
  let indicatorX = $derived(value ? 0 : tab1W)
  let visible = $state(false)
  let indicatorEl = $state<HTMLSpanElement | null>(null)

  $effect(() => {
    if (tab1W > 0) {
      const t = setTimeout(() => (visible = true), 100)
      return () => clearTimeout(t)
    }
  })

  function playPress(el: HTMLSpanElement | null) {
    el?.animate([{ scale: '1' }, { scale: '0.85' }, { scale: '1' }], {
      duration: 400,
      easing: 'cubic-bezier(.22,1,.36,1)',
    })
  }

  function toggle() {
    playPress(indicatorEl)
    value = !value
    onchange?.(value)
  }
</script>

<button
  onclick={toggle}
  class="relative h-8 inline-flex items-center rounded-full text-xs cursor-pointer"
>
  <!-- Frosted background -->
  <span
    class="absolute inset-y-0 -inset-x-0.5 bg-black/5 dark:bg-black/20 backdrop-blur-md rounded-full"
  ></span>

  <!-- Sliding indicator -->
  <span
    bind:this={indicatorEl}
    class="absolute inset-y-0.5 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] transition-[width,transform,opacity] duration-400 ease-out"
    class:opacity-0={!visible}
    style="width: {indicatorW}px; transform: translateX({indicatorX}px);"
  ></span>

  <!-- Tab 1 label -->
  <span
    bind:this={tab1El}
    bind:offsetWidth={tab1W}
    class="relative z-10 px-3 h-full flex items-center transition-opacity duration-200"
    class:opacity-40={!value}
  >
    {tab1Label}
  </span>

  <!-- Tab 2 label -->
  <span
    bind:this={tab2El}
    bind:offsetWidth={tab2W}
    class="relative z-10 px-3 h-full flex items-center transition-opacity duration-200"
    class:opacity-40={value}
  >
    {tab2Label}
  </span>
</button>
