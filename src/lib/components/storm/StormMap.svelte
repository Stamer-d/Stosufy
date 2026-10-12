<script>
	// The big map of the storm center: drag to move, scroll to zoom, click to look at a place.
	// Tile layers (radar, warnings) can have a lower top zoom than the map: their tiles are
	// then shown bigger. The CAPE map is drawn from a grid of forecast points.
	import { worldPixel, fromWorldPixel, TILE, baseTile, labelTile } from '#lib/map.ts';
	import { capeColour } from '#lib/storm.ts';

	/**
	 * @type {{
	 *   lat: number, lon: number, zoom: number,
	 *   layers?: { key: string, url: (z: number, x: number, y: number) => string, opacity?: number, maxZoom?: number }[],
	 *   cape?: { lat: number, lon: number, value: number }[][] | null,
	 *   markers?: { lat: number, lon: number, kind: string }[],
	 *   onmove?: (view: { lat: number, lon: number, zoom: number }) => void,
	 *   onpick?: (place: { lat: number, lon: number }) => void,
	 *   onbounds?: (bounds: { north: number, south: number, west: number, east: number }) => void
	 * }}
	 */
	let {
		lat,
		lon,
		zoom,
		layers = [],
		cape = null,
		markers = [],
		onmove = () => {},
		onpick = () => {},
		onbounds = () => {}
	} = $props();

	let width = $state(0);
	let height = $state(0);
	let canvas = $state();

	let centre = $derived(worldPixel(lat, lon, zoom));

	/** The tiles of a layer at its own zoom, each placed and sized on the screen */
	function tiles(layerZoom) {
		const z = Math.min(zoom, layerZoom);
		const scale = 2 ** (zoom - z);
		const size = TILE * scale;
		const c = worldPixel(lat, lon, z);
		const left = c.x * scale - width / 2;
		const top = c.y * scale - height / 2;
		const count = 2 ** z;
		const list = [];
		for (let ty = Math.floor(top / size); ty <= Math.floor((top + height) / size); ty++) {
			if (ty < 0 || ty >= count) continue;
			for (let tx = Math.floor(left / size); tx <= Math.floor((left + width) / size); tx++) {
				const x = ((tx % count) + count) % count;
				list.push({
					x,
					y: ty,
					z,
					left: tx * size - left,
					top: ty * size - top,
					size,
					key: `${z}/${tx}/${ty}`
				});
			}
		}
		return list;
	}
	let baseTiles = $derived(width && height ? tiles(zoom) : []);

	function toScreen(placeLat, placeLon) {
		const p = worldPixel(placeLat, placeLon, zoom);
		return { x: p.x - centre.x + width / 2, y: p.y - centre.y + height / 2 };
	}
	function toPlace(x, y) {
		return fromWorldPixel(centre.x + x - width / 2, centre.y + y - height / 2, zoom);
	}

	// The area shown, for loading what's in it
	$effect(() => {
		if (!width || !height) return;
		const nw = toPlace(0, 0);
		const se = toPlace(width, height);
		onbounds({ north: nw.lat, south: se.lat, west: nw.lon, east: se.lon });
	});

	// --- Moving and zooming ------------------------------------------------------------------
	let drag = null;
	function down(event) {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = { x: event.clientX, y: event.clientY, centre: { ...centre }, moved: false };
	}
	function move(event) {
		if (!drag) return;
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
		if (!drag.moved) return;
		const place = fromWorldPixel(drag.centre.x - dx, drag.centre.y - dy, zoom);
		onmove({ lat: Math.max(-80, Math.min(80, place.lat)), lon: place.lon, zoom });
	}
	function up(event) {
		if (!drag) return;
		if (!drag.moved) {
			const rect = event.currentTarget.getBoundingClientRect();
			onpick(toPlace(event.clientX - rect.left, event.clientY - rect.top));
		}
		drag = null;
	}
	let wheelAt = 0;
	function wheel(event) {
		event.preventDefault();
		// One step per scroll gesture
		if (performance.now() - wheelAt < 180) return;
		wheelAt = performance.now();
		const next = Math.max(3, Math.min(11, zoom + (event.deltaY < 0 ? 1 : -1)));
		if (next === zoom) return;
		// The place under the pointer stays where it is
		const rect = event.currentTarget.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const under = toPlace(x, y);
		const p = worldPixel(under.lat, under.lon, next);
		const place = fromWorldPixel(p.x - x + width / 2, p.y - y + height / 2, next);
		onmove({ lat: place.lat, lon: place.lon, zoom: next });
	}

	// --- The CAPE map ------------------------------------------------------------------------
	$effect(() => {
		if (!canvas || !width || !height) return;
		const c = canvas.getContext('2d');
		// Drawn small and shown smoothly scaled up
		const step = 6;
		const w = Math.ceil(width / step);
		const h = Math.ceil(height / step);
		canvas.width = w;
		canvas.height = h;
		c.clearRect(0, 0, w, h);
		if (!cape?.length || !cape[0]?.length) return;
		const rows = cape.length;
		const columns = cape[0].length;
		const north = cape[0][0].lat;
		const south = cape[rows - 1][0].lat;
		const west = cape[0][0].lon;
		const east = cape[0][columns - 1].lon;
		const image = c.createImageData(w, h);
		for (let py = 0; py < h; py++) {
			for (let px = 0; px < w; px++) {
				const place = toPlace(px * step, py * step);
				const fr = ((north - place.lat) / (north - south)) * (rows - 1);
				const fc = ((place.lon - west) / (east - west)) * (columns - 1);
				if (fr < 0 || fc < 0 || fr > rows - 1 || fc > columns - 1) continue;
				const r0 = Math.floor(fr);
				const c0 = Math.floor(fc);
				const r1 = Math.min(rows - 1, r0 + 1);
				const c1 = Math.min(columns - 1, c0 + 1);
				const tr = fr - r0;
				const tc = fc - c0;
				const value =
					(cape[r0][c0].value * (1 - tc) + cape[r0][c1].value * tc) * (1 - tr) +
					(cape[r1][c0].value * (1 - tc) + cape[r1][c1].value * tc) * tr;
				const [r, g, b, a] = capeColour(value);
				const i = (py * w + px) * 4;
				image.data[i] = r;
				image.data[i + 1] = g;
				image.data[i + 2] = b;
				image.data[i + 3] = a * 255;
			}
		}
		c.putImageData(image, 0, 0);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="absolute inset-0 overflow-hidden bg-[#0e1116] select-none cursor-grab active:cursor-grabbing touch-none"
	bind:clientWidth={width}
	bind:clientHeight={height}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={() => (drag = null)}
	onwheel={wheel}
>
	{#each baseTiles as tile (tile.key)}
		<img
			src={baseTile(tile.z, tile.x, tile.y)}
			alt=""
			draggable="false"
			class="absolute max-w-none pointer-events-none"
			style="left: {tile.left}px; top: {tile.top}px; width: {tile.size}px; height: {tile.size}px"
		/>
	{/each}
	<canvas
		bind:this={canvas}
		class="absolute inset-0 size-full pointer-events-none"
		style="image-rendering: auto"
	></canvas>
	{#each layers as layer (layer.key)}
		{#each tiles(layer.maxZoom ?? 18) as tile (tile.key)}
			<img
				src={layer.url(tile.z, tile.x, tile.y)}
				alt=""
				draggable="false"
				class="absolute max-w-none pointer-events-none"
				style="left: {tile.left}px; top: {tile.top}px; width: {tile.size}px; height: {tile.size}px; opacity: {layer.opacity ??
					1}"
				onerror={(e) => /** @type {HTMLElement} */ (e.currentTarget).classList.add('invisible')}
			/>
		{/each}
	{/each}
	<!-- City names above the weather -->
	{#each baseTiles as tile (tile.key)}
		<img
			src={labelTile(tile.z, tile.x, tile.y)}
			alt=""
			draggable="false"
			class="absolute max-w-none pointer-events-none"
			style="left: {tile.left}px; top: {tile.top}px; width: {tile.size}px; height: {tile.size}px"
			onerror={(e) => /** @type {HTMLElement} */ (e.currentTarget).classList.add('invisible')}
		/>
	{/each}
	{#each markers as marker, i (i)}
		{@const at = toScreen(marker.lat, marker.lon)}
		{#if marker.kind === 'home'}
			<span
				class="absolute size-3.5 -ml-[7px] -mt-[7px] rounded-full bg-white ring-4 ring-primary-400/60 pointer-events-none"
				style="left: {at.x}px; top: {at.y}px"
			></span>
		{:else}
			<span
				class="absolute -ml-3 -mt-6 icon-[mingcute--location-fill] size-6 text-amber-300 drop-shadow pointer-events-none"
				style="left: {at.x}px; top: {at.y}px"
			></span>
		{/if}
	{/each}
	<p class="absolute bottom-1 right-2 text-[10px] text-white/40 pointer-events-none">
		© Esri, HERE, Garmin, OpenStreetMap · RainViewer · DWD · Open-Meteo
	</p>
</div>
