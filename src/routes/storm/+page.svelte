<script>
	// The storm center: a big map with the rain radar, the DWD warnings and where the air
	// has energy for storms (CAPE), and for any place clicked its storm outlook for the
	// next 24 hours and its warnings
	import { onMount } from 'svelte';
	import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
	import StormMap from '#lib/components/storm/StormMap.svelte';
	import PlacePicker from '#lib/components/widgets/PlacePicker.svelte';
	import { widgetData, placeOf, detectedPlace, setWidgetData } from '#lib/stores/widgetData.ts';
	import { stormOutlook, stormGrid, levelOf, LEVELS, capeColour } from '#lib/storm.ts';
	import { tileBounds } from '#lib/map.ts';

	const UID = '_storm';
	let home = $derived(placeOf($widgetData, UID) ?? $detectedPlace);
	let changingPlace = $state(false);
	let saved = $derived($widgetData[UID] ?? {});

	// Where the map looks (kept for next time)
	let view = $state(null);
	$effect(() => {
		// Lands where you are (or where the map was left)
		if (view || (!saved.view && !home)) return;
		view =
			saved.view ??
			(home ? { lat: home.lat, lon: home.lon, zoom: 7 } : { lat: 51, lon: 10.3, zoom: 6 });
	});
	let saveTimer;
	function moveTo(next) {
		view = next;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => setWidgetData(UID, { view: next }), 1000);
	}

	// --- Layers --------------------------------------------------------------------------
	let shown = $derived({ radar: true, warnings: true, cape: false, ...saved.layers });
	const toggle = (key) => setWidgetData(UID, { layers: { ...shown, [key]: !shown[key] } });

	// The rain radar of the last two hours (RainViewer), as a loop
	let frames = $state([]);
	let host = $state('');
	let frame = $state(0);
	let playing = $state(true);
	async function loadRadar() {
		try {
			const data = await (
				await tauriFetch('https://api.rainviewer.com/public/weather-maps.json')
			).json();
			host = data.host;
			frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
			frame = Math.max(0, (data.radar?.past?.length ?? 1) - 1);
		} catch {
			frames = [];
		}
	}

	// The warnings of the DWD for the municipalities, as a map (their WMS server)
	const warningsUrl = (z, x, y) => {
		const b = tileBounds(x, y, z);
		return `https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.1.1&request=GetMap&layers=dwd:Warnungen_Gemeinden&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox=${b.minX},${b.minY},${b.maxX},${b.maxY}`;
	};

	let layers = $derived([
		...(shown.warnings ? [{ key: 'warnings', url: warningsUrl, opacity: 0.55, maxZoom: 11 }] : []),
		...(shown.radar
			? frames.map((f, i) => ({
					key: f.path,
					url: (z, x, y) => `${host}${f.path}/256/${z}/${x}/${y}/2/1_1.png`,
					opacity: i === frame ? 0.85 : 0,
					maxZoom: 7
				}))
			: [])
	]);

	// Where the air has energy for storms: a grid of forecasts over the map
	let bounds = $state(null);
	let grid = $state(null);
	let gridKey = '';
	let gridLoading = $state(false);
	let hour = $state(0);
	let gridTimer;
	$effect(() => {
		const b = bounds;
		if (!shown.cape || !b) return;
		clearTimeout(gridTimer);
		gridTimer = setTimeout(async () => {
			// A bit more than what's shown, rounded so small moves don't load it again
			const r = (v, s) => Math.round(v / s) * s;
			const step = Math.max(0.25, (b.east - b.west) / 8);
			const area = {
				north: Math.min(80, r(b.north + step, step)),
				south: Math.max(-80, r(b.south - step, step)),
				west: r(b.west - step, step),
				east: r(b.east + step, step)
			};
			const key = JSON.stringify(area);
			if (key === gridKey) return;
			gridKey = key;
			gridLoading = true;
			try {
				const columns = 11;
				const rows = 9;
				const points = await stormGrid(area.north, area.south, area.west, area.east, columns, rows);
				if (key !== gridKey) return;
				grid = { columns, rows, points };
			} catch {
				gridKey = '';
			} finally {
				gridLoading = false;
			}
		}, 700);
	});
	let cape = $derived.by(() => {
		if (!shown.cape || !grid) return null;
		const rows = [];
		for (let r = 0; r < grid.rows; r++) {
			rows.push(
				grid.points.slice(r * grid.columns, (r + 1) * grid.columns).map((p) => ({
					lat: p.lat,
					lon: p.lon,
					value: p.hours[hour]?.cape ?? 0
				}))
			);
		}
		return rows;
	});
	let hourTime = $derived(grid?.points.find((p) => p.hours[hour])?.hours[hour]?.time ?? null);

	// --- A place looked at ----------------------------------------------------------------
	let probe = $state(null);
	let outlook = $state(null);
	let alerts = $state(null);
	let probeError = $state('');
	// Counts the places looked at: answers for an earlier one are dropped
	let probeId = 0;
	async function pick(place) {
		probe = place;
		outlook = null;
		alerts = null;
		probeError = '';
		const id = ++probeId;
		stormOutlook(place.lat, place.lon)
			.then((result) => id === probeId && (outlook = result))
			.catch(() => id === probeId && (probeError = "Couldn't load the forecast"));
		tauriFetch(`https://api.brightsky.dev/alerts?lat=${place.lat}&lon=${place.lon}`)
			.then((response) => (response.ok ? response.json() : { alerts: [] }))
			.then((data) => id === probeId && (alerts = data.alerts ?? []))
			.catch(() => id === probeId && (alerts = []));
	}

	onMount(() => {
		loadRadar();
		const refresh = setInterval(loadRadar, 5 * 60 * 1000);
		let wait = 0;
		const step = setInterval(() => {
			if (!playing || frames.length < 2) return;
			if (frame === frames.length - 1 && wait++ < 3) return;
			wait = 0;
			frame = (frame + 1) % frames.length;
		}, 500);
		return () => {
			clearInterval(refresh);
			clearInterval(step);
			clearTimeout(gridTimer);
		};
	});
	$effect(() => {
		if (home && !probe) pick({ lat: home.lat, lon: home.lon });
	});

	const ago = (time) => {
		const minutes = Math.round((Date.now() / 1000 - time) / 60);
		return minutes <= 0 ? (minutes < -2 ? `in ${-minutes} min` : 'now') : `${minutes} min ago`;
	};
	const clock = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	const SEVERITY = {
		minor: '#facc15',
		moderate: '#fb923c',
		severe: '#ef4444',
		extreme: '#c026d3'
	};
	const LAYERS = [
		{ key: 'radar', label: 'Radar', icon: 'icon-[mingcute--rainstorm-line]' },
		{ key: 'warnings', label: 'DWD warnings', icon: 'icon-[mingcute--warning-line]' },
		{ key: 'cape', label: 'Storm energy (CAPE)', icon: 'icon-[mingcute--flash-line]' }
	];
	const CAPE_LEGEND = [100, 500, 1000, 2000, 3000];
	const css = ([r, g, b, _a]) => `rgb(${r} ${g} ${b})`;
	let probeLevel = $derived(outlook ? LEVELS[outlook.level] : null);
	let widest = $derived(Math.max(500, ...(outlook?.hours.map((x) => x.cape) ?? [])));
