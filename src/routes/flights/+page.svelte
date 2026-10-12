<script>
	// The flight radar, like Flightradar24: every plane around live on the map (moving on
	// between updates), the ten flights most worth watching worldwide, a search, and the
	// whole story of the plane picked. The weather (rain radar, lightning) can go underneath,
	// to see how the planes fly around the storms.
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import StormMap from '#lib/components/storm/StormMap.svelte';
	import FlightPanel from '#lib/components/flights/FlightPanel.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import {
		planes,
		flightStatus,
		followed,
		setFlightArea,
		useFlights,
		useTopFlights,
		topList,
		showPlane,
		followedTrack
	} from '#lib/stores/flights.ts';
	import {
		findPlanes,
		planeOf,
		planeNow,
		kmBetween,
		altitudeColour,
		flightInfo
	} from '#lib/flights.ts';
	import { strikes, useLightning } from '#lib/stores/lightning.ts';
	import { fastFetch } from '#lib/fastFetch.ts';

	const UID = '_flights';
	let saved = $derived($widgetData[UID] ?? {});
	let home = $derived(placeOf($widgetData, '_storm') ?? $detectedPlace);
	let shown = $derived({ weather: false, lightning: false, ...saved.layers });
	const toggle = (key) => setWidgetData(UID, { layers: { ...shown, [key]: !shown[key] } });

	// --- The view --------------------------------------------------------------------------
	let view = $state(null);
	let settled = false;
	let fromHome = false;
	$effect(() => {
		const place = home;
		const kept = saved.view;
		untrack(() => {
			if (settled) return;
			if (kept) {
				view = kept;
				settled = true;
			} else if (place && !fromHome) {
				view = { lat: place.lat, lon: place.lon, zoom: 8 };
				fromHome = true;
			} else if (!view) view = { lat: 50.5, lon: 9.5, zoom: 6 };
		});
	});
	let saveTimer;
	function moveTo(next) {
		settled = true;
		view = next;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => setWidgetData(UID, { view: next }), 800);
	}

	// The planes of the area shown (the network answers for up to 250 NM around a place)
	let bounds = $state(null);
	let tooWide = $state(false);
	$effect(() => {
		if (!bounds || !view) return;
		const corner = { lat: bounds.north, lon: bounds.west };
		const nm = (kmBetween(view, corner) / 1.852) * 1.05;
		tooWide = nm > 250;
		setFlightArea({ lat: view.lat, lon: view.lon, radiusNm: nm });
	});

	// --- The plane picked ----------------------------------------------------------------------
	let selected = $derived($planes.find((p) => p.hex === $followed) ?? null);

	// Where the plane picked comes from and goes (for its route on the map)
	let route = $state(null);
	let routeFor = '';
	$effect(() => {
		const p = selected;
		const key = p ? `${p.hex}/${p.callsign}` : '';
		if (key === routeFor) return;
		routeFor = key;
		route = null;
		if (!p) return;
		flightInfo(p).then((info) => {
			if (routeFor === key) route = { from: info.origin, to: info.destination };
		});
	});
	let why = $state('');
	let follow = $state(true);
	function pick(plane, reason = '') {
		why = reason;
		followed.set(plane.hex);
		follow = true;
		moveTo({ lat: plane.lat, lon: plane.lon, zoom: Math.max(view?.zoom ?? 7, 7) });
	}
	function unpick() {
		followed.set(null);
		why = '';
	}
	// Following: the map keeps the plane in the middle
	$effect(() => {
		if (!follow || !$followed) return;
		const timer = setInterval(() => {
			const plane = $planes.find((p) => p.hex === $followed);
			if (!plane || !view) return;
			const at = planeNow(plane);
			view = { ...view, lat: at.lat, lon: at.lon };
		}, 250);
		return () => clearInterval(timer);
	});
	// Opened for a plane not loaded yet: to it once it's found
	let flyWhenFound = $state(null);
	$effect(() => {
		if (flyWhenFound && selected?.hex === flyWhenFound) {
			flyWhenFound = null;
			untrack(() => pick(selected));
		}
	});

	// --- Search --------------------------------------------------------------------------------
	let query = $state('');
	let searching = $state(false);
	let searchError = $state('');
	async function search() {
		const q = query.trim();
		if (!q) return;
		searching = true;
		searchError = '';
		try {
			const found = await findPlanes(q);
			const plane = found.map((ac) => planeOf(ac)).find(Boolean);
			if (!plane) searchError = `No plane “${q.toUpperCase()}” in the air`;
			else {
				pick(showPlane(plane));
				query = '';
			}
		} catch {
			searchError = "Couldn't search right now";
		} finally {
			searching = false;
		}
	}

	// --- The weather underneath (the latest radar picture) ---------------------------------
	let radar = $state(null);
	async function loadRadar() {
		try {
			const data = await (
				await fastFetch('https://api.rainviewer.com/public/weather-maps.json')
			).json();
			const last = data.radar?.past?.at(-1);
			if (last) radar = { host: data.host, path: last.path };
		} catch {
			radar = null;
		}
	}
	let radarLayer = $derived(
		shown.weather && radar
			? { host: radar.host, frames: [{ path: radar.path, time: 0 }], frame: 0, opacity: 0.7 }
			: null
	);

	let stopLightning = null;
	$effect(() => {
		if (shown.lightning && !stopLightning) stopLightning = useLightning();
		else if (!shown.lightning && stopLightning) {
			stopLightning();
			stopLightning = null;
		}
	});

	onMount(() => {
		const stopFlights = useFlights();
		const stopTop = useTopFlights();
		loadRadar();
		const radarTimer = setInterval(loadRadar, 5 * 60 * 1000);
		// Opened for a plane (from the storm center)
		const hex = page.url.searchParams.get('hex');
		if (hex) {
			followed.set(hex.toLowerCase());
			const plane = $planes.find((p) => p.hex === hex.toLowerCase());
			if (plane) pick(plane);
			else flyWhenFound = hex.toLowerCase();
		}
		return () => {
			stopFlights();
			stopTop();
			stopLightning?.();
			stopLightning = null;
			clearInterval(radarTimer);
			clearTimeout(saveTimer);
		};
	});

	let topOpen = $state(true);
	const glass = 'bg-[#15181d]/90 backdrop-blur-xl ring-1 ring-white/10 shadow-xl shadow-black/30';
	const fmt = (n) => Math.round(n).toLocaleString();
