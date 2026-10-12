<script>
	// The storm center, like the tools storm chasers use: Live shows what happens now (rain
	// radar, lightning, DWD warnings, satellite), Forecast the ingredients for storms over the
	// next 24 hours as maps (risk, CAPE, lifted index, shear, gusts). Any place clicked gets
	// its full analysis: outlook, sounding, hodograph and warnings.
	import { onMount, untrack } from 'svelte';
	import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
	import StormMap from '#lib/components/storm/StormMap.svelte';
	import Hodograph from '#lib/components/storm/Hodograph.svelte';
	import SkewT from '#lib/components/storm/SkewT.svelte';
	import {
		widgetData,
		placeOf,
		detectedPlace,
		setWidgetData,
		setPlace,
		clearPlace,
		searchPlaces
	} from '#lib/stores/widgetData.ts';
	import {
		stormOutlook,
		stormGrid,
		stormProfile,
		levelOf,
		LEVELS,
		FIELDS,
		SEVERITY_COLOURS,
		warningAreas,
		compass
	} from '#lib/storm.ts';
	import { tileBounds, distanceKm } from '#lib/map.ts';
	import { strikes, lightningStatus, useLightning, strikesNear } from '#lib/stores/lightning.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { thunderOn, toggleThunder, setListener, setView } from '#lib/stores/thunder.ts';

	const UID = '_storm';
	let saved = $derived($widgetData[UID] ?? {});
	let home = $derived(placeOf($widgetData, UID) ?? $detectedPlace);
	let chosenPlace = $derived(!!placeOf($widgetData, UID));

	// --- The view --------------------------------------------------------------------------
	let view = $state(null);
	// Moved by the user (or from a saved view): finding where you are later doesn't move it
	let viewSettled = false;
	let viewFromHome = false;
	$effect(() => {
		// Lands where you are (or where the map was left); until that's known, over Germany
		const place = home;
		const kept = saved.view;
		untrack(() => {
			if (viewSettled) return;
			if (kept) {
				view = kept;
				viewSettled = true;
			} else if (place && !viewFromHome) {
				view = { lat: place.lat, lon: place.lon, zoom: 7 };
				viewFromHome = true;
			} else if (!view) view = { lat: 51.1, lon: 10.4, zoom: 6 };
		});
	});
	let saveTimer;
	function moveTo(next) {
		viewSettled = true;
		view = next;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => setWidgetData(UID, { view: next }), 800);
	}
	const flyTo = (place, zoom = Math.max(view?.zoom ?? 7, 7)) =>
		moveTo({ lat: place.lat, lon: place.lon, zoom });

	// --- Mode and layers --------------------------------------------------------------------
	let mode = $derived(saved.mode ?? 'live');
	let shown = $derived({
		radar: true,
		lightning: true,
		warnings: true,
		satellite: false,
		rings: true,
		...saved.layers
	});
	let fieldId = $derived(saved.field ?? 'risk');
	let field = $derived(FIELDS.find((f) => f.id === fieldId) ?? FIELDS[0]);
	const setMode = (value) => setWidgetData(UID, { mode: value });
	const toggle = (key) => setWidgetData(UID, { layers: { ...shown, [key]: !shown[key] } });
	const setField = (id) => setWidgetData(UID, { field: id });

	const LIVE_LAYERS = [
		{ key: 'radar', label: 'Radar', icon: 'icon-[mingcute--rainstorm-line]' },
		{ key: 'lightning', label: 'Lightning', icon: 'icon-[mingcute--flash-line]' },
		{ key: 'warnings', label: 'Warnings', icon: 'icon-[mingcute--warning-line]' },
		{ key: 'satellite', label: 'Satellite', icon: 'icon-[mingcute--earth-2-line]' },
		{ key: 'rings', label: 'Range rings', icon: 'icon-[mingcute--radar-line]' }
	];
	const FIELD_ICONS = {
		risk: 'icon-[mingcute--thunderstorm-line]',
		cape: 'icon-[mingcute--fire-line]',
		li: 'icon-[mingcute--arrow-up-circle-line]',
		shear: 'icon-[mingcute--wind-line]',
		gust: 'icon-[mingcute--tornado-line]'
	};

	// --- Rain radar (RainViewer): the last two hours as a loop --------------------------------
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
			const list = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
			const wasLast = frame >= frames.length - 1;
			frames = list;
			if (wasLast || frame >= list.length) frame = Math.max(0, (data.radar?.past?.length ?? 1) - 1);
		} catch {
			frames = [];
		}
	}
	// Meteosat's infrared picture: the coldest (whitest) cloud tops are the storms
	const satelliteUrl = (z, x, y) => {
		const b = tileBounds(x, y, z);
		return `https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.1.1&request=GetMap&layers=msg_fes:ir108&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox=${b.minX},${b.minY},${b.maxX},${b.maxY}`;
	};
	// Every radar frame is a layer, only one seen: switching is instant, nothing reloads
	let layers = $derived([
		...(mode === 'live' && shown.satellite
			? [{ key: 'satellite', url: satelliteUrl, opacity: 0.55, maxZoom: 9 }]
			: []),
		...(mode === 'live' && shown.radar
			? frames.map((f, i) => ({
					key: f.path,
					url: (z, x, y) => `${host}${f.path}/256/${z}/${x}/${y}/2/1_1.png`,
					opacity: i === frame ? 0.9 : 0,
					maxZoom: 7,
					clean: true
				}))
			: [])
	]);

	// --- DWD warnings as areas ----------------------------------------------------------------
	let warnings = $state(null);
	let warningsError = $state(false);
	async function loadWarnings() {
		try {
			warnings = await warningAreas(tauriFetch);
			warningsError = false;
		} catch (error) {
			console.warn('Could not load the DWD warnings', error);
			warningsError = true;
		}
	}

	// --- Lightning ----------------------------------------------------------------------------
	// Heard from where you are
	$effect(() => setListener(home));
	// Strikes on the map crackle
	$effect(() => setView(mode === 'live' && shown.lightning ? bounds : null));
	const NEAR_KM = 15;
	let nearby = $derived(home ? strikesNear($strikes, home, 50, 15 * 60 * 1000) : null);
	let warnedAt = 0;
	$effect(() => {
		const nearest = nearby?.nearest;
		if (!nearest || nearest.km > NEAR_KM || Date.now() - nearest.time > 60000) return;
		if (Date.now() - warnedAt < 5 * 60 * 1000) return;
		warnedAt = Date.now();
		showToast(
			`Lightning ${Math.round(nearest.km)} km ${compass(nearest.bearing)} of you`,
			'icon-[mingcute--flash-fill]',
			8000
		);
	});

	// --- Forecast fields: a grid of forecasts over the map ------------------------------------
	let bounds = $state(null);
	let grid = $state(null);
	let gridKey = '';
	let gridLoading = $state(false);
	let gridError = $state('');
	// Areas loaded before (for 20 minutes): moving back and forth doesn't load them again
	const gridCache = new Map();
	let hour = $state(0);
	let gridTimer;
	$effect(() => {
		const b = bounds;
		if (mode !== 'forecast' || !b) return;
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
			const cached = gridCache.get(key);
			if (cached && Date.now() - cached.at < 20 * 60 * 1000) {
				grid = cached.grid;
				gridError = '';
				return;
			}
			gridLoading = true;
			try {
				const columns = 12;
				const rows = 10;
				const points = await stormGrid(area.north, area.south, area.west, area.east, columns, rows);
				if (key !== gridKey) return;
				grid = { columns, rows, points };
				gridError = '';
				gridCache.set(key, { at: Date.now(), grid });
			} catch (error) {
				if (key !== gridKey) return;
				gridKey = '';
				gridError = `Couldn't load the forecast${error?.message ? `: ${error.message}` : ''}`;
			} finally {
				if (key === gridKey || !gridKey) gridLoading = false;
			}
		}, 600);
	});
	let mapField = $derived.by(() => {
		if (mode !== 'forecast' || !grid) return null;
		const rows = [];
		for (let r = 0; r < grid.rows; r++) {
			rows.push(
				grid.points.slice(r * grid.columns, (r + 1) * grid.columns).map((p) => ({
					lat: p.lat,
					lon: p.lon,
					value: p.hours[hour] ? field.value(p.hours[hour]) : 0
				}))
			);
		}
		return { rows, colour: field.colour };
	});
	let hourTime = $derived(grid?.points.find((p) => p.hours[hour])?.hours[hour]?.time ?? null);

	/** The field's value at a place (between the grid points) */
	function fieldAt(place) {
		const rows = mapField?.rows;
		if (!rows) return null;
		const north = rows[0][0].lat;
		const south = rows[rows.length - 1][0].lat;
		const west = rows[0][0].lon;
		const east = rows[0][rows[0].length - 1].lon;
		const fr = ((north - place.lat) / (north - south)) * (rows.length - 1);
		const fc = ((place.lon - west) / (east - west)) * (rows[0].length - 1);
		if (fr < 0 || fc < 0 || fr > rows.length - 1 || fc > rows[0].length - 1) return null;
		const r0 = Math.floor(fr);
		const c0 = Math.floor(fc);
		const r1 = Math.min(rows.length - 1, r0 + 1);
		const c1 = Math.min(rows[0].length - 1, c0 + 1);
		const tr = fr - r0;
		const tc = fc - c0;
		return (
			(rows[r0][c0].value * (1 - tc) + rows[r0][c1].value * tc) * (1 - tr) +
			(rows[r1][c0].value * (1 - tc) + rows[r1][c1].value * tc) * tr
		);
	}

	// --- The pointer ----------------------------------------------------------------------
	let hover = $state(null);
	let readout = $derived.by(() => {
		if (!hover) return null;
		const coords = `${hover.lat.toFixed(2)}°, ${hover.lon.toFixed(2)}°`;
		if (mode === 'forecast') {
			const value = fieldAt(hover);
			if (value == null) return { coords, text: '' };
			const text =
				field.id === 'risk'
					? LEVELS[Math.min(4, Math.round(value))].label
					: `${field.id === 'li' ? value.toFixed(1) : Math.round(value)} ${field.unit}`;
			return { coords, text: `${field.label} ${text}` };
		}
		if (!home) return { coords, text: '' };
		const km = distanceKm(home, hover);
		const y = Math.sin(((hover.lon - home.lon) * Math.PI) / 180);
		const x =
			Math.cos((home.lat * Math.PI) / 180) * Math.tan((hover.lat * Math.PI) / 180) -
			Math.sin((home.lat * Math.PI) / 180) * Math.cos(((hover.lon - home.lon) * Math.PI) / 180);
		const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
		return { coords, text: `${Math.round(km)} km ${compass(bearing)} of ${home.name}` };
	});

	// --- A place looked at --------------------------------------------------------------------
	let probe = $state(null);
	let probeName = $state('');
	let outlook = $state(null);
	let alerts = $state(null);
	let pickedWarnings = $state([]);
	let probeError = $state('');
	let profile = $state(null);
	let profileAt = $state('peak');
	let tab = $state('overview');
	let panelOpen = $state(true);
	// Answers for a place looked at before are dropped
	let probeId = 0;
	function pick(place, areas = [], name = '') {
		probe = place;
		probeName = name;
		pickedWarnings = areas;
		outlook = null;
		alerts = null;
		profile = null;
		probeError = '';
		panelOpen = true;
		if (areas.length) tab = 'warnings';
		const id = ++probeId;
		stormOutlook(place.lat, place.lon)
			.then((result) => {
				if (id !== probeId) return;
				outlook = result;
				loadProfile(id);
			})
			.catch(
				(error) =>
					id === probeId &&
					(probeError = `Couldn't load the forecast${error?.message ? `: ${error.message}` : ''}`)
			);
		tauriFetch(`https://api.brightsky.dev/alerts?lat=${place.lat}&lon=${place.lon}`)
			.then((response) => (response.ok ? response.json() : { alerts: [] }))
			.then((data) => id === probeId && (alerts = data.alerts ?? []))
			.catch(() => id === probeId && (alerts = []));
	}
	function loadProfile(id = probeId) {
		if (!probe) return;
		const time = profileAt === 'peak' && outlook ? outlook.peak.time : Date.now();
		stormProfile(probe.lat, probe.lon, time)
			.then((result) => id === probeId && (profile = result))
			.catch(() => id === probeId && (profile = null));
	}
	$effect(() => {
		if (home && !probe) pick({ lat: home.lat, lon: home.lon }, [], home.name);
	});
	let probeLabel = $derived(
		probeName ||
			(probe && home && distanceKm(home, probe) < 1
				? home.name
				: probe
					? `${probe.lat.toFixed(2)}°, ${probe.lon.toFixed(2)}°`
					: '')
	);
	let probeLevel = $derived(outlook ? LEVELS[outlook.level] : null);
	let widest = $derived(Math.max(500, ...(outlook?.hours.map((x) => x.cape) ?? [])));

	// --- Finding a place ----------------------------------------------------------------------
	let query = $state('');
	let results = $state([]);
	let searchTimer;
	function search() {
		clearTimeout(searchTimer);
		const name = query.trim();
		if (name.length < 2) {
			results = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			try {
				results = await searchPlaces(name);
			} catch {
				results = [];
			}
		}, 300);
	}
	function goToPlace(place, makeHome = false) {
		query = '';
		results = [];
		if (makeHome) setPlace(UID, place);
		flyTo(place, Math.max(view?.zoom ?? 7, 8));
		pick({ lat: place.lat, lon: place.lon }, [], place.name);
	}
	function useMyLocation() {
		clearPlace();
		const place = $detectedPlace;
		if (place) goToPlace(place);
	}

	onMount(() => {
		const stopLightning = useLightning();
		loadRadar();
		loadWarnings();
		const refresh = setInterval(
			() => {
				loadRadar();
				loadWarnings();
			},
			5 * 60 * 1000
		);
		let wait = 0;
		const step = setInterval(() => {
			if (!playing || frames.length < 2) return;
			if (frame === frames.length - 1 && wait++ < 4) return;
			wait = 0;
			frame = (frame + 1) % frames.length;
		}, 450);
		return () => {
			stopLightning();
			setView(null);
			clearInterval(refresh);
			clearInterval(step);
			clearTimeout(gridTimer);
			clearTimeout(saveTimer);
		};
	});

	const ago = (seconds) => {
		const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
		return minutes <= 0 ? (minutes < -2 ? `in ${-minutes} min` : 'now') : `−${minutes} min`;
	};
	const clock = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	const hhmm = (ms) =>
		new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const time = (value) => (value ? clock(value) : '');
	const css = ([r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.6)})`;
	const PANEL_TABS = [
		{ id: 'overview', label: 'Outlook' },
		{ id: 'sounding', label: 'Sounding' },
		{ id: 'hodograph', label: 'Hodograph' },
		{ id: 'warnings', label: 'Warnings' }
	];
	const glass = 'bg-[#15181d]/85 backdrop-blur-xl ring-1 ring-white/10 shadow-xl shadow-black/30';
</script>

<div class="relative h-full min-h-[560px] overflow-hidden rounded-lg bg-[#111418]">
	{#if view}
		<StormMap
			lat={view.lat}
			lon={view.lon}
			zoom={view.zoom}
			{layers}
			field={mapField}
			warnings={shown.warnings ? warnings : null}
			strikes={mode === 'live' && shown.lightning ? $strikes : null}
			{home}
			{probe}
			rings={shown.rings ? [25, 50, 100] : []}
			onmove={moveTo}
			onpick={(place, areas) => pick(place, areas)}
			onhover={(place) => (hover = place)}
			onbounds={(b) => (bounds = b)}
		/>
	{/if}

	<!-- Top: place, search and the two modes -->
	<div
		class="absolute top-3 left-3 flex items-center gap-2 {panelOpen
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		<div class="flex items-center gap-2 h-11 pl-3 pr-1.5 rounded-2xl {glass}">
			<span class="icon-[mingcute--thunderstorm-fill] size-5 text-amber-300"></span>
			<span class="font-extrabold tracking-tight hidden xl:block">Storm center</span>
			<div class="relative ms-1">
				<span
					class="absolute left-2.5 top-1/2 -translate-y-1/2 icon-[mingcute--search-line] size-4 text-white/40"
				></span>
				<input
					bind:value={query}
					oninput={search}
					onkeydown={(e) => e.key === 'Enter' && results[0] && goToPlace(results[0])}
					placeholder="Search a place"
					class="w-56 h-8 pl-8 pr-2 rounded-xl bg-white/[0.06] text-sm outline-none ring-1 ring-white/10 focus:ring-white/30 placeholder:text-white/35"
				/>
				{#if results.length}
					<div class="absolute left-0 top-10 z-20 w-80 p-1 rounded-xl {glass}">
						{#each results as place (place.lat + ',' + place.lon)}
							<div class="flex items-center gap-1 rounded-lg hover:bg-white/[0.07]">
								<button
									class="flex-1 min-w-0 text-start px-2.5 py-1.5 cursor-pointer"
									onclick={() => goToPlace(place)}
								>
									<span class="block text-sm font-semibold truncate">{place.name}</span>
									<span class="block text-xs text-white/50 truncate">{place.region}</span>
								</button>
								<button
									class="shrink-0 me-1 px-2 h-7 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
									title="Use as your place: marked on the map, for warnings and lightning near you"
									onclick={() => goToPlace(place, true)}>Set as mine</button
								>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<button
				class="flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-sm font-semibold hover:bg-white/10 cursor-pointer {chosenPlace
					? 'text-white/70'
					: 'text-sky-300'}"
				title={chosenPlace
					? `Your place is set to ${home?.name}. Click to use where you are instead`
					: `Where you are, found by your internet address`}
				onclick={useMyLocation}
			>
				<span class="icon-[mingcute--location-line] size-4"></span>
				<span class="max-w-28 truncate">{home?.name ?? 'Locating…'}</span>
			</button>
		</div>
		<div class="flex p-1 h-11 rounded-2xl {glass}" role="group" aria-label="Mode">
			{#each [['live', 'Live', 'icon-[mingcute--radar-2-line]'], ['forecast', 'Forecast', 'icon-[mingcute--chart-line-line]']] as [value, label, icon] (value)}
				<button
					class="flex items-center gap-1.5 px-3.5 rounded-xl text-sm font-semibold cursor-pointer transition {mode ===
					value
						? 'bg-white text-black'
						: 'text-white/65 hover:text-white'}"
					aria-pressed={mode === value}
					onclick={() => setMode(value)}><span class="{icon} size-4"></span>{label}</button
				>
			{/each}
		</div>
		{#if !panelOpen}
			<button
				class="ms-auto flex items-center gap-2 h-11 px-4 rounded-2xl text-sm font-semibold cursor-pointer {glass}"
				onclick={() => (panelOpen = true)}
				><span class="icon-[mingcute--layout-right-line] size-4"></span>Analysis</button
			>
		{/if}
	</div>

	<!-- Left: the layers (Live) or the forecast maps (Forecast) -->
	<div class="absolute left-3 top-[4.25rem] w-44 flex flex-col gap-0.5 p-1.5 rounded-2xl {glass}">
		{#if mode === 'live'}
			<p class="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
				Layers
			</p>
			{#each LIVE_LAYERS as layer (layer.key)}
				<button
					class="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer transition {shown[
						layer.key
					]
						? 'bg-white/10 text-white'
						: 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'}"
					aria-pressed={!!shown[layer.key]}
					onclick={() => toggle(layer.key)}
				>
					<span class="{layer.icon} size-[18px]"></span>
					<span class="flex-1 text-start">{layer.label}</span>
					{#if layer.key === 'lightning' && shown.lightning}
						<span
							class="size-1.5 rounded-full {$lightningStatus === 'live'
								? 'bg-green-400'
								: 'bg-amber-400 animate-pulse'}"
							title={$lightningStatus === 'live' ? 'Live' : 'Connecting'}
						></span>
					{:else if layer.key === 'warnings' && shown.warnings}
						<span class="text-[11px] tabular-nums text-white/50"
							>{warningsError ? '!' : (warnings?.length ?? '…')}</span
						>
					{/if}
				</button>
			{/each}
		{:else}
			<p class="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
				Forecast maps
			</p>
			{#each FIELDS as f (f.id)}
				<button
					class="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer transition {fieldId ===
					f.id
						? 'bg-white text-black'
						: 'text-white/60 hover:text-white hover:bg-white/[0.06]'}"
					title={f.hint}
					onclick={() => setField(f.id)}
				>
					<span class="{FIELD_ICONS[f.id]} size-[18px]"></span>
					<span class="flex-1 text-start">{f.label}</span>
				</button>
			{/each}
			<div class="my-1 h-px bg-white/10"></div>
			<button
				class="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer {shown.warnings
					? 'bg-white/10 text-white'
					: 'text-white/45 hover:text-white/80'}"
				onclick={() => toggle('warnings')}
				><span class="icon-[mingcute--warning-line] size-[18px]"></span>Warnings</button
			>
		{/if}
	</div>

	<!-- Zoom -->
	<div
		class="absolute bottom-24 flex flex-col rounded-2xl {glass} {panelOpen
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300"
			aria-label="Zoom in"
			onclick={() => view && moveTo({ ...view, zoom: Math.min(11, view.zoom + 1) })}
			><span class="icon-[mingcute--add-line] size-4"></span></button
		>
		<button
			class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
			aria-label="Zoom out"
			onclick={() => view && moveTo({ ...view, zoom: Math.max(3, view.zoom - 1) })}
			><span class="icon-[mingcute--minimize-line] size-4"></span></button
		>
		{#if home}
			<button
				class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
				aria-label="Back to {home.name}"
				title="Back to {home.name}"
				onclick={() => flyTo(home)}
				><span class="icon-[mingcute--aiming-2-line] size-4"></span></button
			>
		{/if}
	</div>

	<!-- Bottom: time -->
	<div
		class="absolute bottom-3 left-3 flex flex-col gap-2 pointer-events-none {panelOpen
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		{#if readout}
			<div class="self-end px-3 py-1.5 rounded-xl text-xs tabular-nums {glass}">
				<span class="text-white/50">{readout.coords}</span>
				{#if readout.text}<span class="ms-2 font-semibold">{readout.text}</span>{/if}
			</div>
		{/if}
		{#if mode === 'forecast' && gridError}
			<div
				class="self-start flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-rose-200 {glass}"
			>
				<span class="icon-[mingcute--warning-line] size-4 shrink-0 text-rose-400"></span>
				{gridError}
			</div>
		{/if}
		{#if mode === 'live'}
			<div class="flex items-center gap-3 h-14 px-3 rounded-2xl pointer-events-auto {glass}">
				<button
					class="grid place-items-center size-9 shrink-0 rounded-full bg-white text-black cursor-pointer hover:scale-105 transition disabled:opacity-40"
					aria-label={playing ? 'Pause the radar' : 'Play the radar'}
					disabled={!shown.radar || !frames.length}
					onclick={() => (playing = !playing)}
				>
					<span
						class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-4"
					></span>
				</button>
				<div class="w-24 shrink-0 leading-tight">
					<p class="text-sm font-bold tabular-nums">
						{frames[frame] ? hhmm(frames[frame].time * 1000) : '–'}
					</p>
					<p class="text-[11px] text-white/50 tabular-nums">
						{frames[frame]
							? `Radar ${ago(frames[frame].time)}`
							: shown.radar
								? 'Loading…'
								: 'Radar off'}
					</p>
				</div>
				<input
					type="range"
					min="0"
					max={Math.max(0, frames.length - 1)}
					bind:value={frame}
					oninput={() => (playing = false)}
					disabled={!shown.radar || !frames.length}
					class="flex-1 accent-sky-400"
					aria-label="Radar time"
				/>
				{#if shown.lightning}
					<div class="hidden md:block w-px h-8 bg-white/10"></div>
					<button
						class="grid place-items-center size-9 shrink-0 rounded-full cursor-pointer transition {$thunderOn
							? 'bg-yellow-300 text-black'
							: 'bg-white/[0.06] text-white/70 hover:text-white'}"
						title={$thunderOn
							? 'Lightning sound on: a crackle for each new strike on the map, thunder for those within 40 km of you, as late as the sound needs to reach you'
							: 'Hear the lightning'}
						aria-label={$thunderOn ? 'Turn the lightning sound off' : 'Hear the lightning'}
						aria-pressed={$thunderOn}
						onclick={toggleThunder}
					>
						<span
							class="{$thunderOn
								? 'icon-[mingcute--volume-fill]'
								: 'icon-[mingcute--volume-off-line]'} size-4"
						></span>
					</button>
					<div class="hidden md:flex items-center gap-2 shrink-0 text-sm">
						<span
							class="icon-[mingcute--flash-fill] size-5 {nearby?.count
								? 'text-yellow-300'
								: 'text-white/30'}"
						></span>
						<div class="leading-tight">
							<p class="font-bold tabular-nums">
								{nearby?.count ?? 0}
								<span class="font-normal text-white/50">strikes · 50 km · 15 min</span>
							</p>
							<p class="text-[11px] text-white/60">
								{#if $lightningStatus !== 'live'}
									Lightning connecting…
								{:else if nearby?.nearest}
									Nearest {Math.round(nearby.nearest.km)} km {compass(nearby.nearest.bearing)}, {Math.max(
										0,
										Math.round((Date.now() - nearby.nearest.time) / 60000)
									)} min ago
								{:else}
									None near {home?.name ?? 'you'}
								{/if}
							</p>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex items-center gap-3 h-14 px-3 rounded-2xl pointer-events-auto {glass}">
				<div class="w-32 shrink-0 leading-tight">
					<p class="text-sm font-bold">{hourTime ? clock(hourTime) : '–'}</p>
					<p class="text-[11px] text-white/50">
						{gridLoading ? 'Loading the forecast…' : `+${hour} h · ${field.label}`}
					</p>
				</div>
				<input
					type="range"
					min="0"
					max="23"
					bind:value={hour}
					class="flex-1 accent-amber-400"
					aria-label="Forecast hour"
				/>
				<div
					class="hidden lg:flex items-center gap-1.5 shrink-0 text-[10px] text-white/60 tabular-nums"
				>
					{#each field.legend as value (value)}
						<span class="flex items-center gap-1">
							<span class="size-2.5 rounded-sm" style="background: {css(field.colour(value))}"
							></span>
							{field.id === 'risk' ? LEVELS[value].label : value}
						</span>
					{/each}
					{#if field.unit}<span>{field.unit}</span>{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Right: the analysis of the place looked at -->
	{#if panelOpen}
		<aside
			class="absolute top-3 right-3 bottom-3 w-[23rem] flex flex-col rounded-2xl overflow-hidden {glass}"
		>
			<header class="p-4 pb-3 border-b border-white/[0.06]">
				<div class="flex items-start gap-3">
					{#if probeLevel}
						<span
							class="grid place-items-center size-11 shrink-0 rounded-xl text-black"
							style="background: {probeLevel.colour}"
						>
							<span class="icon-[mingcute--thunderstorm-fill] size-6"></span>
						</span>
					{:else}
						<span class="grid place-items-center size-11 shrink-0 rounded-xl bg-white/5">
							{#if probeError}
								<span class="icon-[mingcute--warning-line] size-5 text-rose-400"></span>
							{:else}
								<span class="icon-[mingcute--loading-line] size-5 animate-spin text-white/40"
								></span>
							{/if}
						</span>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="font-bold truncate">{probeLabel || 'Click the map'}</p>
						<p class="text-sm" style="color: {probeLevel?.colour ?? 'inherit'}">
							{#if outlook && probeLevel}
								{probeLevel.label} ·
								<span class="text-white/60"
									>{outlook.thunder
										? `thunder from ${outlook.thunder.hour}:00`
										: `peak energy ${outlook.peak.hour}:00`}</span
								>
							{:else}
								<span class="text-white/50">{probeError || 'Loading…'}</span>
							{/if}
						</p>
					</div>
					<button
						class="grid place-items-center size-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
						aria-label="Hide the analysis"
						onclick={() => (panelOpen = false)}
						><span class="icon-[mingcute--close-line] size-4"></span></button
					>
				</div>
				<div class="mt-3 grid grid-cols-4 p-1 rounded-xl bg-white/[0.05] text-xs font-semibold">
					{#each PANEL_TABS as t (t.id)}
						<button
							class="relative h-7 rounded-lg cursor-pointer transition {tab === t.id
								? 'bg-white/15 text-white'
								: 'text-white/55 hover:text-white'}"
							onclick={() => (tab = t.id)}
						>
							{t.label}
							{#if t.id === 'warnings' && (alerts?.length || pickedWarnings.length)}
								<span class="absolute top-1 right-1.5 size-1.5 rounded-full bg-amber-400"></span>
							{/if}
						</button>
					{/each}
				</div>
			</header>

			<div class="flex-1 min-h-0 overflow-y-auto p-4">
				{#if tab === 'overview'}
					{#if outlook}
						<div class="grid grid-cols-3 gap-2">
							{#each [['CAPE', Math.round(outlook.peak.cape), 'J/kg', 'Energy for storms (500+: storms, 2000+: violent)'], ['LI', outlook.li.toFixed(1), '', 'Lifted index: below 0 unstable, below −4 very'], ['Shear', Math.round(outlook.shear), 'm/s', 'Deep shear: 20+ supercells'], ['Gusts', Math.round(outlook.gust * 3.6), 'km/h', 'Strongest gust'], ['Dew point', Math.round(outlook.dew), '°C', 'Moisture: 15+ fuels strong storms'], ['Rain', Math.max(...outlook.hours.map((x) => x.rain)), '%', 'Highest chance of rain']] as [label, value, unit, hint] (label)}
								<div class="p-2.5 rounded-xl bg-white/[0.04]" title={hint}>
									<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">{label}</p>
									<p class="text-lg font-extrabold tabular-nums leading-tight">
										{value}<span class="text-[10px] font-semibold text-white/45"> {unit}</span>
									</p>
								</div>
							{/each}
						</div>
						<p class="mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
							Next 24 hours · CAPE, coloured by risk
						</p>
						<div class="flex items-end gap-px h-20">
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
											4,
											(h.cape / widest) * 100
										)}%; background: {level.colour}"
									></span>
								</span>
							{/each}
						</div>
						<p class="mt-1 flex justify-between text-[10px] text-white/40 tabular-nums">
							<span>{outlook.hours[0]?.hour}:00</span><span>+12 h</span><span>+24 h</span>
						</p>
						{#if profile}
							<p class="mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
								Severe ingredients · {clock(profile.time)}
							</p>
							<div class="flex flex-wrap gap-1.5 mb-2">
								{#if profile.stp >= 1}
									<span
										class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-fuchsia-500 text-black"
										>Tornado possible</span
									>
								{/if}
								{#if profile.scp >= 1}
									<span
										class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-500 text-black"
										>Supercells</span
									>
								{/if}
								{#if profile.hail}
									<span
										class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-300 text-black"
										>Large hail</span
									>
								{/if}
								{#if profile.cin < -100}
									<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10"
										>Capped (CIN {Math.round(profile.cin)})</span
									>
								{/if}
								{#if profile.stp < 1 && profile.scp < 1 && !profile.hail}
									<span
										class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/[0.06] text-white/60"
										>No severe signals</span
									>
								{/if}
							</div>
							<div class="grid grid-cols-4 gap-1.5">
								{#each [['SRH 1', Math.round(profile.srh1), 'Helicity 0–1 km (100+: tornadoes)'], ['SRH 3', Math.round(profile.srh3), 'Helicity 0–3 km (150+: supercells)'], ['STP', profile.stp.toFixed(1), 'Significant tornado parameter (1+)'], ['SCP', profile.scp.toFixed(1), 'Supercell composite (1+)'], ['LCL', `${Math.round(profile.lcl)}m`, 'Cloud base (under 1000 m: tornadoes likelier)'], ['CIN', Math.round(profile.cin), 'Inhibition: the lid on storms'], ['0 °C', `${Math.round(profile.freezing)}m`, 'Freezing level (low: hail reaches the ground)'], ['Motion', `${Math.round(profile.motion.speed * 3.6)} ${compass(profile.motion.towards)}`, 'Where a right-moving supercell goes, km/h (Bunkers)']] as [label, value, hint] (label)}
									<div class="p-1.5 rounded-lg bg-white/[0.04]" title={hint}>
										<p class="text-[9px] font-bold uppercase text-white/45">{label}</p>
										<p class="text-sm font-extrabold tabular-nums truncate">{value}</p>
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<p class="text-sm text-white/50">{probeError || 'Loading the forecast…'}</p>
					{/if}
				{:else if tab === 'sounding' || tab === 'hodograph'}
					<div class="flex items-center gap-2 mb-3">
						<p class="flex-1 text-xs text-white/50">
							{profile ? `Model sounding · ${clock(profile.time)}` : 'Loading the sounding…'}
						</p>
						<div class="flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold">
							{#each [['peak', 'Peak'], ['now', 'Now']] as [value, label] (value)}
								<button
									class="px-2 h-6 rounded-md cursor-pointer {profileAt === value
										? 'bg-white/15'
										: 'text-white/55 hover:text-white'}"
									onclick={() => {
										profileAt = value;
										profile = null;
										loadProfile();
									}}>{label}</button
								>
							{/each}
						</div>
					</div>
					{#if profile}
						<div class="grid place-items-center">
							{#if tab === 'sounding'}
								<SkewT {profile} width={330} height={360} />
								<p class="mt-2 text-[11px] text-white/45">
									Red: temperature · green: dew point · dashed: a rising parcel · LCL: cloud base
								</p>
							{:else}
								<Hodograph {profile} size={330} />
								<p class="mt-2 text-[11px] text-white/45">
									Wind with height: red 0–1 km, green 1–3, yellow 3–6, blue above · RM: supercell
									motion
								</p>
							{/if}
						</div>
					{/if}
				{:else}
					{#if pickedWarnings.length}
						<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
							Clicked area
						</p>
						<div class="flex flex-col gap-2 mb-4">
							{#each pickedWarnings as area, i (i)}
								<div
									class="p-3 rounded-xl bg-white/[0.04]"
									style="box-shadow: inset 3px 0 0 {SEVERITY_COLOURS[area.severity]}"
								>
									<p class="font-semibold">{area.headline || area.event}</p>
									<p class="text-[11px] text-white/50">{time(area.onset)} – {time(area.expires)}</p>
									{#if area.description}
										<p class="mt-1 text-xs text-white/70">{area.description}</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
						DWD warnings here
					</p>
					{#if alerts === null}
						<p class="text-sm text-white/50">Loading…</p>
					{:else if !alerts.length}
						<p class="flex items-center gap-2 text-sm text-white/70">
							<span class="icon-[mingcute--check-circle-fill] size-4 text-green-400"></span>
							None (warnings cover Germany)
						</p>
					{:else}
						<div class="flex flex-col gap-2">
							{#each alerts as alert (alert.id ?? alert.alert_id ?? alert.event_en)}
								<div
									class="p-3 rounded-xl bg-white/[0.04]"
									style="box-shadow: inset 3px 0 0 {SEVERITY_COLOURS[alert.severity] ?? '#facc15'}"
								>
									<p class="font-semibold">{alert.event_en ?? alert.event_de}</p>
									<p class="text-[11px] text-white/50">
										{time(alert.onset)} – {time(alert.expires)}
									</p>
									{#if alert.description_en}
										<p class="mt-1 text-xs text-white/70">{alert.description_en}</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
			<footer class="px-4 py-2.5 border-t border-white/[0.06] text-[11px] text-white/40">
				Click the map for any place · drag to move · scroll to zoom
			</footer>
		</aside>
	{/if}
</div>
