<script>
	// Under the earthquakes: the plates' boundaries on or off, what the colours mean (age or
	// depth) and the sizes
	import { AGE_COLOURS, DEPTH_COLOURS, quakeRadius } from '#lib/quakes.ts';

	/**
	 * @type {{
	 *   colourBy: import('#lib/quakes.ts').QuakeColouring,
	 *   plates: boolean,
	 *   sizes?: boolean,
	 *   oncolour: (by: import('#lib/quakes.ts').QuakeColouring) => void,
	 *   onplates: () => void
	 * }}
	 */
	let { colourBy, plates, sizes = true, oncolour, onplates } = $props();
</script>

<button
	class="flex shrink-0 items-center gap-1.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer transition {plates
		? 'bg-white/10 text-white'
		: 'text-white/45 hover:text-white/80'}"
	aria-pressed={plates}
	title="The boundaries of the tectonic plates: most quakes happen along them"
	onclick={onplates}><span class="icon-[mingcute--earth-latitude-line] size-4"></span>Plates</button
>
<div class="w-px h-8 shrink-0 bg-white/10"></div>
<div class="flex shrink-0 p-0.5 rounded-xl bg-white/[0.05] text-xs font-semibold" role="group">
	{#each [['age', 'Age'], ['depth', 'Depth']] as [value, label] (value)}
		<button
			class="px-2.5 h-7 rounded-lg cursor-pointer {colourBy === value
				? 'bg-white/15'
				: 'text-white/55 hover:text-white'}"
			aria-pressed={colourBy === value}
			title="Colour the quakes by their {label.toLowerCase()}"
			onclick={() => oncolour(/** @type {any} */ (value))}>{label}</button
		>
	{/each}
</div>
<div class="flex shrink-0 items-center gap-2.5 text-[11px] text-white/65">
	{#each colourBy === 'age' ? AGE_COLOURS : DEPTH_COLOURS as item (item.label)}
		<span class="flex items-center gap-1 whitespace-nowrap">
			<span class="size-2.5 rounded-full" style="background: {item.colour}"></span>
			{item.label}
		</span>
	{/each}
</div>
{#if sizes}
	<div
		class="flex shrink-0 items-end gap-1.5 pe-1 text-[10px] text-white/50"
		title="Size: magnitude"
	>
		{#each [2, 4, 6] as m (m)}
			{@const r = quakeRadius(m)}
			<span class="flex flex-col items-center">
				<svg width={r * 2 + 2} height={r * 2 + 2} class="overflow-visible">
					<circle
						cx={r + 1}
						cy={r + 1}
						{r}
						fill="rgba(255,255,255,0.12)"
						stroke="rgba(255,255,255,0.5)"
					/>
				</svg>
				M{m}
			</span>
		{/each}
	</div>
{/if}
