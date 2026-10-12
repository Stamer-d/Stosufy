<script>
	// The rain radar around you, the last two hours as a loop (RainViewer), on a dark map
	import { onMount } from 'svelte';
	import { strikes, useLightning } from '#lib/stores/lightning.ts';
	import { drawStrikes } from '#lib/storm.ts';
	import { worldPixel } from '#lib/map.ts';
	import { fetch } from '@tauri-apps/plugin-http';
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import WidgetMap from './WidgetMap.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'rain-radar' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	// RainViewer's radar goes up to zoom 7
	let zoom = $derived($widgetData[uid]?.zoom ?? 6);
	let asking = $state(false);
	let frames = $state([]);
	let host = $state('');
	let shown = $state(0);
	let playing = $state(true);
	let error = $state('');
	let width = $state(336);
	let height = $state(336);

	async function load() {
		try {
			const data = await (
				await fetch('https://api.rainviewer.com/public/weather-maps.json')
			).json();
			host = data.host;
			frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
			shown = Math.max(0, (data.radar?.past?.length ?? 1) - 1);
			error = '';
		} catch {
			error = "Couldn't load the radar";
		}
	}

	// Lightning over the radar
	let canvas = $state();
	function drawLightning() {
		if (!canvas || !place) return;
		const ratio = devicePixelRatio || 1;
		if (canvas.width !== width * ratio) canvas.width = width * ratio;
		if (canvas.height !== height * ratio) canvas.height = height * ratio;
		const c = canvas.getContext('2d');
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.clearRect(0, 0, width, height);
		const centre = worldPixel(place.lat, place.lon, zoom);
		drawStrikes(
			c,
			$strikes,
			(lat, lon) => {
				const p = worldPixel(lat, lon, zoom);
				return { x: p.x - centre.x + width / 2, y: p.y - centre.y + height / 2 };
			},
			width,
			height
		);
	}

	onMount(() => {
		const stopLightning = useLightning();
		const lightningTimer = setInterval(drawLightning, 150);
		load();
		const refresh = setInterval(load, 5 * 60 * 1000);
		// The loop: a frame every half second, a pause on the newest
		let wait = 0;
		const step = setInterval(() => {
			if (!playing || frames.length < 2) return;
			if (shown === frames.length - 1 && wait++ < 3) return;
			wait = 0;
			shown = (shown + 1) % frames.length;
		}, 500);
		return () => {
			stopLightning();
			clearInterval(lightningTimer);
			clearInterval(refresh);
			clearInterval(step);
		};
	});

	// All frames are layers, only one seen: switching is instant, the tiles are loaded
	let layers = $derived(
		frames.map((frame, i) => ({
			key: frame.path,
			url: (z, x, y) => `${host}${frame.path}/256/${z}/${x}/${y}/2/1_1.png`,
			opacity: i === shown ? 0.8 : 0,
			clean: true
		}))
	);
	const ago = (time) => {
		const minutes = Math.round((Date.now() / 1000 - time) / 60);
		return minutes <= 0 ? (minutes < -2 ? `in ${-minutes} min` : 'now') : `${minutes} min ago`;
	};
	const setZoom = (z) => setWidgetData(uid, { zoom: Math.max(3, Math.min(7, z)) });
</script>

<Widget size="large">
	{#if !place && !asking}
		<p class="mt-auto text-sm text-white/60">Finding where you are…</p>
	{:else if asking}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			<span class="icon-[mingcute--rainstorm-line] size-3.5"></span> Rain radar
		</p>
		<PlacePicker {uid} label="Show radar" ondone={() => (asking = false)} />
	{:else}
		<div class="absolute inset-0" bind:clientWidth={width} bind:clientHeight={height}>
			<WidgetMap lat={place.lat} lon={place.lon} {zoom} {width} {height} {layers}>
				<canvas bind:this={canvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
				<span
					class="absolute size-3 -ml-1.5 -mt-1.5 rounded-full bg-white ring-4 ring-primary-400/60 left-1/2 top-1/2"
				></span>
			</WidgetMap>
			<div
				class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent"
			>
				<span class="icon-[mingcute--rainstorm-line] size-4 text-sky-300"></span>
				<button
					class="text-sm font-semibold truncate cursor-pointer hover:underline"
					title="Change the city"
					onclick={() => (asking = true)}>{place.name}</button
				>
				<span class="ms-auto text-xs tabular-nums text-white/70"
					>{frames[shown] ? ago(frames[shown].time) : error || 'Loading…'}</span
				>
				<button
					class="grid place-items-center size-6 shrink-0 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
					title="Open the storm center"
					aria-label="Open the storm center"
					onclick={() => goto('/storm')}
					><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
				>
			</div>
			<div class="absolute bottom-3 left-3 right-3 flex items-center gap-2">
				<button
					class="grid place-items-center size-8 rounded-full bg-black/50 backdrop-blur cursor-pointer hover:bg-black/70"
					aria-label={playing ? 'Pause' : 'Play'}
					onclick={() => (playing = !playing)}
				>
					<span
						class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-4"
					></span>
				</button>
				<div class="flex-1 flex gap-0.5">
					{#each frames as frame, i (frame.path)}
						<button
							class="flex-1 h-1.5 rounded-full cursor-pointer {i === shown
								? 'bg-white'
								: frame.time > Date.now() / 1000
									? 'bg-sky-300/40'
									: 'bg-white/30'}"
							aria-label={ago(frame.time)}
							onclick={() => {
								shown = i;
								playing = false;
							}}
						></button>
					{/each}
				</div>
				<div class="flex rounded-full bg-black/50 backdrop-blur">
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
