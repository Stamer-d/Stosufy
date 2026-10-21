<script>
	// Live lightning around you (Blitzortung.org): the strikes of the last half hour, how many
	// there were near you and where the nearest one was
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import WidgetMap from './WidgetMap.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { strikes, lightningStatus, useLightning, strikesNear } from '#lib/stores/lightning.ts';
	import { drawStrikes, compass } from '#lib/storm.ts';
	import { worldPixel } from '#lib/map.ts';
	import { thunderOn, toggleThunder, setListener } from '#lib/stores/thunder.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'lightning' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let zoom = $derived($widgetData[uid]?.zoom ?? 7);
	let asking = $state(false);
	let width = $state(336);
	let height = $state(336);
	let canvas = $state();

	let near = $derived(place ? strikesNear($strikes, place, 50, 15 * 60 * 1000) : null);

	function draw() {
		if (!canvas || !place) return;
		const ratio = devicePixelRatio || 1;
		if (canvas.width !== width * ratio) canvas.width = width * ratio;
		if (canvas.height !== height * ratio) canvas.height = height * ratio;
		const c = canvas.getContext('2d');
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.clearRect(0, 0, width, height);
		const centre = worldPixel(place.lat, place.lon, zoom);
		const toScreen = (lat, lon) => {
			const p = worldPixel(lat, lon, zoom);
			return { x: p.x - centre.x + width / 2, y: p.y - centre.y + height / 2 };
		};
		// 50 km around you
		const kmPerPixel = (40075 * Math.cos((place.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
		c.strokeStyle = 'rgba(253, 224, 71, 0.35)';
		c.setLineDash([4, 4]);
		c.beginPath();
		c.arc(width / 2, height / 2, 50 / kmPerPixel, 0, Math.PI * 2);
		c.stroke();
		c.setLineDash([]);
		drawStrikes(c, $strikes, toScreen, width, height, 1, kmPerPixel);
	}

	$effect(() => setListener(place));

	onMount(() => {
		const stop = useLightning();
		const timer = setInterval(draw, 100);
		return () => {
			stop();
			clearInterval(timer);
		};
	});
	const setZoom = (z) => setWidgetData(uid, { zoom: Math.max(4, Math.min(10, z)) });
</script>

<Widget size="large">
	{#if !place && !asking}
		<p class="mt-auto text-sm text-white/60">Finding where you are…</p>
	{:else if asking}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			<span class="icon-[mingcute--flash-line] size-3.5"></span> Lightning
		</p>
		<PlacePicker {uid} label="Show lightning" ondone={() => (asking = false)} />
	{:else}
		<div class="absolute inset-0" bind:clientWidth={width} bind:clientHeight={height}>
			<WidgetMap lat={place.lat} lon={place.lon} {zoom} {width} {height}>
				<canvas bind:this={canvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
				<span
					class="absolute size-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white ring-4 ring-primary-400/50 left-1/2 top-1/2 pointer-events-none"
				></span>
			</WidgetMap>
			<div
				class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 bg-gradient-to-b from-black/75 to-transparent"
			>
				<span
					class="icon-[mingcute--flash-fill] size-4 {$lightningStatus === 'live'
						? 'text-yellow-300'
						: 'text-white/40'}"
				></span>
				<button
					class="text-sm font-semibold truncate cursor-pointer hover:underline"
					title="Change the city"
					onclick={() => (asking = true)}>{place.name}</button
				>
				<span class="ms-auto flex items-center gap-1.5 text-xs text-white/70">
					{#if $lightningStatus === 'live'}
						<span class="size-1.5 rounded-full bg-red-500 animate-pulse"></span> Live
					{:else}
						{$lightningStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
					{/if}
				</span>
				<button
					class="grid place-items-center size-6 shrink-0 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
					title="Open the world center"
					aria-label="Open the world center"
					onclick={() => goto('/world?category=weather')}
					><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
				>
			</div>
			<div class="absolute bottom-3 left-3 right-3 flex items-end gap-2">
				<div class="flex-1 px-3 py-2 rounded-2xl bg-black/60 backdrop-blur">
					<p class="text-lg font-extrabold tabular-nums leading-tight">
						{near?.count ?? 0}
						<span class="text-xs font-semibold text-white/60">strikes · 50 km · 15 min</span>
					</p>
					<p class="text-xs text-white/70 truncate">
						{#if near?.nearest}
							Nearest <strong class="text-white"
								>{Math.round(near.nearest.km)} km {compass(near.nearest.bearing)}</strong
							>, {Math.max(0, Math.round((Date.now() - near.nearest.time) / 60000))} min ago
						{:else}
							No lightning near you
						{/if}
					</p>
				</div>
				<button
					class="grid place-items-center size-8 shrink-0 rounded-full backdrop-blur cursor-pointer {$thunderOn
						? 'bg-yellow-300 text-black'
						: 'bg-black/60 text-white/70 hover:text-white'}"
					title={$thunderOn ? 'Lightning sound off' : 'Hear the lightning (and its thunder)'}
					aria-pressed={$thunderOn}
					onclick={toggleThunder}
					><span
						class="{$thunderOn
							? 'icon-[mingcute--volume-fill]'
							: 'icon-[mingcute--volume-off-line]'} size-4"
					></span></button
				>
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
