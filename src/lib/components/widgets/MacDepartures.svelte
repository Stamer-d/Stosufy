<script>
	// The next departures, live with their delays: of a stop you choose (or put here from
	// the world center), else of the stops around your place (Transitous)
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { departures, findStops } from '#lib/world/sources/traffic.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'departures' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let stop = $derived($widgetData[uid]?.stop ?? null);
	let rows = $state([]);
	let loaded = $state(false);
	let error = $state('');
	let now = $state(Date.now());

	$effect(() => {
		const where = stop
			? { stopId: stop.id }
			: place
				? { lat: place.lat, lon: place.lon, radius: 800 }
				: null;
		if (!where) return;
		const controller = new AbortController();
		const load = () =>
			departures(where, 12, controller.signal)
				.then((list) => {
					rows = list;
					loaded = true;
					error = '';
				})
				.catch(() => {
					if (!controller.signal.aborted) error = "Couldn't load the departures";
				});
		load();
		const timer = setInterval(load, 60 * 1000);
		const tick = setInterval(() => (now = Date.now()), 15 * 1000);
		return () => {
			controller.abort();
			clearInterval(timer);
			clearInterval(tick);
		};
	});

	// Choosing a stop
	let asking = $state(false);
	let query = $state('');
	let results = $state([]);
	let searching = $state(false);
	async function search(event) {
		event.preventDefault();
		if (!query.trim()) return;
		searching = true;
		try {
			results = await findStops(query.trim(), place ?? undefined);
		} catch {
			results = [];
		} finally {
			searching = false;
		}
	}
	function choose(result) {
		setWidgetData(uid, { stop: result ? { id: result.id, name: result.name } : null });
		asking = false;
		query = '';
		results = [];
		loaded = false;
	}
	const inMinutes = (time) => Math.max(0, Math.round((time - now) / 60000));
</script>

<Widget size="large">
	<div class="flex items-center gap-1.5 mb-2">
		<span class="icon-[mingcute--train-line] size-3.5 text-primary-500"></span>
		<button
			class="text-[11px] font-bold uppercase tracking-wide text-primary-500 truncate cursor-pointer hover:underline"
			title="Choose the stop"
			onclick={() => (asking = !asking)}
			>{stop?.name ?? (place ? `Around ${place.name}` : 'Departures')}</button
		>
		<button
			class="ms-auto grid place-items-center size-5 rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			title="Open the traffic map"
			aria-label="Open the traffic map"
			onclick={() => goto('/world?category=traffic')}
			><span class="icon-[mingcute--fullscreen-2-line] size-3"></span></button
		>
	</div>
	{#if asking}
		<form class="flex gap-1.5" onsubmit={search}>
			<input
				bind:value={query}
				placeholder="Stop or station"
				class="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-white/10 text-sm outline-none ring-1 ring-white/10 focus:ring-white/30"
			/>
			<button
				class="h-8 px-3 rounded-lg bg-white/15 text-sm font-semibold cursor-pointer hover:bg-white/25"
				>{searching ? '…' : 'Find'}</button
			>
		</form>
		<div class="mt-1.5 flex flex-col overflow-y-auto">
			{#each results as result (result.id)}
				<button
					class="text-start px-2 py-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
					onclick={() => choose(result)}
				>
					<span class="block text-sm font-semibold truncate">{result.name}</span>
					{#if result.where}<span class="block text-[11px] text-white/50 truncate"
							>{result.where}</span
						>{/if}
				</button>
			{/each}
			{#if stop}
				<button
					class="text-start px-2 py-1.5 rounded-lg text-xs text-white/60 hover:bg-white/10 cursor-pointer"
					onclick={() => choose(null)}>Use the stops around {place?.name ?? 'you'} instead</button
				>
			{/if}
		</div>
	{:else if !loaded}
		<p class="mt-auto text-sm text-white/60">{error || 'Loading the departures…'}</p>
	{:else if !rows.length}
		<p class="mt-auto text-sm text-white/60">No departures in the next while</p>
	{:else}
		<div class="flex-1 min-h-0 overflow-hidden flex flex-col gap-1">
			{#each rows.slice(0, 8) as row, i (i)}
				<div class="flex items-center gap-2">
					<span
						class="shrink-0 min-w-10 px-1.5 h-6 grid place-items-center rounded-md text-[11px] font-extrabold text-black truncate"
						style="background: {row.colour}">{row.line}</span
					>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold truncate leading-tight"
							>{row.title.split(' → ')[1] || row.title}</span
						>
						{#if row.sub}<span class="block text-[10px] text-white/45 truncate">{row.sub}</span
							>{/if}
					</span>
					{#if row.badge}
						<span class="px-1 rounded bg-rose-500/25 text-rose-300 text-[10px] font-bold"
							>{row.badge}</span
						>
					{/if}
					<span class="w-12 text-end text-sm font-bold tabular-nums"
						>{inMinutes(row.time) < 60 ? `${inMinutes(row.time)} min` : row.value}</span
					>
				</div>
			{/each}
		</div>
	{/if}
</Widget>
