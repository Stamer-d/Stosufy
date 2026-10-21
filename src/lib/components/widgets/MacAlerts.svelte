<script>
	// What's going on in the world: tsunami warnings and the disasters GDACS rates orange or
	// red (cyclones, floods, eruptions, strong quakes …), the worst first, with how far away
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import { widgetData, placeOf, detectedPlace } from '#lib/stores/widgetData.ts';
	import { tsunami, disasters } from '#lib/world/sources/earth.ts';
	import { distanceKm } from '#lib/map.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'alerts' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let alerts = $state([]);
	let loaded = $state(false);
	let error = $state('');

	$effect(() => {
		const controller = new AbortController();
		const world = { north: 85, south: -85, west: -180, east: 180, lat: 0, lon: 0, zoom: 2 };
		const load = async () => {
			const [waves, events] = await Promise.all([
				tsunami.load(world, controller.signal).catch(() => []),
				disasters.load(world, controller.signal).catch(() => null)
			]);
			if (controller.signal.aborted) return;
			if (events === null && !waves.length) {
				error = "Couldn't reach the alerts";
				return;
			}
			alerts = [
				...waves
					.filter((f) => f.data.level.rank >= 2)
					.map((f) => ({
						id: f.id,
						title: f.data.title,
						sub: f.data.field('Location') || f.data.feed.centre,
						colour: f.colour,
						rank: f.data.level.rank + 1,
						place: f
					})),
				...(events ?? [])
					.filter((f) => (f.rank ?? 0) >= 2)
					.map((f) => ({
						id: f.id,
						title: f.label,
						sub: [f.data.type.label, f.data.p.country].filter(Boolean).join(' · '),
						colour: f.colour,
						rank: f.rank ?? 1,
						place: f
					}))
			].sort((a, b) => b.rank - a.rank);
			loaded = true;
			error = '';
		};
		load();
		const timer = setInterval(load, 15 * 60 * 1000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	});
	const away = (p) => (place ? `${Math.round(distanceKm(place, p)).toLocaleString()} km` : '');
</script>

<Widget size="large">
	<div class="flex items-center gap-1.5 mb-2">
		<span class="icon-[mingcute--alert-octagon-line] size-3.5 text-primary-500"></span>
		<span class="text-[11px] font-bold uppercase tracking-wide text-primary-500">World alerts</span>
		<button
			class="ms-auto grid place-items-center size-5 rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			title="Open the earth map"
			aria-label="Open the earth map"
			onclick={() => goto('/world?category=earth')}
			><span class="icon-[mingcute--fullscreen-2-line] size-3"></span></button
		>
	</div>
	{#if !loaded}
		<p class="mt-auto text-sm text-white/60">{error || 'Loading the alerts…'}</p>
	{:else if !alerts.length}
		<div class="mt-auto flex items-center gap-2 text-sm text-white/75">
			<span class="icon-[mingcute--check-circle-fill] size-5 text-green-400"></span>
			All quiet: no big disasters going on
		</div>
	{:else}
		<div class="flex-1 min-h-0 overflow-hidden flex flex-col gap-1.5">
			{#each alerts.slice(0, 7) as alert (alert.id)}
				<button
					class="flex items-center gap-2.5 text-start cursor-pointer rounded-lg hover:bg-white/5"
					onclick={() => goto('/world?category=earth')}
				>
					<span class="w-1.5 self-stretch rounded-full" style="background: {alert.colour}"></span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold truncate">{alert.title}</span>
						<span class="block text-[11px] text-white/55 truncate">{alert.sub}</span>
					</span>
					<span class="text-[11px] text-white/50 tabular-nums whitespace-nowrap"
						>{away(alert.place)}</span
					>
				</button>
			{/each}
		</div>
	{/if}
</Widget>
