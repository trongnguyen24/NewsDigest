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
  let indicatorW = $state(0)
  let indicatorX = $state(0)

  $effect(() => {
    const el = value ? tab1El : tab2El
    if (!el) return
    indicatorW = el.offsetWidth
    indicatorX = el.offsetLeft
  })

  function toggle() {
    value = !value
    onchange?.(value)
  }
</script>

<button
  onclick={toggle}
  class="group relative h-8 inline-flex items-center rounded-full text-xs cursor-pointer"
>
  <!-- Frosted background -->
  <span
    class="absolute inset-y-0 -inset-x-0.5 bg-black/5 backdrop-blur-md rounded-full"
  ></span>

  <!-- Sliding indicator -->
  <span
    class="absolute inset-y-0.5 rounded-full border border-white bg-bg-btn dark:border-white/5 dark:bg-bg-btn dark:shadow-sm shadow-[0_8px_16px_rgba(73,71,69,0.03),0_4px_8px_rgba(73,71,69,0.03)] transition-all duration-300 ease-out group-active:scale-90 group-active:duration-100"
    style="width: {indicatorW}px; transform: translateX({indicatorX}px);"
  ></span>

  <!-- Tab 1 label -->
  <span
    bind:this={tab1El}
    class="relative z-10 px-3 h-full flex items-center transition-opacity duration-200"
    class:opacity-40={!value}
  >
    {tab1Label}
  </span>

  <!-- Tab 2 label -->
  <span
    bind:this={tab2El}
    class="relative z-10 px-3 h-full flex items-center transition-opacity duration-200"
    class:opacity-40={value}
  >
    {tab2Label}
  </span>
</button>
