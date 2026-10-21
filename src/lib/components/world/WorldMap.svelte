<script>
	// The big map of the world center: drag to move, scroll to zoom, click to look at a place.
	// Tile layers (radar, satellite) can have a lower top zoom than the map: their tiles are
	// then shown bigger. Forecast fields are drawn from a grid of points, the DWD warnings
	// as areas, lightning as it strikes, planes where they fly (moving on between updates),
	// earthquakes as circles by their size (and lines like the plates' boundaries under them),
	// and whatever the trackers put on it (see world/features.ts; those that move every frame).
	import { onMount } from 'svelte';
	import { worldPixel, fromWorldPixel, TILE, baseTile, labelTile } from '#lib/map.ts';
	import { drawStrikes, SEVERITY_COLOURS } from '#lib/storm.ts';
	import { radarSrc } from '#lib/radarClean.ts';
	import RadarCanvas from '../storm/RadarCanvas.svelte';
	import { planeNow, drawPlane, drawTrail, altitudeColour, greatCircle } from '#lib/flights.ts';
	import { drawQuakes, quakeAt } from '#lib/quakes.ts';
	import { drawShapes, drawShapesUnder, featureAt } from '#lib/world/features.ts';

	/**
	 * @type {{
	 *   lat: number, lon: number, zoom: number,
	 *   minZoom?: number, maxZoom?: number,
	 *   layers?: { key: string, url: (z: number, x: number, y: number) => string, opacity?: number, maxZoom?: number, clean?: boolean }[],
	 *   field?: { rows: { lat: number, lon: number, value: number }[][], colour: (v: number) => number[] } | null,
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
	 *   features?: import('#lib/world/types.ts').Feature[],
	 *   movers?: import('#lib/world/types.ts').Feature[],
	 *   selectedFeature?: string | null,
	 *   onfeature?: (feature: import('#lib/world/types.ts').Feature) => void,
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
		minZoom = 3,
		maxZoom = 11,
		layers = [],
		field = null,
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
		features = [],
		movers = [],
		selectedFeature = null,
		onfeature = () => {},
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
	let planeCanvas = $state();
	let quakeCanvas = $state();
	let lineCanvas = $state();
	let featureCanvas = $state();
	let moverCanvas = $state();

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
			const plane = planeAt(x, y);
			const quake =
				!plane && quakes?.length
					? quakeAt(quakes, toScreen, x, y, { shifts, scale: quakeScale })
					: null;
			const feature =
				!plane && !quake && (movers.length || features.length)
					? featureAt([...features, ...movers], toScreen, x, y, toPlace(x, y), { shifts })
					: null;
			if (plane) onplane(plane);
			else if (quake) onquake(quake);
			else if (feature) onfeature(feature);
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

	// --- A forecast field --------------------------------------------------------------------
	$effect(() => {
		if (!fieldCanvas || !width || !height) return;
		// Drawn small and shown smoothly scaled up
		const step = 3;
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

	// --- The trackers' features: those that stay drawn again when something changed (often
	// while some pulse), those that move on every frame ------------------------------------------
	let featuresDrawn = '';
	let featuresDrawnFor = null;
	let featuresDrawnAt = 0;
	let featuresPulse = $derived(features.some((f) => f.pulse));
	function drawFeatureLayer() {
		if (!featureCanvas || !width || !height) return;
		if (!features.length && !featuresDrawnFor?.length) return;
		const now = performance.now();
		const key = `${centre.x},${centre.y},${zoom},${width},${height},${selectedFeature}`;
		if (
			key === featuresDrawn &&
			features === featuresDrawnFor &&
			now - featuresDrawnAt < (featuresPulse ? 50 : 1000)
		)
			return;
		featuresDrawn = key;
		featuresDrawnFor = features;
		featuresDrawnAt = now;
		const { c, ratio } = prepare(featureCanvas);
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (!features.length) return;
		const options = { shifts, zoom, selected: selectedFeature };
		drawShapesUnder(c, features, toScreen, options);
		drawShapes(c, features, toScreen, width, height, options);
	}
	let moversDrawnAt = 0;
	let moversEmpty = true;
	function drawMoverLayer() {
		if (!moverCanvas || !width || !height) return;
		if (!movers.length && moversEmpty) return;
		const now = performance.now();
		// 30 frames a second are smooth enough
		if (now - moversDrawnAt < 33) return;
		moversDrawnAt = now;
		const { c, ratio } = prepare(moverCanvas);
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		moversEmpty = !movers.length;
		if (!movers.length) return;
		const options = { shifts, zoom, selected: selectedFeature, now: Date.now() };
		drawShapesUnder(c, movers, toScreen, options);
		drawShapes(c, movers, toScreen, width, height, options);
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
			drawFeatureLayer();
			drawQuakeLayer();
			drawMoverLayer();
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
	<canvas bind:this={fieldCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
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
	<canvas bind:this={lightningCanvas} class="absolute inset-0 size-full pointer-events-none"
	></canvas>
	<canvas bind:this={featureCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
	<canvas bind:this={quakeCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
	<canvas bind:this={moverCanvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
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