</script>

<div class="relative h-full min-h-[560px] overflow-hidden rounded-lg">
	{#if view}
		<StormMap
			lat={view.lat}
			lon={view.lon}
			zoom={view.zoom}
			{layers}
			{cape}
			markers={[
				...(home ? [{ lat: home.lat, lon: home.lon, kind: 'home' }] : []),
				...(probe ? [{ lat: probe.lat, lon: probe.lon, kind: 'probe' }] : [])
			]}
			onmove={moveTo}
			onpick={pick}
			onbounds={(b) => (bounds = b)}
		/>
	{/if}

	<!-- Title and layers -->
	<div class="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none">
		<div
			class="flex items-center gap-2 px-4 h-11 rounded-2xl bg-black/60 backdrop-blur-xl ring-1 ring-white/10 pointer-events-auto"
		>
			<span class="icon-[mingcute--thunderstorm-fill] size-5 text-amber-300"></span>
			<h1 class="font-extrabold tracking-tight">Storm center</h1>
		</div>
		<div class="flex flex-wrap gap-1.5 pointer-events-auto max-w-md">
			{#each LAYERS as layer (layer.key)}
				<button
					class="flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-semibold backdrop-blur-xl ring-1 cursor-pointer transition {shown[
						layer.key
					]
						? 'bg-white text-black ring-white'
						: 'bg-black/55 text-white/80 ring-white/10 hover:bg-black/70'}"
					aria-pressed={!!shown[layer.key]}
					onclick={() => toggle(layer.key)}
				>
					<span class="{layer.icon} size-4"></span>
					{layer.label}
					{#if layer.key === 'cape' && gridLoading}
						<span class="icon-[mingcute--loading-line] size-3.5 animate-spin"></span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Zoom -->
	<div
		class="absolute top-4 right-[22rem] flex flex-col rounded-2xl bg-black/60 backdrop-blur-xl ring-1 ring-white/10"
	>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-primary-300"
			aria-label="Zoom in"
			onclick={() => view && moveTo({ ...view, zoom: Math.min(11, view.zoom + 1) })}
			><span class="icon-[mingcute--add-line] size-4"></span></button
		>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-primary-300"
			aria-label="Zoom out"
			onclick={() => view && moveTo({ ...view, zoom: Math.max(3, view.zoom - 1) })}
			><span class="icon-[mingcute--minimize-line] size-4"></span></button
		>
		{#if home}
			<button
				class="grid place-items-center size-9 cursor-pointer hover:text-primary-300 border-t border-white/10"
				aria-label="Back to {home.name}"
				title="Back to {home.name}"
				onclick={() => moveTo({ lat: home.lat, lon: home.lon, zoom: Math.max(view?.zoom ?? 7, 7) })}
				><span class="icon-[mingcute--location-line] size-4"></span></button
			>
		{/if}
	</div>

	<!-- Time: the radar's past, the forecast hour of the CAPE map -->
	<div class="absolute bottom-4 left-4 right-[22rem] flex flex-col gap-2 pointer-events-none">
		{#if shown.cape && grid}
			<div
				class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-black/60 backdrop-blur-xl ring-1 ring-white/10 pointer-events-auto"
			>
				<span class="icon-[mingcute--flash-fill] size-4 text-amber-300 shrink-0"></span>
				<span class="w-28 shrink-0 text-sm font-semibold tabular-nums"
					>{hourTime ? clock(hourTime) : ''}</span
				>
				<input
					type="range"
					min="0"
					max="23"
					bind:value={hour}
					class="flex-1 accent-amber-400"
					aria-label="Forecast hour"
				/>
				<div class="hidden lg:flex items-center gap-1 text-[10px] text-white/60 tabular-nums">
					{#each CAPE_LEGEND as value (value)}
						<span class="flex items-center gap-1"
							><span class="size-2.5 rounded-sm" style="background: {css(capeColour(value))}"
							></span>{value}</span
						>
					{/each}
					<span>J/kg</span>
				</div>
			</div>
		{/if}
		{#if shown.radar && frames.length}
			<div
				class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-black/60 backdrop-blur-xl ring-1 ring-white/10 pointer-events-auto"
			>
				<button
					class="grid place-items-center size-8 shrink-0 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer"
					aria-label={playing ? 'Pause' : 'Play'}
					onclick={() => (playing = !playing)}
				>
					<span
						class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-4"
					></span>
				</button>
				<span class="w-28 shrink-0 text-sm font-semibold tabular-nums"
					>Radar · {frames[frame] ? ago(frames[frame].time) : ''}</span
				>
				<div class="flex-1 flex gap-0.5">
					{#each frames as f, i (f.path)}
						<button
							class="flex-1 h-2 rounded-full cursor-pointer {i === frame
								? 'bg-white'
								: f.time > Date.now() / 1000
									? 'bg-sky-300/40'
									: 'bg-white/25 hover:bg-white/50'}"
							aria-label={ago(f.time)}
							onclick={() => {
								frame = i;
								playing = false;
							}}
						></button>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- The place looked at -->
	<aside
		class="absolute top-4 right-4 bottom-4 w-[20rem] flex flex-col gap-3 p-4 rounded-2xl bg-black/65 backdrop-blur-xl ring-1 ring-white/10 overflow-y-auto"
	>
		{#if changingPlace}
			<div>
				<p class="text-sm text-white/60 mb-2">Your city, marked on the map:</p>
				<PlacePicker
					uid={UID}
					label="Set my city"
					ondone={() => {
						changingPlace = false;
						probe = null;
						// To the new city
						setWidgetData(UID, { view: null });
						view = null;
					}}
				/>
			</div>
		{/if}
		{#if probe}
			<div>
				<div class="flex items-center gap-2">
					<p
						class="flex-1 min-w-0 truncate text-xs font-bold uppercase tracking-wide text-white/50"
					>
						{home && Math.abs(probe.lat - home.lat) < 0.01 && Math.abs(probe.lon - home.lon) < 0.01
							? home.name
							: `${probe.lat.toFixed(2)}°, ${probe.lon.toFixed(2)}°`} · next 24 h
					</p>
					{#if home && !changingPlace}
						<button
							class="shrink-0 text-[11px] font-semibold text-white/50 hover:text-white cursor-pointer"
							onclick={() => (changingPlace = true)}>Change city</button
						>
					{/if}
				</div>
				{#if outlook && probeLevel}
					<div class="mt-2 flex items-center gap-3">
						<span
							class="grid place-items-center size-12 rounded-2xl text-black"
							style="background: {probeLevel.colour}"
						>
							<span class="icon-[mingcute--thunderstorm-fill] size-7"></span>
						</span>
						<div>
							<p class="text-xl font-extrabold" style="color: {probeLevel.colour}">
								{probeLevel.label}
							</p>
							<p class="text-xs text-white/60">
								{outlook.thunder
									? `Thunder expected from ${outlook.thunder.hour}:00`
									: `Peak energy at ${outlook.peak.hour}:00`}
							</p>
						</div>
					</div>
					<div class="mt-3 grid grid-cols-3 gap-2">
						{#each [['CAPE', Math.round(outlook.peak.cape), 'J/kg', 'Energy for storms'], ['LI', outlook.li.toFixed(1), '', 'Below 0: unstable air'], ['Shear', Math.round(outlook.shear), 'm/s', 'Over 15: organised storms'], ['Gusts', Math.round(outlook.gust * 3.6), 'km/h', 'Strongest gust'], ['Dew point', Math.round(outlook.dew), '°C', 'Moisture in the air'], ['Rain', Math.max(...outlook.hours.map((x) => x.rain)), '%', 'Highest chance']] as [label, value, unit, hint] (label)}
							<div class="p-2 rounded-xl bg-white/5" title={hint}>
								<p class="text-[10px] font-bold uppercase text-white/50">{label}</p>
								<p class="text-lg font-extrabold tabular-nums leading-tight">
									{value}<span class="text-[10px] font-semibold text-white/50"> {unit}</span>
								</p>
							</div>
						{/each}
					</div>
					<!-- Hour by hour: CAPE as bars, coloured by the level of that hour -->
					<div class="mt-3 flex items-end gap-px h-16">
						{#each outlook.hours as h, i (i)}
							{@const level = LEVELS[levelOf(h.cape, h.li, h.shear, h.thunder)]}
							<span
								class="relative flex-1 flex flex-col justify-end h-full"
								title="{h.hour}:00 · CAPE {Math.round(h.cape)} · LI {h.li.toFixed(
									1
								)} · shear {Math.round(h.shear)} m/s · {h.rain}% rain"
							>
								{#if h.thunder}
									<span
										class="absolute -top-0.5 left-1/2 -translate-x-1/2 icon-[mingcute--flash-fill] size-2.5 text-yellow-300"
									></span>
								{/if}
								<span
									class="block rounded-sm"
									style="height: {Math.max(
										5,
										(h.cape / widest) * 100
									)}%; background: {level.colour}"
								></span>
							</span>
						{/each}
					</div>
					<p class="mt-1 flex justify-between text-[10px] text-white/45 tabular-nums">
						<span>{outlook.hours[0]?.hour}:00</span><span>+12h</span><span>+24h</span>
					</p>
				{:else}
					<p class="mt-2 text-sm text-white/60">{probeError || 'Loading the forecast…'}</p>
				{/if}
			</div>
			<div>
				<p class="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">
					DWD warnings here
				</p>
				{#if alerts === null}
					<p class="text-sm text-white/60">Loading…</p>
				{:else if !alerts.length}
					<p class="flex items-center gap-2 text-sm text-white/70">
						<span class="icon-[mingcute--check-circle-fill] size-4 text-green-400"></span>
						None (warnings are for Germany only)
					</p>
				{:else}
					<div class="flex flex-col gap-1.5">
						{#each alerts as alert (alert.id ?? alert.alert_id ?? alert.event_en)}
							<div
								class="p-2 rounded-xl bg-white/5"
								style="box-shadow: inset 3px 0 0 {SEVERITY[alert.severity] ?? '#facc15'}"
							>
								<p class="text-sm font-semibold">{alert.event_en ?? alert.event_de}</p>
								<p class="text-[11px] text-white/55">
									{clock(alert.onset)} – {clock(alert.expires)}
								</p>
								{#if alert.description_en}
									<p class="mt-1 text-xs text-white/70 line-clamp-3">{alert.description_en}</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if home}
			<p class="text-sm text-white/60">Click a place on the map to see its storm outlook.</p>
		{/if}
		<p class="mt-auto text-[11px] text-white/40">
			Click anywhere on the map for its outlook · drag to move · scroll to zoom
		</p>
	</aside>
</div>
