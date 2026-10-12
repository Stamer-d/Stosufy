<script>
	// A dark map around a place, from map tiles, with more tile layers on top (the rain
	// radar) and whatever the widget draws over it
	import { tilesAround } from '#lib/map.ts';

	/**
	 * @type {{
	 *   lat: number, lon: number, zoom: number, width: number, height: number,
	 *   layers?: { key: string, url: (z: number, x: number, y: number) => string, opacity?: number }[],
	 *   children?: import('svelte').Snippet
	 * }}
	 */
	let { lat, lon, zoom, width, height, layers = [], children } = $props();

	let tiles = $derived(tilesAround(lat, lon, zoom, width, height));
	const base = (z, x, y) => `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
</script>

<div class="absolute inset-0 overflow-hidden bg-[#0e1116]">
	{#each tiles as tile (tile.key + '/' + tile.z)}
		<img
			src={base(tile.z, tile.x, tile.y)}
			alt=""
			draggable="false"
			class="absolute size-64 max-w-none select-none"
			style="left: {tile.left}px; top: {tile.top}px"
		/>
	{/each}
	{#each layers as layer (layer.key)}
		{#each tiles as tile (tile.key + '/' + tile.z)}
			<img
				src={layer.url(tile.z, tile.x, tile.y)}
				alt=""
				draggable="false"
				class="absolute size-64 max-w-none select-none"
				style="left: {tile.left}px; top: {tile.top}px; opacity: {layer.opacity ?? 1}"
				onerror={(e) => /** @type {HTMLElement} */ (e.currentTarget).classList.add('invisible')}
			/>
		{/each}
	{/each}
	{@render children?.()}
	<p class="absolute bottom-1 right-2 text-[9px] text-white/35 pointer-events-none">
		© OpenStreetMap · CARTO
	</p>
</div>
