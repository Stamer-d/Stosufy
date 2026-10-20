<script>
	// A flight radar: the planes around you live (ADS-B from the community networks, see
	// flights.ts), moving smoothly between updates, coloured by height. Click one for its flight.
	import { onMount } from 'svelte';
	import { planesAround } from '#lib/flights.ts';
	import Widget from './MacWidget.svelte';
	import WidgetMap from './WidgetMap.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { worldPixel, distanceKm } from '#lib/map.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'flight-radar' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let zoom = $derived($widgetData[uid]?.zoom ?? 9);
	let asking = $state(false);
	let width = $state(336);
	let height = $state(336);
	let canvas = $state();
	let error = $state('');
	let count = $state(0);
	let selected = $state(null);

	/** By ICAO hex: where it was at the last update, and its trail */
	const planes = new Map();
	let lastUpdate = 0;

	/** One answer at a time (the networks answer one request at a time) */
	let loading = false;
	let loadAgain = false;
	/** `moved`: the place or zoom changed (loaded again once the answer on its way is here) */
	async function load(moved = false) {
		if (!place) return;
		if (loading) {
			loadAgain ||= moved;
			return;
		}
		const where = place;
		// What the view shows, as a radius in nautical miles (a bit more, for planes coming in)
		const kmPerPixel = (40075 * Math.cos((where.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
		const radius = Math.ceil(((Math.hypot(width, height) / 2) * kmPerPixel * 1.2) / 1.852);
		loading = true;
		loadAgain = false;
		try {
			const list = await planesAround(where.lat, where.lon, radius);
			// For a place left meanwhile: the next answer
			if (where === place) {
				update(list);
				error = '';
			}
		} catch {
			error = "Couldn't reach the flight data";
		} finally {
			loading = false;
			if (loadAgain) load(true);
		}
	}

	function update(list) {
		const now = performance.now();
		const seen = new Set();
		for (const ac of list) {
			if (ac.lat == null || ac.lon == null) continue;
			seen.add(ac.hex);
			const old = planes.get(ac.hex);
			const trail = old ? [...old.trail, [ac.lat, ac.lon]].slice(-40) : [[ac.lat, ac.lon]];
			planes.set(ac.hex, {
				hex: ac.hex,
				lat: ac.lat,
				lon: ac.lon,
				track: ac.track ?? ac.true_heading ?? old?.track ?? 0,
				speed: ac.gs ?? 0,
				ground: ac.alt_baro === 'ground',
				alt: typeof ac.alt_baro === 'number' ? ac.alt_baro : (ac.alt_geom ?? 0),
				callsign: (ac.flight ?? '').trim(),
				type: ac.t ?? '',
				registration: ac.r ?? '',
				desc: ac.desc ?? '',
				at: now,
				trail
			});
		}
		for (const hex of planes.keys()) if (!seen.has(hex)) planes.delete(hex);
		lastUpdate = now;
		count = planes.size;
		if (selected && !planes.has(selected.hex)) selected = null;
	}

	/** Where a plane is now: on from its last position along its track at its speed */
	function now(plane, time) {
		if (plane.ground || !plane.speed) return { lat: plane.lat, lon: plane.lon };
		const km = (plane.speed * 1.852 * Math.min(30, (time - plane.at) / 1000)) / 3600;
		const rad = (plane.track * Math.PI) / 180;
		const lat = plane.lat + (km * Math.cos(rad)) / 111.32;
		const lon = plane.lon + (km * Math.sin(rad)) / (111.32 * Math.cos((plane.lat * Math.PI) / 180));
		return { lat, lon };
	}

	/** Heights like on flight radars: low warm, high cool */
	function colour(plane) {
		if (plane.ground) return '#9ca3af';
		const t = Math.max(0, Math.min(1, plane.alt / 40000));
		const hue = 40 + t * 260;
		return `hsl(${hue} 95% 62%)`;
	}

	function drawPlane(c, x, y, angle, fill, big) {
		const s = big ? 1.5 : 1;
		c.save();
		c.translate(x, y);
		c.rotate(angle);
		c.scale(s, s);
		c.beginPath();
		// A small airliner from above, nose up
		c.moveTo(0, -8);
		c.lineTo(1.4, -5);
		c.lineTo(1.4, -1.5);
		c.lineTo(8, 2);
		c.lineTo(8, 3.5);
		c.lineTo(1.4, 1.8);
		c.lineTo(1, 5.5);
		c.lineTo(3.2, 7.2);
		c.lineTo(3.2, 8.2);
		c.lineTo(0, 7.4);
		c.lineTo(-3.2, 8.2);
		c.lineTo(-3.2, 7.2);
		c.lineTo(-1, 5.5);
		c.lineTo(-1.4, 1.8);
		c.lineTo(-8, 3.5);
		c.lineTo(-8, 2);
		c.lineTo(-1.4, -1.5);
		c.lineTo(-1.4, -5);
		c.closePath();
		c.fillStyle = fill;
		c.shadowColor = 'rgba(0,0,0,0.6)';
		c.shadowBlur = 4;
		c.fill();
		c.restore();
	}

	function draw() {
		if (!canvas || !place) return;
		const ratio = devicePixelRatio || 1;
		if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
			canvas.width = width * ratio;
			canvas.height = height * ratio;
		}
		const c = canvas.getContext('2d');
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.clearRect(0, 0, width, height);
		const centre = worldPixel(place.lat, place.lon, zoom);
		const toView = (lat, lon) => {
			const p = worldPixel(lat, lon, zoom);
			return [p.x - centre.x + width / 2, p.y - centre.y + height / 2];
		};
		// Range rings every 10 km
		const kmPerPixel = (40075 * Math.cos((place.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
		const ring = [5, 10, 25, 50, 100, 200].find((km) => km / kmPerPixel > 50) ?? 200;
		c.strokeStyle = 'rgba(255,255,255,0.08)';
		c.lineWidth = 1;
		for (let r = ring; r / kmPerPixel < Math.hypot(width, height) / 2; r += ring) {
			c.beginPath();
			c.arc(width / 2, height / 2, r / kmPerPixel, 0, Math.PI * 2);
			c.stroke();
		}
		const time = performance.now();
		const chosen = selected && planes.get(selected.hex);
		if (chosen) {
			// The way the selected plane came
			c.strokeStyle = colour(chosen);
			c.globalAlpha = 0.7;
			c.lineWidth = 2;
			c.beginPath();
			chosen.trail.forEach(([lat, lon], i) => {
				const [x, y] = toView(lat, lon);
				i ? c.lineTo(x, y) : c.moveTo(x, y);
			});
			const at = now(chosen, time);
			c.lineTo(...toView(at.lat, at.lon));
			c.stroke();
			c.globalAlpha = 1;
		}
		// High ones on top
		const sorted = [...planes.values()].sort((a, b) => a.alt - b.alt);
		for (const plane of sorted) {
			const at = now(plane, time);
			const [x, y] = toView(at.lat, at.lon);
			if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
			plane.view = [x, y];
			drawPlane(c, x, y, (plane.track * Math.PI) / 180, colour(plane), plane === chosen);
			if (zoom >= 10 && plane.callsign && plane !== chosen) {
				c.font = '600 9px system-ui, sans-serif';
				c.fillStyle = 'rgba(255,255,255,0.7)';
				c.fillText(plane.callsign, x + 9, y + 3);
			}
		}
	}

	function pick(event) {
		const rect = canvas.getBoundingClientRect();
		// In the widget's own pixels (it can be shown bigger or smaller)
		const x = ((event.clientX - rect.left) * width) / rect.width;
		const y = ((event.clientY - rect.top) * height) / rect.height;
		let best = null;
		let bestDistance = 16;
		for (const plane of planes.values()) {
			if (!plane.view) continue;
			const d = Math.hypot(plane.view[0] - x, plane.view[1] - y);
			if (d < bestDistance) {
				best = plane;
				bestDistance = d;
			}
		}
		selected = best ? { hex: best.hex } : null;
	}

	$effect(() => {
		void place;
		void zoom;
		planes.clear();
		selected = null;
		load(true);
	});

	onMount(() => {
		const timer = setInterval(() => load(), 8000);
		let frame;
		let last = 0;
		const loop = (t) => {
			frame = requestAnimationFrame(loop);
			// 30 frames a second are smooth enough for planes
			if (t - last < 33) return;
			last = t;
			draw();
		};
		frame = requestAnimationFrame(loop);
		return () => {
			clearInterval(timer);
			cancelAnimationFrame(frame);
		};
	});

	// The selected plane's numbers, refreshed with the data
	let info = $derived.by(() => {
		void count;
		const plane = selected && planes.get(selected.hex);
		if (!plane) return null;
		return {
			...plane,
			distance: place ? distanceKm(place, plane) : 0
		};
	});
	const setZoom = (z) => setWidgetData(uid, { zoom: Math.max(6, Math.min(12, z)) });
	const number = (n) => Math.round(n).toLocaleString();
</script>

<Widget size="large">
	{#if !place && !asking}
		<p class="mt-auto text-sm text-white/60">Finding where you are…</p>
	{:else if asking}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			<span class="icon-[mingcute--airplane-line] size-3.5"></span> Flight radar
		</p>
		<PlacePicker {uid} label="Show flights" ondone={() => (asking = false)} />
	{:else}
		<div class="absolute inset-0" bind:clientWidth={width} bind:clientHeight={height}>
			<WidgetMap lat={place.lat} lon={place.lon} {zoom} {width} {height}>
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<canvas bind:this={canvas} class="absolute inset-0 size-full cursor-pointer" onclick={pick}
				></canvas>
				<span
					class="absolute size-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white ring-4 ring-primary-400/50 left-1/2 top-1/2 pointer-events-none"
				></span>
			</WidgetMap>
			<div
				class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none"
			>
				<span class="icon-[mingcute--airplane-fill] size-4 text-amber-300"></span>
				<button
					class="text-sm font-semibold truncate cursor-pointer hover:underline pointer-events-auto"
					title="Change the city"
					onclick={() => (asking = true)}>{place.name}</button
				>
				<span class="ms-auto flex items-center gap-1.5 text-xs tabular-nums text-white/70">
					{#if error}
						{error}
					{:else}
						<span class="size-1.5 rounded-full bg-red-500 animate-pulse"></span>
						{count} planes
					{/if}
				</span>
			</div>
			{#if info}
				<div
					class="absolute bottom-14 left-3 right-3 p-3 rounded-2xl bg-black/70 backdrop-blur ring-1 ring-white/10"
				>
					<div class="flex items-baseline gap-2">
						<p class="text-base font-extrabold">{info.callsign || info.registration || info.hex}</p>
						<p class="text-xs text-white/60 truncate">{info.desc || info.type}</p>
						<button
							class="ms-auto grid place-items-center size-5 rounded-full hover:bg-white/10 cursor-pointer"
							aria-label="Close"
							onclick={() => (selected = null)}
							><span class="icon-[mingcute--close-line] size-3.5"></span></button
						>
					</div>
					<div class="mt-1 grid grid-cols-4 gap-2 text-xs">
						{#each [['Altitude', info.ground ? 'Ground' : `${number(info.alt)} ft`], ['Speed', `${number(info.speed)} kt`], ['Heading', `${number(info.track)}°`], ['Distance', `${number(info.distance)} km`]] as [label, value] (label)}
							<div>
								<p class="text-[10px] uppercase text-white/45">{label}</p>
								<p class="font-semibold tabular-nums">{value}</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<div class="absolute bottom-3 left-3 right-3 flex items-center gap-2 pointer-events-none">
				<!-- Height colours -->
				<div class="flex-1 flex flex-col gap-0.5">
					<span
						class="h-1.5 rounded-full"
						style="background: linear-gradient(90deg, hsl(40 95% 62%), hsl(170 95% 62%), hsl(300 95% 62%))"
					></span>
					<span class="flex justify-between text-[9px] text-white/50"
						><span>0 ft</span><span>40,000 ft</span></span
					>
				</div>
				<div class="flex rounded-full bg-black/50 backdrop-blur pointer-events-auto">
					<button
						class="grid place-items-center size-8 cursor-pointer hover:text-primary-300"
						aria-label="Zoom out"
						onclick={() => setZoom(zoom - 1)}
						><span class="icon-[mingcute--minimize-line] size-4"></span></button
					>
					<button
						class="grid place-items-center size-8 cursor-pointer hover:text-primary-300"
						aria-label="Zoom in"
						onclick={() => setZoom(zoom + 1)}
						><span class="icon-[mingcute--add-line] size-4"></span></button
					>
				</div>
			</div>
		</div>
	{/if}
</Widget>
