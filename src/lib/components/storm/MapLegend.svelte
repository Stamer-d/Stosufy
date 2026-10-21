<script>
	// What a forecast map's colours mean: its scale with the values marked, and where the
	// place under the pointer is on it
	import { legendGradient, legendAt } from '#lib/weatherLayers.ts';

	/** @type {{ layer: import('#lib/weatherLayers.ts').MapLayer, marker?: number | null }} */
	let { layer, marker = null } = $props();

	const mark = (value) => (layer.legendText ? layer.legendText(value) : `${value}`);
</script>

<div class="w-full">
	<div class="flex items-baseline justify-between gap-2 mb-1">
		<p class="text-[11px] font-bold">
			{layer.label}{#if layer.unit}<span class="ms-1 font-semibold text-white/50">{layer.unit}</span
				>{/if}
		</p>
		{#if marker != null}
			<p class="text-[11px] font-extrabold tabular-nums text-white">
				{layer.legendText ? layer.legendText(Math.round(marker)) : layer.text(marker) || '0'}
			</p>
		{/if}
	</div>
	<div
		class="relative h-2.5 rounded-full ring-1 ring-white/10"
		style="background: {legendGradient(layer)}"
	>
		{#if marker != null}
			<span
				class="absolute -top-1 size-0 -ml-[5px] border-x-[5px] border-x-transparent border-t-[6px] border-t-white drop-shadow transition-[left] duration-150"
				style="left: {legendAt(layer, marker) * 100}%"
			></span>
		{/if}
	</div>
	<div class="relative h-3.5 mt-0.5 text-[9.5px] font-semibold tabular-nums text-white/55">
		{#each layer.legend as value (value)}
			{@const at = legendAt(layer, value)}
			<!-- Those at the ends kept inside -->
			<span
				class="absolute whitespace-nowrap {at < 0.05
					? ''
					: at > 0.95
						? '-translate-x-full'
						: '-translate-x-1/2'}"
				style="left: {at * 100}%">{mark(value)}</span
			>
		{/each}
	</div>
</div>
