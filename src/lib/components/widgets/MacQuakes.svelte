<script>
	// Earthquakes around you (from the EMSC, live; see stores/quakes.ts): the quakes of the last
	// week on a map, how many there were near you and the latest one. Click one for what it was.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import WidgetMap from './WidgetMap.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { quakes, quakeStatus, useQuakes } from '#lib/stores/quakes.ts';
	import { drawQuakes, quakeAt, magColour, quakeAgo } from '#lib/quakes.ts';
	import { worldPixel, distanceKm, bearing } from '#lib/map.ts';
	import { compass } from '#lib/storm.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'quakes' } = $props();

	const RADIUS_KM = 500;
	const SCALE = 0.9;
	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let zoom = $derived($widgetData[uid]?.zoom ?? 5);
	let asking = $state(false);
	let width = $state(336);
	let height = $state(336);
	let canvas = $state();
	let selectedId = $state(null);
	let now = $state(Date.now());

	/** The quakes near you, newest first */
	let near = $derived(
		place
			? $quakes.filter(
					(q) => Math.abs(q.lat - place.lat) < RADIUS_KM / 100 && distanceKm(place, q) <= RADIUS_KM
				)
			: []
	);
	let selected = $derived(selectedId ? ($quakes.find((q) => q.id === selectedId) ?? null) : null);
	const away = (q) =>
		place
			? `${Math.round(distanceKm(place, q)).toLocaleString()} km ${compass(bearing(place, q))}`
			: '';

	function toScreenOf() {
		const centre = worldPixel(place.lat, place.lon, zoom);
		return (lat, lon) => {
			const p = worldPixel(lat, lon, zoom);
			return { x: p.x - centre.x + width / 2, y: p.y - centre.y + height / 2 };
		};
	}
	/** The world east and west of this one (for places near the date line) */
	let shifts = $derived([-1, 0, 1].map((n) => n * 256 * 2 ** zoom));

	function draw() {
		if (!canvas || !place) return;
		const ratio = devicePixelRatio || 1;
		if (canvas.width !== width * ratio) canvas.width = width * ratio;
		if (canvas.height !== height * ratio) canvas.height = height * ratio;
		const c = canvas.getContext('2d');
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.clearRect(0, 0, width, height);
		// The area counted as near you
		const kmPerPixel = (40075 * Math.cos((place.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
		c.strokeStyle = 'rgba(252, 211, 77, 0.3)';
		c.setLineDash([4, 4]);
		c.beginPath();
		c.arc(width / 2, height / 2, RADIUS_KM / kmPerPixel, 0, Math.PI * 2);
		c.stroke();
		c.setLineDash([]);
		drawQuakes(c, $quakes, toScreenOf(), width, height, {
			shifts,
			selected: selectedId,
			scale: SCALE
		});
	}

	function pick(event) {
		if (!place) return;
		const rect = canvas.getBoundingClientRect();
		// In the widget's own pixels (it can be shown bigger or smaller)
		const x = ((event.clientX - rect.left) * width) / rect.width;
		const y = ((event.clientY - rect.top) * height) / rect.height;
		const quake = quakeAt($quakes, toScreenOf(), x, y, { shifts, scale: SCALE });
		selectedId = quake && quake.id !== selectedId ? quake.id : null;
	}

	// Drawn again when something changed; smoothly while a new quake near you pulses
	let dirty = true;
	$effect(() => {
		void $quakes;
		void place;
		void zoom;
		void width;
		void height;
		void selectedId;
		dirty = true;
	});
	let pulsing = $derived(near.some((q) => now - q.time < 60 * 60 * 1000));

	onMount(() => {
		const stop = useQuakes();
		let frame;
		let last = 0;
		const loop = (t) => {
			frame = requestAnimationFrame(loop);
			if (!dirty && t - last < (pulsing ? 33 : 1000)) return;
			dirty = false;
			last = t;
			draw();
		};
		frame = requestAnimationFrame(loop);
		const clock = setInterval(() => (now = Date.now()), 30000);
		return () => {
			stop();
			cancelAnimationFrame(frame);
			clearInterval(clock);
		};
	});
	const setZoom = (z) => setWidgetData(uid, { zoom: Math.max(3, Math.min(9, z)) });
	const depthText = (km) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
</script>

<Widget size="large">
	{#if !place && !asking}
		<p class="mt-auto text-sm text-white/60">Finding where you are…</p>
	{:else if asking}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			<span class="icon-[ri--earthquake-line] size-3.5"></span> Earthquakes
		</p>
		<PlacePicker {uid} label="Show earthquakes" ondone={() => (asking = false)} />
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
				class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 bg-gradient-to-b from-black/75 to-transparent pointer-events-none"
			>
				<span class="icon-[ri--earthquake-fill] size-4 text-amber-300"></span>
				<button
					class="text-sm font-semibold truncate cursor-pointer hover:underline pointer-events-auto"
					title="Change the city"
					onclick={() => (asking = true)}>{place.name}</button
				>
				<span class="ms-auto flex items-center gap-1.5 text-xs text-white/70">
					{#if $quakeStatus.state === 'live'}
						<span class="size-1.5 rounded-full bg-red-500 animate-pulse"></span> Live
					{:else if $quakeStatus.state === 'error'}
						Not reachable
					{:else if $quakeStatus.state === 'loading' && !$quakes.length}
						Loading…
					{/if}
				</span>
				<button
					class="grid place-items-center size-6 shrink-0 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer pointer-events-auto"
					title="Open the earthquakes in the world center"
					aria-label="Open the earthquakes in the world center"
					onclick={() => goto('/world?category=earth')}
					><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
				>
			</div>
			<div class="absolute bottom-3 left-3 right-3 flex items-end gap-2">
				{#if selected}
					<div
						class="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 rounded-2xl bg-black/70 backdrop-blur ring-1 ring-white/10"
					>
						<span
							class="grid place-items-center w-10 h-9 shrink-0 rounded-xl text-sm font-extrabold tabular-nums text-black"
							style="background: {magColour(selected.mag)}">{selected.mag.toFixed(1)}</span
						>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-bold truncate">{selected.region || 'Earthquake'}</p>
							<p class="text-[11px] text-white/65 truncate tabular-nums">
								{quakeAgo(selected.time, now)} · {depthText(selected.depth)} deep · {away(selected)}
							</p>
						</div>
						<button
							class="grid place-items-center size-7 shrink-0 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
							title="Show it in the world center"
							aria-label="Show it in the world center"
							onclick={() => goto(`/world?quake=${encodeURIComponent(selected.id)}`)}
							><span class="icon-[mingcute--arrow-right-up-line] size-4"></span></button
						>
					</div>
				{:else}
					<div class="flex-1 min-w-0 px-3 py-2 rounded-2xl bg-black/60 backdrop-blur">
						<p class="text-lg font-extrabold tabular-nums leading-tight">
							{near.length}
							<span class="text-xs font-semibold text-white/60"
								>quakes · {RADIUS_KM} km · 7 days</span
							>
						</p>
						<p class="text-xs text-white/70 truncate">
							{#if near[0]}
								Latest <strong style="color: {magColour(near[0].mag)}"
									>M{near[0].mag.toFixed(1)}</strong
								>
								{away(near[0])}, {quakeAgo(near[0].time, now)}
							{:else if $quakes.length}
								None near you this week
							{:else if $quakeStatus.state === 'error'}
								Couldn't reach the earthquake data
							{:else}
								Loading the quakes…
							{/if}
						</p>
					</div>
				{/if}
				<div class="flex flex-col rounded-full bg-black/60 backdrop-blur">
					<button
						class="grid place-items-center size-8 cursor-pointer hover:text-primary-300"
						aria-label="Zoom in"
						onclick={() => setZoom(zoom + 1)}
						><span class="icon-[mingcute--add-line] size-4"></span></button
					>
					<button
						class="grid place-items-center size-8 cursor-pointer hover:text-primary-300"
						aria-label="Zoom out"
						onclick={() => setZoom(zoom - 1)}
						><span class="icon-[mingcute--minimize-line] size-4"></span></button
					>
				</div>
			</div>
		</div>
	{/if}
</Widget>
