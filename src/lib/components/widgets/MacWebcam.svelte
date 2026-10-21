<script>
	// A public webcam's live picture: the one put here from the world center, else the
	// cameras nearest to your place (to page through)
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { publicCameras, cameraSource } from '#lib/world/sources/cameras.ts';
	import { distanceKm } from '#lib/map.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'webcam' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let chosen = $derived($widgetData[uid]?.camera ?? null);
	let nearest = $state([]);
	let index = $state(0);
	let error = $state('');

	$effect(() => {
		const p = place;
		if (chosen || !p) return;
		const controller = new AbortController();
		publicCameras(controller.signal)
			.then((list) => {
				nearest = [...list].sort((a, b) => distanceKm(p, a) - distanceKm(p, b)).slice(0, 10);
				error = nearest.length ? '' : 'No public camera found';
			})
			.catch(() => !controller.signal.aborted && (error = "Couldn't load the cameras"));
		return () => controller.abort();
	});

	let camera = $derived(chosen ?? nearest[index % Math.max(1, nearest.length)] ?? null);
	let stamp = $state(Date.now());
	let broken = $state(false);
	$effect(() => {
		void camera;
		broken = false;
		const timer = setInterval(() => (stamp = Date.now()), camera?.every ?? 60000);
		return () => clearInterval(timer);
	});
	let src = $derived(
		camera
			? `${camera.image}${camera.image.includes('?') ? '&' : '?'}t=${Math.floor(stamp / 1000)}`
			: ''
	);
</script>

<Widget size="large" class="!p-0">
	{#if camera}
		{#if broken}
			<p class="absolute inset-0 grid place-items-center text-xs text-white/50">
				The picture can't be shown right now
			</p>
		{:else}
			<img
				{src}
				alt={camera.title}
				class="absolute inset-0 size-full object-cover"
				onerror={() => (broken = true)}
				onload={() => (broken = false)}
			/>
		{/if}
		<div
			class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 bg-gradient-to-b from-black/75 to-transparent"
		>
			<span class="size-1.5 rounded-full bg-red-500 animate-pulse"></span>
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-semibold truncate">{camera.title}</span>
				<span class="block text-[11px] text-white/60 truncate"
					>{[camera.where, cameraSource(camera)].filter(Boolean).join(' · ')}</span
				>
			</span>
			<button
				class="grid place-items-center size-6 shrink-0 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
				title="Open the cameras map"
				aria-label="Open the cameras map"
				onclick={() => goto('/world?category=cameras')}
				><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
			>
		</div>
		<div class="absolute bottom-3 right-3 flex rounded-full bg-black/60 backdrop-blur">
			{#if chosen}
				<button
					class="h-8 px-3 rounded-full text-xs font-semibold cursor-pointer hover:text-primary-300"
					title="Show the cameras near your place instead"
					onclick={() => setWidgetData(uid, { camera: null })}>Near me</button
				>
			{:else if nearest.length > 1}
				<button
					class="grid place-items-center size-8 cursor-pointer hover:text-primary-300"
					aria-label="The camera before"
					onclick={() => (index = (index + nearest.length - 1) % nearest.length)}
					><span class="icon-[mingcute--left-line] size-4"></span></button
				>
				<button
					class="grid place-items-center size-8 cursor-pointer hover:text-primary-300"
					aria-label="The next camera"
					onclick={() => (index = (index + 1) % nearest.length)}
					><span class="icon-[mingcute--right-line] size-4"></span></button
				>
			{/if}
		</div>
	{:else}
		<div class="p-4 flex flex-col h-full">
			<p
				class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500"
			>
				<span class="icon-[mingcute--video-camera-line] size-3.5"></span> Webcam
			</p>
			<p class="mt-auto text-sm text-white/60">{error || 'Finding a camera near you…'}</p>
		</div>
	{/if}
</Widget>
