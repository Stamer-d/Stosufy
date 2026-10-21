<script>
	// The ISS where it is now over the world (worked out from its orbit), its path, and when it
	// flies over you next
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import WidgetMap from './WidgetMap.svelte';
	import { widgetData, placeOf, detectedPlace } from '#lib/stores/widgetData.ts';
	import { issOrbit, positionOf, passes } from '#lib/world/sources/space.ts';
	import { worldPixel } from '#lib/map.ts';
	import { compass } from '#lib/storm.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'iss' } = $props();

	const ZOOM = 1;
	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let width = $state(336);
	let height = $state(336);
	let canvas = $state();
	let satrec = $state.raw(null);
	let error = $state('');
	let centre = $state({ lat: 0, lon: 0 });
	let now = $state(Date.now());
	let iss = $derived(satrec ? positionOf(satrec, now) : null);
	// The passes are worked out again every few minutes (thousands of positions)
	let passClock = $state(Date.now());
	let over = $derived.by(() => {
		void passClock;
		return satrec && place ? passes(satrec, place, 72).slice(0, 2) : [];
	});

	function draw() {
		if (!canvas || !satrec) return;
		const ratio = devicePixelRatio || 1;
		if (canvas.width !== width * ratio) canvas.width = width * ratio;
		if (canvas.height !== height * ratio) canvas.height = height * ratio;
		const c = canvas.getContext('2d');
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.clearRect(0, 0, width, height);
		const middle = worldPixel(centre.lat, centre.lon, ZOOM);
		const world = 256 * 2 ** ZOOM;
		const toView = (lat, lon) => {
			const p = worldPixel(lat, lon, ZOOM);
			// The copy of the world nearest to the middle
			const x = p.x - middle.x;
			return [x - Math.round(x / world) * world + width / 2, p.y - middle.y + height / 2];
		};
		const t = Date.now();
		// Its path: the last 45 minutes faint, the next 90 bright
		for (const [from, to, alpha] of [
			[-45, 0, 0.3],
			[0, 90, 0.85]
		]) {
			c.beginPath();
			let last = null;
			for (let m = from; m <= to; m += 1) {
				const p = positionOf(satrec, t + m * 60000);
				if (!p) continue;
				const [x, y] = toView(p.lat, p.lon);
				if (last === null || Math.abs(x - last) > width / 2) c.moveTo(x, y);
				else c.lineTo(x, y);
				last = x;
			}
			c.strokeStyle = `rgba(253, 224, 71, ${alpha})`;
			c.lineWidth = 2;
			c.stroke();
		}
		if (place) {
			const [x, y] = toView(place.lat, place.lon);
			c.beginPath();
			c.arc(x, y, 4, 0, Math.PI * 2);
			c.fillStyle = '#38bdf8';
			c.fill();
		}
		const p = positionOf(satrec, t);
		if (p) {
			const [x, y] = toView(p.lat, p.lon);
			c.beginPath();
			c.arc(x, y, 10 + ((t % 2000) / 2000) * 10, 0, Math.PI * 2);
			c.strokeStyle = `rgba(253, 224, 71, ${1 - (t % 2000) / 2000})`;
			c.stroke();
			c.beginPath();
			c.arc(x, y, 6, 0, Math.PI * 2);
			c.fillStyle = '#fde047';
			c.fill();
			c.strokeStyle = '#000';
			c.lineWidth = 1.5;
			c.stroke();
		}
	}

	onMount(() => {
		const controller = new AbortController();
		const load = () =>
			issOrbit(controller.signal)
				.then((s) => {
					satrec = s;
					error = s ? '' : 'The ISS’s orbit isn’t there';
				})
				.catch(() => !controller.signal.aborted && (error = "Couldn't load the ISS"));
		load();
		const reload = setInterval(load, 6 * 60 * 60 * 1000);
		const passTimer = setInterval(() => (passClock = Date.now()), 5 * 60 * 1000);
		// The map follows the ISS, its numbers every few seconds
		const follow = setInterval(() => {
			now = Date.now();
			if (iss) centre = { lat: Math.max(-60, Math.min(60, iss.lat)), lon: iss.lon };
		}, 5000);
		let frame = requestAnimationFrame(function loop() {
			draw();
			frame = requestAnimationFrame(loop);
		});
		return () => {
			controller.abort();
			clearInterval(reload);
			clearInterval(passTimer);
			clearInterval(follow);
			cancelAnimationFrame(frame);
		};
	});
	$effect(() => {
		if (iss && centre.lat === 0 && centre.lon === 0) centre = { lat: iss.lat, lon: iss.lon };
	});
	const when = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<Widget size="large">
	<div class="absolute inset-0" bind:clientWidth={width} bind:clientHeight={height}>
		<WidgetMap lat={centre.lat} lon={centre.lon} zoom={ZOOM} {width} {height}>
			<canvas bind:this={canvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
		</WidgetMap>
		<div
			class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 bg-gradient-to-b from-black/75 to-transparent"
		>
			<span class="icon-[ri--space-ship-line] size-4 text-yellow-300"></span>
			<span class="text-sm font-semibold">ISS</span>
			{#if iss}
				<span class="text-xs text-white/60 tabular-nums"
					>{Math.round(iss.height)} km · {Math.round(iss.speed * 3600).toLocaleString()} km/h</span
				>
			{/if}
			<button
				class="ms-auto grid place-items-center size-6 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
				title="Open the space map"
				aria-label="Open the space map"
				onclick={() => goto('/world?category=space')}
				><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
			>
		</div>
		<div class="absolute bottom-3 left-3 right-3 px-3 py-2 rounded-2xl bg-black/60 backdrop-blur">
			{#if error}
				<p class="text-sm text-white/70">{error}</p>
			{:else if !satrec}
				<p class="text-sm text-white/70">Finding the ISS…</p>
			{:else if over.length}
				<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">
					Over {place?.name ?? 'you'} next
				</p>
				{#each over as p (p.start)}
					<p class="flex items-baseline gap-2 text-sm tabular-nums">
						<span class="font-bold">{when(p.start)}</span>
						<span class="text-xs text-white/60"
							>{compass(p.from)} → {compass(p.to)} · {Math.round((p.end - p.start) / 60000)} min</span
						>
						<span class="ms-auto font-bold">{Math.round(p.maxElevation)}°</span>
					</p>
				{/each}
			{:else}
				<p class="text-sm text-white/70">Not over {place?.name ?? 'you'} in the next 3 days</p>
			{/if}
		</div>
	</div>
</Widget>
