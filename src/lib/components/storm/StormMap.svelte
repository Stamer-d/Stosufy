<script>
	// The big map of the storm center: drag to move, scroll to zoom, click to look at a place.
	// Tile layers (radar, satellite) can have a lower top zoom than the map: their tiles are
	// then shown bigger. Forecast fields are drawn from a grid of points, the DWD warnings
	// as areas, lightning as it strikes.
	import { onMount } from 'svelte';
	import { worldPixel, fromWorldPixel, TILE, baseTile, labelTile } from '#lib/map.ts';
	import { drawStrikes, SEVERITY_COLOURS } from '#lib/storm.ts';

	/**
	 * @type {{
	 *   lat: number, lon: number, zoom: number,
	 *   layers?: { key: string, url: (z: number, x: number, y: number) => string, opacity?: number, maxZoom?: number }[],
	 *   field?: { rows: { lat: number, lon: number, value: number }[][], colour: (v: number) => number[] } | null,
	 *   warnings?: import('#lib/storm.ts').WarningArea[] | null,
	 *   strikes?: { time: number, lat: number, lon: number }[] | null,
	 *   home?: { lat: number, lon: number } | null,
	 *   probe?: { lat: number, lon: number } | null,
	 *   rings?: number[],
	 *   onmove?: (view: { lat: number, lon: number, zoom: number }) => void,
	 *   onpick?: (place: { lat: number, lon: number }, warnings: import('#lib/storm.ts').WarningArea[]) => void,
	 *   onhover?: (place: { lat: number, lon: number } | null) => void,
	 *   onbounds?: (bounds: { north: number, south: number, west: number, east: number }) => void
	 * }}
	 */
	let {
		lat,
		lon,
		zoom,
		layers = [],
		field = null,
		warnings = null,
		strikes = null,
		home = null,
		probe = null,
		rings = [],
		onmove = () => {},
		onpick = () => {},
		onhover = () => {},
		onbounds = () => {}
	} = $props();

	let width = $state(0);
	let height = $state(0);
	let fieldCanvas = $state();
	let areaCanvas = $state();
	let lightningCanvas = $state();

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
	let layerTiles = $derived(
		width && height ? layers.map((layer) => ({ layer, tiles: tiles(layer.maxZoom ?? 18) })) : []
	);

	function toScreen(placeLat, placeLon) {
		const p = worldPixel(placeLat, placeLon, zoom);
		return { x: p.x - centre.x + width / 2, y: p.y - centre.y + height / 2 };
	}
	function toPlace(x, y) {
		return fromWorldPixel(centre.x + x - width / 2, centre.y + y - height / 2, zoom);
	}
	let kmPerPixel = $derived((40075 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** zoom));

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
		const rect = event.currentTarget.getBoundingClientRect();
		if (!drag) {
			onhover(toPlace(event.clientX - rect.left, event.clientY - rect.top));
			return;
		}
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
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			onpick(toPlace(x, y), warningsAt(x, y));
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

	/** A canvas the size of the map (at a fraction of it for smooth fields), cleared */
	function prepare(canvas, step = 1) {
		const ratio = step === 1 ? devicePixelRatio || 1 : 1 / step;
		const w = Math.ceil(width * ratio);
		const h = Math.ceil(height * ratio);
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		const c = canvas.getContext('2d');
		c.setTransform(1, 0, 0, 1, 0, 0);
		c.clearRect(0, 0, w, h);
		return { c, ratio };
	}

	// --- A forecast field --------------------------------------------------------------------
	$effect(() => {
		if (!fieldCanvas || !width || !height) return;
		// Drawn small and shown smoothly scaled up
		const step = 6;
		const { c } = prepare(fieldCanvas, step);
		const rows = field?.rows;
		if (!rows?.length || !rows[0]?.length) return;
		const w = fieldCanvas.width;
		const h = fieldCanvas.height;
		const count = rows.length;
		const columns = rows[0].length;
		const north = rows[0][0].lat;
		const south = rows[count - 1][0].lat;
		const west = rows[0][0].lon;
		const east = rows[0][columns - 1].lon;
		const image = c.createImageData(w, h);
		for (let py = 0; py < h; py++) {
			for (let px = 0; px < w; px++) {
				const place = toPlace(px * step, py * step);
				const fr = ((north - place.lat) / (north - south)) * (count - 1);
				const fc = ((place.lon - west) / (east - west)) * (columns - 1);
				if (fr < 0 || fc < 0 || fr > count - 1 || fc > columns - 1) continue;
				const r0 = Math.floor(fr);
				const c0 = Math.floor(fc);
				const r1 = Math.min(count - 1, r0 + 1);
				const c1 = Math.min(columns - 1, c0 + 1);
				const tr = fr - r0;
				const tc = fc - c0;
				const value =
					(rows[r0][c0].value * (1 - tc) + rows[r0][c1].value * tc) * (1 - tr) +
					(rows[r1][c0].value * (1 - tc) + rows[r1][c1].value * tc) * tr;
				const [r, g, b, a] = field.colour(value);
				const i = (py * w + px) * 4;
				image.data[i] = r;
				image.data[i + 1] = g;
				image.data[i + 2] = b;
				image.data[i + 3] = a * 255;
			}
		}
		c.putImageData(image, 0, 0);
	});

	// --- DWD warnings as areas ---------------------------------------------------------------
	// The outlines in pixels of the world at zoom 0, made once per update of the warnings
	let paths = $derived(
		(warnings ?? []).map((area) => {
			const path = new Path2D();
			for (const ring of area.rings) {
				ring.forEach(([ringLon, ringLat], i) => {
					const p = worldPixel(ringLat, ringLon, 0);
					if (i) path.lineTo(p.x, p.y);
					else path.moveTo(p.x, p.y);
				});
				path.closePath();
			}
			return { area, path };
		})
	);
	$effect(() => {
		if (!areaCanvas || !width || !height) return;
		const { c, ratio } = prepare(areaCanvas);
		if (!paths.length) return;
		const k = 2 ** zoom;
		c.setTransform(
			k * ratio,
			0,
			0,
			k * ratio,
			(width / 2 - centre.x) * ratio,
			(height / 2 - centre.y) * ratio
		);
		c.lineWidth = 1.2 / k;
		// The least severe first, the worst on top
		for (const { area, path } of [...paths].reverse()) {
			const colour = SEVERITY_COLOURS[area.severity];
			c.fillStyle = colour + '4d';
			c.strokeStyle = colour + 'cc';
			c.fill(path, 'evenodd');
			c.stroke(path);
		}
	});
	function warningsAt(x, y) {
		if (!areaCanvas || !paths.length) return [];
		const c = areaCanvas.getContext('2d');
		c.save();
		c.setTransform(1, 0, 0, 1, 0, 0);
		const k = 2 ** zoom;
		const wx = (centre.x + x - width / 2) / k;
		const wy = (centre.y + y - height / 2) / k;
		const hit = paths.filter(({ path }) => c.isPointInPath(path, wx, wy, 'evenodd'));
		c.restore();
		return hit.map(({ area }) => area);
	}

	// --- Lightning, a few times a second (new strikes flash, old ones fade) -------------------
	function drawLightning() {
		if (!lightningCanvas || !width || !height) return;
		const { c, ratio } = prepare(lightningCanvas);
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (strikes?.length) drawStrikes(c, strikes, toScreen, width, height, zoom >= 8 ? 1.4 : 1);
	}
	onMount(() => {
		const timer = setInterval(drawLightning, 100);
		return () => clearInterval(timer);
	});

	let homeAt = $derived(home && width ? toScreen(home.lat, home.lon) : null);
	let probeAt = $derived(probe && width ? toScreen(probe.lat, probe.lon) : null);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="absolute inset-0 overflow-hidden bg-[#111418] select-none cursor-crosshair active:cursor-grabbing touch-none"
	bind:clientWidth={width}
	bind:clientHeight={height}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={() => (drag = null)}
	onpointerleave={() => onhover(null)}
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
	<canvas bind:this={fieldCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
	{#each layerTiles as { layer, tiles: list } (layer.key)}
		{#each list as tile (tile.key)}
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
	<canvas bind:this={areaCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
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
	<canvas bind:this={lightningCanvas} class="absolute inset-0 size-full pointer-events-none"
	></canvas>
	{#if homeAt}
		<svg class="absolute inset-0 size-full pointer-events-none overflow-visible">
			{#each rings as km (km)}
				<circle
					cx={homeAt.x}
					cy={homeAt.y}
					r={km / kmPerPixel}
					fill="none"
					stroke="rgba(255,255,255,0.22)"
					stroke-dasharray="3 5"
				/>
				<text
					x={homeAt.x + 4}
					y={homeAt.y - km / kmPerPixel - 4}
					font-size="10"
					fill="rgba(255,255,255,0.5)">{km} km</text
				>
			{/each}
		</svg>
		<span
			class="absolute size-3.5 -ml-[7px] -mt-[7px] rounded-full bg-sky-400 ring-4 ring-sky-400/30 shadow-[0_0_12px] shadow-sky-400 pointer-events-none"
			style="left: {homeAt.x}px; top: {homeAt.y}px"
		></span>
	{/if}
	{#if probeAt}
		<span
			class="absolute -ml-3 -mt-6 icon-[mingcute--location-fill] size-6 text-amber-300 drop-shadow pointer-events-none"
			style="left: {probeAt.x}px; top: {probeAt.y}px"
		></span>
	{/if}
</div>