</script>

<div class="relative h-full min-h-[560px] overflow-hidden rounded-lg bg-[#111418]">
	{#if view}
		<StormMap
			lat={view.lat}
			lon={view.lon}
			zoom={view.zoom}
			radar={radarLayer}
			strikes={shown.lightning ? $strikes : null}
			planes={$planes}
			selectedPlane={$followed}
			planeColour="#facc15"
			track={$followedTrack}
			{route}
			onplane={(plane) => pick(plane)}
			onmove={(next) => {
				// Dragged away (zooming keeps following)
				if (next.zoom === view?.zoom) follow = false;
				moveTo(next);
			}}
			onpick={() => unpick()}
			onbounds={(b) => (bounds = b)}
		/>
	{/if}

	<!-- Top: name, search, status -->
	<div
		class="absolute top-3 left-3 flex items-center gap-2 {selected ? 'right-[24.5rem]' : 'right-3'}"
	>
		<div class="flex items-center gap-2 h-11 pl-3 pr-1.5 rounded-2xl {glass}">
			<span class="icon-[mingcute--airplane-fill] size-5 text-amber-300"></span>
			<span class="font-extrabold tracking-tight hidden lg:block">Flight radar</span>
			<form
				class="relative ms-1"
				onsubmit={(e) => {
					e.preventDefault();
					search();
				}}
			>
				<span
					class="absolute left-2.5 top-1/2 -translate-y-1/2 {searching
						? 'icon-[mingcute--loading-line] animate-spin'
						: 'icon-[mingcute--search-line]'} size-4 text-white/40"
				></span>
				<input
					bind:value={query}
					oninput={() => (searchError = '')}
					placeholder="Flight, registration or hex"
					class="w-64 h-8 pl-8 pr-2 rounded-xl bg-white/[0.06] text-sm outline-none ring-1 ring-white/10 focus:ring-white/30 placeholder:text-white/35"
				/>
				{#if searchError}
					<p class="absolute left-0 top-10 w-72 px-3 py-2 rounded-xl text-xs text-rose-200 {glass}">
						{searchError}
					</p>
				{/if}
			</form>
		</div>
		<div class="flex items-center gap-2 h-11 px-3.5 rounded-2xl text-sm {glass}">
			<span
				class="size-2 rounded-full {$flightStatus.state === 'live'
					? 'bg-green-400'
					: $flightStatus.state === 'error'
						? 'bg-rose-400'
						: 'bg-amber-400 animate-pulse'}"
			></span>
			{#if $flightStatus.state === 'error'}
				<span class="text-rose-200">Flight data not reachable</span>
			{:else}
				<span class="font-bold tabular-nums">{fmt($planes.length)}</span>
				<span class="text-white/55">aircraft</span>
			{/if}
		</div>
		{#if tooWide}
			<div
				class="hidden xl:flex items-center h-11 px-3.5 rounded-2xl text-xs text-white/60 {glass}"
			>
				Showing 460 km around the middle · zoom in for all
			</div>
		{/if}
	</div>

	<!-- Left: the ten flights to watch -->
	<div class="absolute left-3 top-[4.25rem] w-72 rounded-2xl overflow-hidden {glass}">
		<button
			class="w-full flex items-center gap-2 px-3.5 h-11 cursor-pointer hover:bg-white/[0.04]"
			onclick={() => (topOpen = !topOpen)}
		>
			<span class="icon-[mingcute--trophy-line] size-4 text-amber-300"></span>
			<span class="flex-1 text-start text-sm font-bold">Top 10 flights to watch</span>
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
			<div class="border-t border-white/[0.06] max-h-[min(60vh,32rem)] overflow-y-auto p-1">
				{#if !$topList.list.length}
					<p class="px-3 py-3 text-xs text-white/50">
						{$topList.loading || !$topList.at
							? 'Looking for emergencies, giants and rarities in the air…'
							: 'Nothing special in the air right now'}
					</p>
				{/if}
				{#each $topList.list as item, i (item.plane.hex)}
					<button
						class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-start cursor-pointer transition {$followed ===
						item.plane.hex
							? 'bg-white/10'
							: 'hover:bg-white/[0.06]'}"
						onclick={() => pick(showPlane(item.plane), item.why)}
					>
						<span
							class="grid place-items-center size-6 shrink-0 rounded-md text-xs font-extrabold {i <
							3
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
								class="block text-[11px] truncate {item.score >= 80
									? 'text-red-300'
									: 'text-white/55'}">{item.why}</span
							>
						</span>
						<span
							class="text-[11px] tabular-nums font-semibold"
							style="color: {altitudeColour(item.plane.alt)}"
							>FL{String(Math.round(item.plane.alt / 100)).padStart(3, '0')}</span
						>
					</button>
				{/each}
			</div>
			<p class="px-3.5 py-2 border-t border-white/[0.06] text-[10px] text-white/40">
				Emergencies, giant and rare aircraft, special military · worldwide · FL = flight level, 100
				ft
			</p>
		{/if}
	</div>

	<!-- Bottom left: the layers -->
	<div class="absolute bottom-3 left-3 flex p-1 gap-1 rounded-2xl {glass}">
		{#each [['weather', 'Weather', 'icon-[mingcute--rainstorm-line]'], ['lightning', 'Lightning', 'icon-[mingcute--flash-line]']] as [key, label, icon] (key)}
			<button
				class="flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-medium cursor-pointer transition {shown[
					key
				]
					? 'bg-white/10 text-white'
					: 'text-white/45 hover:text-white/80'}"
				aria-pressed={!!shown[key]}
				onclick={() => toggle(key)}><span class="{icon} size-4"></span>{label}</button
			>
		{/each}
	</div>

	<!-- Zoom -->
	<div
		class="absolute bottom-3 flex flex-col rounded-2xl {glass} {selected
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		{#if selected}
			<button
				class="grid place-items-center size-9 cursor-pointer border-b border-white/10 {follow
					? 'text-amber-300'
					: 'hover:text-sky-300'}"
				aria-label="Follow the plane"
				title="Keep the plane in the middle"
				aria-pressed={follow}
				onclick={() => (follow = !follow)}
				><span class="icon-[mingcute--aiming-2-line] size-4"></span></button
			>
		{/if}
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300"
			aria-label="Zoom in"
			onclick={() => view && (view = { ...view, zoom: Math.min(11, view.zoom + 1) })}
			><span class="icon-[mingcute--add-line] size-4"></span></button
		>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
			aria-label="Zoom out"
			onclick={() => view && (view = { ...view, zoom: Math.max(3, view.zoom - 1) })}
			><span class="icon-[mingcute--minimize-line] size-4"></span></button
		>
	</div>

	<!-- Right: the plane picked -->
	{#if selected}
		<aside class="absolute top-3 right-3 bottom-3 w-[23rem] overflow-y-auto rounded-2xl {glass}">
			<FlightPanel plane={selected} {why} track={$followedTrack} onclose={unpick} />
		</aside>
	{/if}
</div>
