<script>
	// The earthquake map, like the ones of the seismological centres: every quake of the last
	// week (live as each one is located), big ones big, coloured by age or by depth, over the
	// boundaries of the plates they follow; a list of those on the map, and all about the one
	// picked. New ones near you (or very strong ones anywhere) are told about.
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { open as openUrl } from '@tauri-apps/plugin-shell';
	import StormMap from '#lib/components/storm/StormMap.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { quakes, quakeStatus, useQuakes, onNewQuakes } from '#lib/stores/quakes.ts';
	import {
		AGE_COLOURS,
		DEPTH_COLOURS,
		magColour,
		magClass,
		depthClass,
		energyTnt,
		quakeAgo,
		quakeRadius,
		plateBoundaries
	} from '#lib/quakes.ts';
	import { distanceKm, bearing } from '#lib/map.ts';
	import { compass } from '#lib/storm.ts';
	import { showToast } from '#lib/stores/toast.ts';

	const UID = '_quakes';
	let saved = $derived($widgetData[UID] ?? {});
	let home = $derived(placeOf($widgetData, '_storm') ?? $detectedPlace);
	const set = (change) => setWidgetData(UID, change);

	// --- What's shown --------------------------------------------------------------------------
	const HOUR = 60 * 60 * 1000;
	const PERIODS = [
		{ id: 'hour', label: '1 h', ms: HOUR },
		{ id: 'day', label: '24 h', ms: 24 * HOUR },
		{ id: 'week', label: '7 days', ms: 7 * 24 * HOUR }
	];
	const MAGNITUDES = [0, 2.5, 4.5, 6];
	let period = $derived(PERIODS.find((p) => p.id === saved.period) ?? PERIODS[1]);
	let minMag = $derived(saved.minMag ?? 0);
	let colourBy = $derived(saved.colour ?? 'age');
	let showPlates = $derived(saved.plates ?? true);
	let sort = $derived(saved.sort ?? 'latest');

	// The times shown age (and quakes leave the last hour)
	let now = $state(Date.now());
	let shown = $derived(
		$quakes.filter((q) => now - q.time < period.ms && (!minMag || q.mag >= minMag))
	);
	let strongest = $derived(shown.reduce((best, q) => (!best || q.mag > best.mag ? q : best), null));

	// --- The view --------------------------------------------------------------------------
	let view = $state(null);
	let settled = false;
	let fromHome = false;
	$effect(() => {
		// Lands around where you are (or where the map was left); until that's known, the world
		const place = home;
		const kept = saved.view;
		untrack(() => {
			if (settled) return;
			if (kept) {
				view = kept;
				settled = true;
			} else if (place && !fromHome) {
				view = { lat: place.lat, lon: place.lon, zoom: 5 };
				fromHome = true;
			} else if (!view) view = { lat: 30, lon: 15, zoom: 2 };
		});
	});
	let saveTimer;
	function moveTo(next) {
		settled = true;
		// A world further east or west is the same place (the map repeats)
		const kept = { ...next, lon: ((((next.lon + 180) % 360) + 360) % 360) - 180 };
		view = kept;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => set({ view: kept }), 800);
	}
	const zoomBy = (step) =>
		view && moveTo({ ...view, zoom: Math.max(2, Math.min(11, view.zoom + step)) });

	// The quakes on the map, for the list
	let bounds = $state(null);
	function onMap(q, b) {
		if (q.lat > b.north || q.lat < b.south) return false;
		const span = b.east - b.west;
		return span >= 360 || (((q.lon - b.west) % 360) + 360) % 360 <= span;
	}
	let listed = $derived.by(() => {
		const b = bounds;
		const list = b ? shown.filter((q) => onMap(q, b)) : shown;
		return sort === 'strongest' ? [...list].sort((x, y) => y.mag - x.mag || y.time - x.time) : list;
	});
	const LIST_MAX = 100;
	let listOpen = $state(true);

	// --- The quake picked ----------------------------------------------------------------------
	let selectedId = $state(null);
	let selected = $derived(selectedId ? ($quakes.find((q) => q.id === selectedId) ?? null) : null);
	function pick(quake, fly = false) {
		selectedId = quake.id;
		if (fly) moveTo({ lat: quake.lat, lon: quake.lon, zoom: Math.max(view?.zoom ?? 5, 6) });
	}
	// Picked from the list, it stays on the map even when the filters leave it out
	let mapQuakes = $derived(selected && !shown.includes(selected) ? [...shown, selected] : shown);
	let details = $derived.by(() => {
		const q = selected;
		if (!q) return null;
		// Others around it this week: aftershocks, or a swarm
		const around = $quakes.filter(
			(other) => other !== q && Math.abs(other.lat - q.lat) < 0.6 && distanceKm(q, other) <= 50
		);
		return {
			class: magClass(q.mag),
			km: home ? distanceKm(home, q) : null,
			direction: home ? compass(bearing(home, q)) : '',
			around: around.length,
			strongestAround: around.reduce((best, o) => (!best || o.mag > best.mag ? o : best), null)
		};
	});
	// Opened for a quake (from the widget): to it once the quakes are here
	let openFor = page.url.searchParams.get('id');
	$effect(() => {
		if (!openFor) return;
		const quake = $quakes.find((q) => q.id === openFor);
		if (!quake) return;
		openFor = null;
		untrack(() => pick(quake, true));
	});

	// --- The plates' boundaries (where most quakes are) ---------------------------------------
	let plates = $state.raw(null);
	$effect(() => {
		if (!showPlates || plates) return;
		plateBoundaries()
			.then((paths) => (plates = paths))
			.catch((error) => console.warn('Could not load the plate boundaries', error));
	});
	let lines = $derived(
		showPlates && plates ? { paths: plates, colour: 'rgba(248, 113, 113, 0.45)' } : null
	);

	onMount(() => {
		const stopQuakes = useQuakes();
		// New ones near you, or very strong ones anywhere
		const stopNews = onNewQuakes((list) => {
			const here = home;
			const notable = list.filter(
				(q) => q.mag >= 6 || (here && q.mag >= 2.5 && distanceKm(here, q) <= 300)
			);
			if (!notable.length) return;
			const q = notable.reduce((best, o) => (o.mag > best.mag ? o : best));
			const km = here ? distanceKm(here, q) : Infinity;
			showToast(
				`Earthquake M${q.mag.toFixed(1)} · ${km <= 1000 ? `${Math.round(km)} km ${compass(bearing(here, q))} of you` : q.region}`,
				'icon-[ri--earthquake-fill]',
				8000
			);
		});
		const clock = setInterval(() => (now = Date.now()), 30000);
		return () => {
			stopQuakes();
			stopNews();
			clearInterval(clock);
			clearTimeout(saveTimer);
		};
	});

	const glass = 'bg-[#15181d]/90 backdrop-blur-xl ring-1 ring-white/10 shadow-xl shadow-black/30';
	const depthText = (km) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
	const clock = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	const utc = (ms) => `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
	const coords = (q) =>
		`${Math.abs(q.lat).toFixed(2)}° ${q.lat >= 0 ? 'N' : 'S'}, ${Math.abs(q.lon).toFixed(2)}° ${q.lon >= 0 ? 'E' : 'W'}`;
</script>

<div class="relative h-full min-h-[560px] overflow-hidden rounded-lg bg-[#111418]">
	{#if view}
		<StormMap
			lat={view.lat}
			lon={view.lon}
			zoom={view.zoom}
			minZoom={2}
			quakes={mapQuakes}
			selectedQuake={selectedId}
			quakeColour={colourBy}
			{lines}
			{home}
			onquake={(quake) => pick(quake)}
			onmove={moveTo}
			onpick={() => (selectedId = null)}
			onbounds={(b) => (bounds = b)}
		/>
	{/if}

	<!-- Top: name, time, magnitude, status -->
	<div
		class="absolute top-3 left-3 flex items-center gap-2 {selected ? 'right-[24.5rem]' : 'right-3'}"
	>
		<div class="flex items-center gap-2 h-11 px-3 shrink-0 rounded-2xl {glass}">
			<span class="icon-[ri--earthquake-fill] size-5 text-amber-300"></span>
			{#if !selected}
				<span class="font-extrabold tracking-tight hidden xl:block">Earthquakes</span>
			{/if}
		</div>
		<div class="flex p-1 h-11 shrink-0 rounded-2xl {glass}" role="group" aria-label="Time">
			{#each PERIODS as p (p.id)}
				<button
					class="px-2.5 rounded-xl whitespace-nowrap text-sm font-semibold cursor-pointer transition {period.id ===
					p.id
						? 'bg-white text-black'
						: 'text-white/65 hover:text-white'}"
					aria-pressed={period.id === p.id}
					onclick={() => set({ period: p.id })}>{p.label}</button
				>
			{/each}
		</div>
		<div class="flex p-1 h-11 shrink-0 rounded-2xl {glass}" role="group" aria-label="Magnitude">
			{#each MAGNITUDES as m (m)}
				<button
					class="px-2.5 rounded-xl whitespace-nowrap text-sm font-semibold tabular-nums cursor-pointer transition {minMag ===
					m
						? 'bg-white text-black'
						: 'text-white/65 hover:text-white'}"
					aria-pressed={minMag === m}
					title={m ? `Magnitude ${m} and more` : 'All magnitudes'}
					onclick={() => set({ minMag: m })}>{m ? `M${m}+` : 'All'}</button
				>
			{/each}
		</div>
		<div
			class="flex items-center gap-2 h-11 px-3.5 rounded-2xl text-sm min-w-0 overflow-hidden whitespace-nowrap {glass}"
		>
			<span
				class="size-2 shrink-0 rounded-full {$quakeStatus.state === 'live'
					? 'bg-green-400'
					: $quakeStatus.state === 'error'
						? 'bg-rose-400'
						: 'bg-amber-400 animate-pulse'}"
				title={$quakeStatus.state === 'live'
					? 'Live: each quake as soon as it is located'
					: 'Updated every 2 minutes'}
			></span>
			{#if $quakeStatus.state === 'error'}
				<span class="text-rose-200 truncate">Earthquake data not reachable</span>
			{:else if $quakeStatus.state === 'loading' && !$quakes.length}
				<span class="text-white/55 truncate">Loading the quakes…</span>
			{:else}
				<span class="font-bold tabular-nums">{shown.length.toLocaleString()}</span>
				<span class="text-white/55">quakes</span>
				{#if strongest && !selected}
					<button
						class="hidden xl:flex items-center gap-1.5 ms-1 min-w-0 cursor-pointer hover:underline"
						title="The strongest in this time"
						onclick={() => pick(strongest, true)}
					>
						<span class="text-white/40">· strongest</span>
						<span class="font-bold tabular-nums" style="color: {magColour(strongest.mag)}"
							>M{strongest.mag.toFixed(1)}</span
						>
						<span class="text-white/70 truncate max-w-48">{strongest.region}</span>
					</button>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Left: the quakes on the map -->
	<div
		class="absolute left-3 top-[4.25rem] w-72 max-h-[calc(100%-10.5rem)] flex flex-col rounded-2xl overflow-hidden {glass}"
	>
		<div class="flex items-center gap-2 pl-3.5 pr-1.5 h-11 shrink-0">
			<button
				class="flex-1 flex items-center gap-2 h-full text-start cursor-pointer"
				onclick={() => (listOpen = !listOpen)}
			>
				<span class="icon-[mingcute--list-check-line] size-4 text-amber-300"></span>
				<span class="text-sm font-bold whitespace-nowrap">In view</span>
				<span class="text-xs tabular-nums text-white/50">{listed.length.toLocaleString()}</span>
				<span
					class="icon-[mingcute--down-line] size-4 text-white/50 transition {listOpen
						? 'rotate-180'
						: ''}"
				></span>
			</button>
			<div class="flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold">
				{#each [['latest', 'Latest'], ['strongest', 'Strongest']] as [value, label] (value)}
					<button
						class="px-2 h-6 rounded-md cursor-pointer {sort === value
							? 'bg-white/15'
							: 'text-white/55 hover:text-white'}"
						aria-pressed={sort === value}
						onclick={() => set({ sort: value })}>{label}</button
					>
				{/each}
			</div>
		</div>
		{#if listOpen}
			<div class="min-h-0 overflow-y-auto border-t border-white/[0.06] p-1">
				{#if !listed.length}
					<p class="px-3 py-3 text-xs text-white/50">
						{$quakeStatus.state === 'loading' && !$quakes.length
							? 'Loading the quakes…'
							: 'No quakes here in this time. Zoom out, or show a longer time.'}
					</p>
				{/if}
				{#each listed.slice(0, LIST_MAX) as q (q.id)}
					<button
						class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-start cursor-pointer transition {selectedId ===
						q.id
							? 'bg-white/10'
							: 'hover:bg-white/[0.06]'}"
						onclick={() => pick(q, true)}
					>
						<span
							class="grid place-items-center w-10 h-7 shrink-0 rounded-lg text-xs font-extrabold tabular-nums text-black"
							style="background: {magColour(q.mag)}">{q.mag.toFixed(1)}</span
						>
						<span class="min-w-0 flex-1">
							<span class="block text-sm font-semibold truncate">{q.region || 'Earthquake'}</span>
							<span class="block text-[11px] text-white/55 truncate tabular-nums"
								>{quakeAgo(q.time, now)} · {depthText(q.depth)} deep{home
									? ` · ${Math.round(distanceKm(home, q)).toLocaleString()} km away`
									: ''}</span
							>
						</span>
					</button>
				{/each}
				{#if listed.length > LIST_MAX}
					<p class="px-3 py-2 text-[11px] text-white/45">
						And {(listed.length - LIST_MAX).toLocaleString()} more · zoom in or choose a magnitude
					</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Bottom left: the plates, colours and sizes (what doesn't fit beside the panel is left out) -->
	<div
		class="absolute bottom-3 left-3 flex items-center gap-3 h-14 px-2 rounded-2xl overflow-hidden {glass} {selected
			? 'max-w-[calc(100%-26rem)]'
			: 'max-w-[calc(100%-1.5rem)]'}"
	>
		<button
			class="flex shrink-0 items-center gap-1.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer transition {showPlates
				? 'bg-white/10 text-white'
				: 'text-white/45 hover:text-white/80'}"
			aria-pressed={showPlates}
			title="The boundaries of the tectonic plates: most quakes happen along them"
			onclick={() => set({ plates: !showPlates })}
			><span class="icon-[mingcute--earth-latitude-line] size-4"></span>Plates</button
		>
		<div class="w-px h-8 shrink-0 bg-white/10"></div>
		<div class="flex shrink-0 p-0.5 rounded-xl bg-white/[0.05] text-xs font-semibold" role="group">
			{#each [['age', 'Age'], ['depth', 'Depth']] as [value, label] (value)}
				<button
					class="px-2.5 h-7 rounded-lg cursor-pointer {colourBy === value
						? 'bg-white/15'
						: 'text-white/55 hover:text-white'}"
					aria-pressed={colourBy === value}
					title="Colour the quakes by their {label.toLowerCase()}"
					onclick={() => set({ colour: value })}>{label}</button
				>
			{/each}
		</div>
		<div class="flex shrink-0 items-center gap-2.5 text-[11px] text-white/65">
			{#each colourBy === 'age' ? AGE_COLOURS : DEPTH_COLOURS as item (item.label)}
				<span class="flex items-center gap-1 whitespace-nowrap">
					<span class="size-2.5 rounded-full" style="background: {item.colour}"></span>
					{item.label}
				</span>
			{/each}
		</div>
		<div
			class="{selected
				? 'hidden'
				: 'flex'} shrink-0 items-end gap-1.5 pe-1 text-[10px] text-white/50"
			title="Size: magnitude"
		>
			{#each [2, 4, 6] as m (m)}
				{@const r = quakeRadius(m)}
				<span class="flex flex-col items-center">
					<svg width={r * 2 + 2} height={r * 2 + 2} class="overflow-visible">
						<circle
							cx={r + 1}
							cy={r + 1}
							{r}
							fill="rgba(255,255,255,0.12)"
							stroke="rgba(255,255,255,0.5)"
						/>
					</svg>
					M{m}
				</span>
			{/each}
		</div>
	</div>

	<!-- Zoom -->
	<div
		class="absolute bottom-[4.75rem] flex flex-col rounded-2xl {glass} {selected
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300"
			aria-label="Zoom in"
			onclick={() => zoomBy(1)}><span class="icon-[mingcute--add-line] size-4"></span></button
		>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
			aria-label="Zoom out"
			onclick={() => zoomBy(-1)}><span class="icon-[mingcute--minimize-line] size-4"></span></button
		>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
			aria-label="The whole world"
			title="The whole world"
			onclick={() => moveTo({ lat: 25, lon: view?.lon ?? 15, zoom: 2 })}
			><span class="icon-[mingcute--earth-2-line] size-4"></span></button
		>
		{#if home}
			<button
				class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
				aria-label="Back to {home.name}"
				title="Back to {home.name}"
				onclick={() => moveTo({ lat: home.lat, lon: home.lon, zoom: Math.max(view?.zoom ?? 5, 5) })}
				><span class="icon-[mingcute--aiming-2-line] size-4"></span></button
			>
		{/if}
	</div>

	<!-- Right: the quake picked -->
	{#if selected && details}
		<aside
			class="absolute top-3 right-3 bottom-3 w-[23rem] flex flex-col rounded-2xl overflow-hidden {glass}"
		>
			<header class="p-4 pb-3 border-b border-white/[0.06]">
				<div class="flex items-start gap-3">
					<span
						class="flex flex-col items-center justify-center size-14 shrink-0 rounded-2xl text-black"
						style="background: {magColour(selected.mag)}"
					>
						<span class="text-xl font-extrabold leading-none tabular-nums"
							>{selected.mag.toFixed(1)}</span
						>
						<span class="text-[10px] font-bold">{selected.magType}</span>
					</span>
					<div class="min-w-0 flex-1">
						<p class="font-bold leading-tight">{selected.region || 'Earthquake'}</p>
						<p class="mt-0.5 text-sm text-white/60">
							<span class="font-semibold" style="color: {magColour(selected.mag)}"
								>{details.class.label}</span
							>
							· {quakeAgo(selected.time, now)}
						</p>
					</div>
					<button
						class="grid place-items-center size-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
						aria-label="Close"
						onclick={() => (selectedId = null)}
						><span class="icon-[mingcute--close-line] size-4"></span></button
					>
				</div>
			</header>
			<div class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
				<p class="text-sm text-white/75">
					{details.class.effect}<span class="text-white/40"
						>{selected.depth >= 70 ? ' (but it was deep: felt less)' : ''}</span
					>
				</p>
				<div class="grid grid-cols-2 gap-2">
					{#each [['Time', clock(selected.time), utc(selected.time)], ['Depth', depthText(selected.depth), depthClass(selected.depth)], ['Distance', details.km == null ? '–' : `${Math.round(details.km).toLocaleString()} km ${details.direction}`, home ? `from ${home.name}` : ''], ['Where', coords(selected), ''], ['Energy', `≈ ${energyTnt(selected.mag)} TNT`, 'set free by the quake'], ['Located by', selected.source, selected.id.startsWith('usgs:') ? 'via the USGS' : selected.source === 'EMSC' ? '' : 'via the EMSC']] as [label, value, hint] (label)}
						<div class="p-2.5 rounded-xl bg-white/[0.04] min-w-0">
							<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">{label}</p>
							<p class="text-sm font-bold tabular-nums leading-snug">{value}</p>
							{#if hint}<p class="text-[11px] text-white/45 truncate">{hint}</p>{/if}
						</div>
					{/each}
				</div>
				<div class="p-3 rounded-xl bg-white/[0.04]">
					<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">
						Around it this week
					</p>
					{#if details.around}
						<p class="mt-0.5 text-sm">
							<strong class="tabular-nums">{details.around}</strong> more within 50 km, the
							strongest
							<button
								class="font-bold tabular-nums cursor-pointer hover:underline"
								style="color: {magColour(details.strongestAround.mag)}"
								onclick={() => pick(details.strongestAround, true)}
								>M{details.strongestAround.mag.toFixed(1)}</button
							>
							{quakeAgo(details.strongestAround.time, now)}
						</p>
						<p class="mt-0.5 text-[11px] text-white/45">Aftershocks, or a swarm of quakes</p>
					{:else}
						<p class="mt-0.5 text-sm text-white/70">No other quakes within 50 km</p>
					{/if}
				</div>
				{#if selected.url}
					<button
						class="flex items-center justify-center gap-2 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold cursor-pointer"
						onclick={() => openUrl(selected.url)}
						><span class="icon-[mingcute--external-link-line] size-4"></span>More at the {selected.id.startsWith(
							'usgs:'
						)
							? 'USGS'
							: 'EMSC'}</button
					>
				{/if}
			</div>
			<footer class="px-4 py-2.5 border-t border-white/[0.06] text-[11px] text-white/40">
				Times in your time zone · effects are what a quake of this size usually does near its centre
			</footer>
		</aside>
	{/if}
</div>
