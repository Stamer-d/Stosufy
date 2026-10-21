<script>
	// A forecast map's colours (see weatherField.ts): the grid made smooth, between its hours as
	// the time moves on, drawn at a half of the screen's pixels (a third while it plays) and
	// shown smoothly scaled up
	import { valuesAt, smooth, screenOnGrid, colourTable, paintField } from '#lib/weatherField.ts';
	import { TILE } from '#lib/map.ts';

	/**
	 * @type {{
	 *   grid: import('#lib/weather.ts').WeatherGrid | null,
	 *   layer: import('#lib/weatherLayers.ts').MapLayer | null,
	 *   time: number,
	 *   fast?: boolean,
	 *   lat: number, lon: number, zoom: number, width: number, height: number
	 * }}
	 */
	let { grid, layer, time, fast = false, lat, lon, zoom, width, height } = $props();

	let canvas = $state();
	let scale = $derived(fast ? 3 : 2);

	/** The raster's points per grid point: about one every 8 pixels on the screen */
	let factor = $derived(
		grid ? Math.max(2, Math.min(24, Math.ceil(((grid.step / 360) * TILE * 2 ** zoom) / 8))) : 1
	);
	// Where the screen is on the grid (again only when the view moves)
	let place = $derived(
		grid && width && height
			? screenOnGrid(grid, { lat, lon, zoom, width, height }, scale, factor)
			: null
	);

	let image = null;
	$effect(() => {
		if (!canvas) return;
		const w = place?.width ?? 1;
		const h = place?.height ?? 1;
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		const c = canvas.getContext('2d');
		const values = grid && layer && place ? valuesAt(grid, layer.key, time) : null;
		if (!values) {
			c.clearRect(0, 0, w, h);
			return;
		}
		const raster = (key) => {
			const v = valuesAt(grid, key, time);
			return v ? smooth(v, grid.columns, grid.rows, factor) : null;
		};
		const extra = (part) => {
			const r = part ? raster(part.key) : null;
			return r ? { raster: r, table: colourTable(part.stops) } : null;
		};
		if (image?.width !== w || image?.height !== h) image = c.createImageData(w, h);
		paintField(
			image,
			place,
			smooth(values, grid.columns, grid.rows, factor),
			colourTable(layer.stops, layer.steps),
			extra(layer.blend),
			extra(layer.under)
		);
		c.putImageData(image, 0, 0);
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
