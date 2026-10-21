<script>
	// The flights under the traffic layers: a search for any plane in the air (flight,
	// registration or hex) and the ten most worth watching worldwide
	import { onMount } from 'svelte';
	import { topList, useTopFlights, showPlane, followed } from '#lib/stores/flights.ts';
	import { findPlanes, planeOf, altitudeColour } from '#lib/flights.ts';

	/** @type {{ onpick: (plane: import('#lib/flights.ts').Plane, why?: string) => void }} */
	let { onpick } = $props();

	let query = $state('');
	let searching = $state(false);
	let searchError = $state('');
	async function search(event) {
		event.preventDefault();
		const q = query.trim();
		if (!q) return;
		searching = true;
		searchError = '';
		try {
			const plane = (await findPlanes(q)).map((ac) => planeOf(ac)).find(Boolean);
			if (!plane) searchError = `No plane “${q.toUpperCase()}” in the air`;
			else {
				onpick(showPlane(plane));
				query = '';
			}
		} catch {
			searchError = "Couldn't search right now";
		} finally {
			searching = false;
		}
	}

	let topOpen = $state(true);
	onMount(() => useTopFlights());
</script>

<div class="border-t border-white/[0.06] p-1.5 flex flex-col gap-1">
	<p class="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
		Flights
	</p>
	<form class="relative px-1" onsubmit={search}>
		<span
			class="absolute left-3.5 top-1/2 -translate-y-1/2 {searching
				? 'icon-[mingcute--loading-line] animate-spin'
				: 'icon-[mingcute--search-line]'} size-4 text-white/40"
		></span>
		<input
			bind:value={query}
			oninput={() => (searchError = '')}
			placeholder="Flight, registration or hex"
			class="w-full h-8 pl-8 pr-2 rounded-xl bg-white/[0.06] text-sm outline-none ring-1 ring-white/10 focus:ring-white/30 placeholder:text-white/35"
		/>
	</form>
	{#if searchError}<p class="px-2 text-xs text-rose-200">{searchError}</p>{/if}
	<button
		class="flex items-center gap-2 px-2 h-8 rounded-lg cursor-pointer hover:bg-white/[0.04]"
		onclick={() => (topOpen = !topOpen)}
	>
		<span class="icon-[mingcute--trophy-line] size-4 text-amber-300"></span>
		<span class="flex-1 text-start text-sm font-bold">Top 10 to watch</span>
		{#if $topList.loading}
			<span class="icon-[mingcute--loading-line] size-4 animate-spin text-white/40"></span>
		{/if}
		<span
			class="icon-[mingcute--down-line] size-4 text-white/50 transition {topOpen
				? 'rotate-180'
				: ''}"
		></span>
	</button>
	{#if topOpen}
		{#if !$topList.list.length}
			<p class="px-2 pb-1 text-xs text-white/50">
				{$topList.loading || !$topList.at
					? 'Looking for emergencies, giants and rarities in the air…'
					: 'Nothing special in the air right now'}
			</p>
		{/if}
		{#each $topList.list as item, i (item.plane.hex)}
			<button
				class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-start cursor-pointer transition {$followed ===
				item.plane.hex
					? 'bg-white/10'
					: 'hover:bg-white/[0.06]'}"
				onclick={() => onpick(showPlane(item.plane), item.why)}
			>
				<span
					class="grid place-items-center size-6 shrink-0 rounded-md text-xs font-extrabold {i < 3
						? 'bg-amber-300 text-black'
						: 'bg-white/10'}">{i + 1}</span
				>
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-1.5">
						<span class="text-sm font-bold truncate"
							>{item.plane.callsign ||
								item.plane.registration ||
								item.plane.hex.toUpperCase()}</span
						>
						<span class="text-[10px] text-white/45">{item.plane.type}</span>
					</span>
					<span
						class="block text-[11px] truncate {item.score >= 80 ? 'text-red-300' : 'text-white/55'}"
						>{item.why}</span
					>
				</span>
				<span
					class="text-[11px] tabular-nums font-semibold"
					style="color: {altitudeColour(item.plane.alt)}"
					>FL{String(Math.round(item.plane.alt / 100)).padStart(3, '0')}</span
				>
			</button>
		{/each}
	{/if}
</div>
