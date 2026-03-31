<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { slideScaleFade, type SlideDirection } from "$lib/transitions/slideScaleFade";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		sideOffset = 4,
		align = "center",
		side = "bottom",
		class: className,
		children,
		...restProps
	}: PopoverPrimitive.ContentProps & {
		children?: Snippet;
	} = $props();

	const getSlideFrom = (currentSide: string): SlideDirection => {
		switch (currentSide) {
			case "top":
				return "bottom";
			case "left":
			case "inline-start":
				return "right";
			case "right":
			case "inline-end":
				return "left";
			case "bottom":
			default:
				return "top";
		}
	};
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		bind:ref
		{sideOffset}
		{align}
		{side}
		forceMount
		{...restProps}
	>
		{#snippet child({ wrapperProps, props, open })}
			{#if open}
				<div {...wrapperProps}>
					<div
						{...props}
						in:slideScaleFade={{
							duration: 180,
							slideFrom: getSlideFrom(side),
							slideDistance: "0.35rem",
							startScale: 0.98,
							startOpacity: 0
						}}
						out:slideScaleFade={{
							duration: 140,
							slideFrom: getSlideFrom(side),
							slideDistance: "0.35rem",
							startScale: 0.98,
							startOpacity: 0
						}}
						data-slot="popover-content"
						class={cn(
							"z-50 w-72 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
							className
						)}
					>
						{@render children?.()}
					</div>
				</div>
			{/if}
		{/snippet}
	</PopoverPrimitive.Content>
</PopoverPrimitive.Portal>
