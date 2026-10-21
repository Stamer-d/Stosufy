<script>
	// The big map of the weather center: drag to move, scroll to zoom, click to look at a place.
	// Tile layers (radar, satellite) can have a lower top zoom than the map: their tiles are
	// then shown bigger. The forecast's maps are drawn from a grid of points (smooth colours,
	// the values written on them, the wind blowing), the DWD warnings as areas, lightning as it
	// strikes, planes where they fly (moving on between updates), earthquakes as circles by
	// their size (and lines like the plates' boundaries under them).
	import { onMount } from 'svelte';
	import { worldPixel, fromWorldPixel, TILE, baseTile, labelTile } from '#lib/map.ts';
	import { drawStrikes, SEVERITY_COLOURS } from '#lib/storm.ts';
	import { radarSrc } from '#lib/radarClean.ts';
	import RadarCanvas from './RadarCanvas.svelte';
	import WeatherField from './WeatherField.svelte';
	import WeatherMarks from './WeatherMarks.svelte';
	import WindParticles from './WindParticles.svelte';
	import { planeNow, drawPlane, drawTrail, altitudeColour, greatCircle } from '#lib/flights.ts';
	import { drawQuakes, quakeAt } from '#lib/quakes.ts';

	/**
	 * @type {{
	 *   lat: number, lon: number, zoom: number,
	 *   minZoom?: number, maxZoom?: number,
	 *   layers?: { key: string, url: (z: number, x: number, y: number) => string, opacity?: number, maxZoom?: number, clean?: boolean }[],
	 *   weather?: { grid: import('#lib/weather.ts').WeatherGrid, layer: import('#lib/weatherLayers.ts').MapLayer | null, time: number, playing?: boolean, labels?: boolean, isobars?: boolean } | null,
	 *   wind?: { grid: import('#lib/weather.ts').WeatherGrid, time: number, opacity?: number } | null,
	 *   warnings?: import('#lib/storm.ts').WarningArea[] | null,
	 *   strikes?: { time: number, lat: number, lon: number }[] | null,
	 *   home?: { lat: number, lon: number } | null,
	 *   probe?: { lat: number, lon: number } | null,
	 *   rings?: number[],
	 *   radar?: { host: string, frames: { path: string, time: number }[], frame: number, opacity?: number } | null,
	 *   onradarready?: (paths: string[]) => void,
	 *   planes?: import('#lib/flights.ts').Plane[] | null,
	 *   selectedPlane?: string | null,
	 *   track?: import('#lib/flights.ts').TrailPoint[] | null,
	 *   route?: { from: { lat: number, lon: number } | null, to: { lat: number, lon: number } | null } | null,
	 *   planeColour?: string | null,
	 *   trailMinutes?: number,
	 *   onplane?: (plane: import('#lib/flights.ts').Plane) => void,
	 *   quakes?: import('#lib/quakes.ts').Quake[] | null,
	 *   selectedQuake?: string | null,
	 *   quakeColour?: import('#lib/quakes.ts').QuakeColouring,
	 *   onquake?: (quake: import('#lib/quakes.ts').Quake) => void,
	 *   lines?: { paths: [number, number][][], colour?: string } | null,
	 *   onmove?: (view: { lat: number, lon: number, zoom: number }) => void,
	 *   onpick?: (place: { lat: number, lon: number }, warnings: import('#lib/storm.ts').WarningArea[]) => void,
	 *   onhover?: (place: { lat: number, lon: number } | null, point?: { x: number, y: number }) => void,
	 *   onbounds?: (bounds: { north: number, south: number, west: number, east: number }) => void
	 * }}
	 */
	let {
		lat,
		lon,
		zoom,
		minZoom = 3,
		maxZoom = 11,
		layers = [],
		weather = null,
		wind = null,
		warnings = null,
		strikes = null,
		home = null,
		probe = null,
		rings = [],
		radar = null,
		onradarready = () => {},
		planes = null,
		selectedPlane = null,
		track = null,
		route = null,
		planeColour = null,
		trailMinutes = 0,
		onplane = () => {},
		quakes = null,
		selectedQuake = null,
		quakeColour = 'age',
		onquake = () => {},
		lines = null,
		onmove = () => {},
		onpick = () => {},
		onhover = () => {},
		onbounds = () => {}
	} = $props();

	let width = $state(0);
	let height = $state(0);
	let areaCanvas = $state();
	let lightningCanvas = $state();
	let planeCanvas = $state();
	let quakeCanvas = $state();
	let lineCanvas = $state();

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
	/** Where the world repeats on the screen (zoomed far out it shows more than once) */
	let shifts = $derived.by(() => {
		const world = TILE * 2 ** zoom;
		const list = [];
		const first = Math.floor((centre.x - width / 2) / world);
		const last = Math.floor((centre.x + width / 2) / world);
		for (let n = first; n <= last; n++) list.push(n * world);
		return list;
	});

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
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			onhover(toPlace(x, y), { x, y });
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
			const plane = planeAt(x, y);
			const quake =
				!plane && quakes?.length
					? quakeAt(quakes, toScreen, x, y, { shifts, scale: quakeScale })
					: null;
			if (plane) onplane(plane);
			else if (quake) onquake(quake);
			else onpick(toPlace(x, y), warningsAt(x, y));
		}
		drag = null;
	}
	let wheelAt = 0;
	function wheel(event) {
		event.preventDefault();
		// One step per scroll gesture
		if (performance.now() - wheelAt < 180) return;
		wheelAt = performance.now();
		const next = Math.max(minZoom, Math.min(maxZoom, zoom + (event.deltaY < 0 ? 1 : -1)));
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

	// --- Lines (like the plates' boundaries), in pixels of the world at zoom 0 ------------------
	let linePath = $derived.by(() => {
		if (!lines?.paths.length) return null;
		const path = new Path2D();
		for (const line of lines.paths)
			line.forEach(([lineLon, lineLat], i) => {
				const p = worldPixel(lineLat, lineLon, 0);
				if (i) path.lineTo(p.x, p.y);
				else path.moveTo(p.x, p.y);
			});
		return path;
	});
	$effect(() => {
		if (!lineCanvas || !width || !height) return;
		const { c, ratio } = prepare(lineCanvas);
		if (!linePath) return;
		const k = 2 ** zoom;
		c.strokeStyle = lines.colour ?? 'rgba(248, 113, 113, 0.55)';
		c.lineWidth = 1.4 / k;
		c.lineJoin = 'round';
		for (const shift of shifts) {
			c.setTransform(
				k * ratio,
				0,
				0,
				k * ratio,
				(width / 2 - centre.x + shift) * ratio,
				(height / 2 - centre.y) * ratio
			);
			c.stroke(linePath);
		}
	});

	// --- Lightning, every frame (so it moves with the map; new strikes flash, old ones fade) ---
	// Where each strike is on the world at zoom 0, worked out once per strike
	const projected = new WeakMap();
	function worldOf(strike) {
		let p = projected.get(strike);
		if (!p) {
			p = worldPixel(strike.lat, strike.lon, 0);
			projected.set(strike, p);
		}
		return p;
	}
	let drawn = '';
	let drawnAt = 0;
	function drawLightning() {
		if (!lightningCanvas || !width || !height) return;
		const now = performance.now();
		// Again when the map moved or the strikes changed, else a few times a second (the
		// flashes and sound rings move, the colours age)
		const key = `${centre.x},${centre.y},${zoom},${width},${height},${strikes?.length ?? 0},${strikes?.at(-1)?.time ?? 0}`;
		const animating = strikes?.length && Date.now() - (strikes.at(-1)?.time ?? 0) < 60000;
		if (key === drawn && now - drawnAt < (animating ? 33 : 500)) return;
		drawn = key;
		drawnAt = now;
		const { c, ratio } = prepare(lightningCanvas);
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (!strikes?.length) return;
		const k = 2 ** zoom;
		const left = centre.x - width / 2;
		const top = centre.y - height / 2;
		const screen = (_lat, _lon, strike) => {
			const p = worldOf(strike);
			return { x: p.x * k - left, y: p.y * k - top };
		};
		drawStrikes(c, strikes, screen, width, height, zoom >= 8 ? 1.4 : 1, kmPerPixel);
	}
	// --- Earthquakes: drawn again when something changed, often while new ones pulse ----------
	let quakesDrawn = '';
	let quakesDrawnFor = null;
	let quakesDrawnAt = 0;
	let quakeScale = $derived(zoom <= 3 ? 0.85 : 1);
	let pulsing = $derived(!!quakes?.some((q) => Date.now() - q.time < 60 * 60 * 1000));
	function drawQuakeLayer() {
		if (!quakeCanvas || !width || !height) return;
		// None now and none drawn (the storm center and flight radar)
		if (!quakes?.length && !quakesDrawnFor?.length) return;
		const now = performance.now();
		const key = `${centre.x},${centre.y},${zoom},${width},${height},${quakeColour},${selectedQuake}`;
		if (
			key === quakesDrawn &&
			quakes === quakesDrawnFor &&
			now - quakesDrawnAt < (pulsing ? 33 : 1000)
		)
			return;
		quakesDrawn = key;
		quakesDrawnFor = quakes;
		quakesDrawnAt = now;
		const { c, ratio } = prepare(quakeCanvas);
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (!quakes?.length) return;
		drawQuakes(c, quakes, toScreen, width, height, {
			shifts,
			colourBy: quakeColour,
			selected: selectedQuake,
			scale: quakeScale
		});
	}

	// --- The rain radar (see RadarCanvas) ------------------------------------------------------
	let radarTiles = $derived(radar && width && height ? tiles(7) : []);

	// --- Planes, every frame (they fly on between updates) ------------------------------------
	function drawPlanes() {
		if (!planeCanvas || !width || !height) return;
		const { c, ratio } = prepare(planeCanvas);
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (!planes?.length) return;
		const now = Date.now();
		const scale = zoom >= 9 ? 1.15 : zoom <= 5 ? 0.8 : 1;
		let picked = null;
		if (trailMinutes)
			for (const plane of planes) {
				if (plane.hex === selectedPlane) continue;
				const at = toScreen(plane.lat, plane.lon);
				if (at.x < -300 || at.y < -300 || at.x > width + 300 || at.y > height + 300) continue;
				drawTrail(c, plane, toScreen, {
					alpha: 0.55,
					width: 1.4,
					since: now - trailMinutes * 60000,
					now: planeNow(plane, now)
				});
			}
		for (const plane of planes) {
			const place = planeNow(plane, now);
			const { x, y } = toScreen(place.lat, place.lon);
			if (plane.hex === selectedPlane) {
				picked = { plane, place, x, y };
				continue;
			}
			if (x < -12 || y < -12 || x > width + 12 || y > height + 12) continue;
			drawPlane(c, x, y, plane.track, planeColour ?? altitudeColour(plane.alt, plane.ground), {
				scale,
				category: plane.category
			});
		}
		if (picked) {
			const { plane, place, x, y } = picked;
			// The route: dashed from where it took off (when its track isn't known) and on to
			// where it goes, like the flight radars show it
			const dashed = (points) => {
				c.save();
				c.setLineDash([6, 6]);
				c.lineWidth = 1.6;
				c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
				c.beginPath();
				points.forEach((p, i) => {
					const s = toScreen(p.lat, p.lon);
					if (i) c.lineTo(s.x, s.y);
					else c.moveTo(s.x, s.y);
				});
				c.stroke();
				c.restore();
			};
			if (route?.to) dashed(greatCircle(place, route.to));
			const first = track?.[0] ?? plane.trail[0];
			if (route?.from && first && (!track?.length || first.alt > 3000))
				dashed(greatCircle(route.from, first));
			drawTrail(c, plane, toScreen, { width: 3, now: place, track });
			c.beginPath();
			c.arc(x, y, 15 * scale, 0, Math.PI * 2);
			c.fillStyle = 'rgba(239, 68, 68, 0.22)';
			c.fill();
			drawPlane(c, x, y, plane.track, '#ef4444', {
				scale: scale * 1.35,
				category: plane.category,
				outline: '#ffffff'
			});
			if (plane.callsign) {
				c.font = '600 11px system-ui, sans-serif';
				const w = c.measureText(plane.callsign).width + 10;
				c.fillStyle = 'rgba(0, 0, 0, 0.75)';
				c.beginPath();
				c.roundRect(x + 16, y - 9, w, 18, 5);
				c.fill();
				c.fillStyle = '#ffffff';
				c.fillText(plane.callsign, x + 21, y + 4);
			}
		}
	}
	/** The plane under a point of the map (the nearest within a finger's width) */
	function planeAt(x, y) {
		if (!planes?.length) return null;
		const now = Date.now();
		let best = null;
		let bestDistance = 16;
		for (const plane of planes) {
			const place = planeNow(plane, now);
			const p = toScreen(place.lat, place.lon);
			const distance = Math.hypot(p.x - x, p.y - y);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = plane;
			}
		}
		return best;
	}

	onMount(() => {
		let frame = requestAnimationFrame(function loop() {
			drawLightning();
			drawQuakeLayer();
			drawPlanes();
			frame = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(frame);
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
	{#if weather}
		<WeatherField
			grid={weather.grid}
			layer={weather.layer}
			time={weather.time}
			fast={weather.playing}
			{lat}
			{lon}
			{zoom}
			{width}
			{height}
		/>
	{/if}
	{#each layerTiles as { layer, tiles: list } (layer.key)}
		{#each list as tile (tile.key)}
			<img
				use:radarSrc={{ layer, tile }}
				alt=""
				draggable="false"
				class="absolute max-w-none pointer-events-none"
				style="left: {tile.left}px; top: {tile.top}px; width: {tile.size}px; height: {tile.size}px; opacity: {layer.opacity ??
					1}"
			/>
		{/each}
	{/each}
	<RadarCanvas {radar} tiles={radarTiles} {width} {height} onready={onradarready} />
	{#if wind}
		<WindParticles
			grid={wind.grid}
			time={wind.time}
			opacity={wind.opacity ?? 1}
			{lat}
			{lon}
			{zoom}
			{width}
			{height}
		/>
	{/if}
	<canvas bind:this={areaCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
	<canvas bind:this={lineCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
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
	{#if weather}
		<WeatherMarks
			grid={weather.grid}
			layer={weather.layer}
			time={weather.time}
			labels={weather.labels}
			isobars={weather.isobars}
			{lat}
			{lon}
			{zoom}
			{width}
			{height}
		/>
	{/if}
	<canvas bind:this={lightningCanvas} class="absolute inset-0 size-full pointer-events-none"
	></canvas>
	<canvas bind:this={quakeCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
	<canvas bind:this={planeCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
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
