<script>
	// The weather center: Live shows what happens now (rain radar, lightning, DWD warnings,
	// satellite, the wind blowing), Forecast the next three days as maps that play hour by hour
	// (temperature, wind, rain and snow, clouds, gusts, pressure, and the storm chasers' risk,
	// CAPE, lifted index and shear) with the values written on them, Quakes the earthquakes of
	// the week (live from the EMSC) over the plates' boundaries. Any place clicked gets its
	// forecast (now, the next two hours, hour by hour, two weeks) and its storm analysis
	// (outlook, sounding, hodograph, warnings); any quake clicked all about it.
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { fastFetch as tauriFetch } from '#lib/fastFetch.ts';
	import StormMap from '#lib/components/storm/StormMap.svelte';
	import Hodograph from '#lib/components/storm/Hodograph.svelte';
	import SkewT from '#lib/components/storm/SkewT.svelte';
	import PlaceForecast from '#lib/components/storm/PlaceForecast.svelte';
	import WeatherIcon from '#lib/components/storm/WeatherIcon.svelte';
	import ForecastTimeline from '#lib/components/storm/ForecastTimeline.svelte';
	import RadarTimeline from '#lib/components/storm/RadarTimeline.svelte';
	import RadarLegend from '#lib/components/storm/RadarLegend.svelte';
	import MapLegend from '#lib/components/storm/MapLegend.svelte';
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
		SEVERITY_COLOURS,
		warningAreas,
		compass
	} from '#lib/storm.ts';
	import { tileBounds, distanceKm, bearing } from '#lib/map.ts';
	import { placeForecast, weatherGrid, gridCache, skyOf } from '#lib/weather.ts';
	import { MAP_LAYERS, legendGradient, limit } from '#lib/weatherLayers.ts';
	import { valuesAt, valueAt, onGrid } from '#lib/weatherField.ts';
	import { strikes, lightningStatus, useLightning, strikesNear } from '#lib/stores/lightning.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { thunderOn, toggleThunder, setListener, setView } from '#lib/stores/thunder.ts';
	import { goto } from '$app/navigation';
	import FlightPanel from '#lib/components/flights/FlightPanel.svelte';
	import {
		planes,
		followed,
		followedTrack,
		setFlightArea,
		useFlights
	} from '#lib/stores/flights.ts';
	import { kmBetween, flightInfo } from '#lib/flights.ts';
	import QuakeRail from '#lib/components/quakes/QuakeRail.svelte';
	import QuakeLegend from '#lib/components/quakes/QuakeLegend.svelte';
	import QuakePanel from '#lib/components/quakes/QuakePanel.svelte';
	import { quakes, useQuakes, onNewQuakes } from '#lib/stores/quakes.ts';
	import { QUAKE_PERIODS, plateBoundaries } from '#lib/quakes.ts';

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
		// A world further east or west is the same place (zoomed far out the map repeats)
		const kept = { ...next, lon: ((((next.lon + 180) % 360) + 360) % 360) - 180 };
		view = kept;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => setWidgetData(UID, { view: kept }), 800);
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
		flights: false,
		rings: true,
		plates: true,
		wind: true,
		flow: true,
		values: true,
		isobars: false,
		...saved.layers
	});
	let mapLayer = $derived(MAP_LAYERS.find((l) => l.id === saved.layer) ?? MAP_LAYERS[0]);
	// Only the earthquakes zoom out to the whole world
	let minZoom = $derived(mode === 'quakes' ? 2 : 3);
	function setMode(value) {
		setWidgetData(UID, { mode: value });
		if (!view) return;
		// Quakes are seen from further out (a region at least), the weather not from as far
		if (value === 'quakes' && view.zoom > 5) moveTo({ ...view, zoom: 5 });
		else if (value !== 'quakes' && view.zoom < 3) moveTo({ ...view, zoom: 3 });
	}
	const toggle = (key) => setWidgetData(UID, { layers: { ...shown, [key]: !shown[key] } });
	const setLayer = (id) => setWidgetData(UID, { layer: id });

	const LIVE_LAYERS = [
		{ key: 'radar', label: 'Radar', icon: 'icon-[mingcute--rainstorm-line]' },
		{ key: 'lightning', label: 'Lightning', icon: 'icon-[mingcute--flash-line]' },
		{ key: 'wind', label: 'Wind', icon: 'icon-[mingcute--wind-line]' },
		{ key: 'warnings', label: 'Warnings', icon: 'icon-[mingcute--warning-line]' },
		{ key: 'satellite', label: 'Satellite', icon: 'icon-[mingcute--earth-2-line]' },
		{ key: 'flights', label: 'Flights', icon: 'icon-[mingcute--airplane-line]' },
		{ key: 'rings', label: 'Range rings', icon: 'icon-[mingcute--radar-line]' }
	];
	// What's drawn over a forecast map
	let overlays = $derived([
		{
			key: 'flow',
			label: 'Wind flow',
			icon: 'icon-[mingcute--wind-line]',
			hint: 'The wind blowing over the map'
		},
		{
			key: 'values',
			label: 'Values',
			icon: 'icon-[mingcute--hashtag-line]',
			hint: "The map's values written on it"
		},
		...(mapLayer.group === 'weather' && !mapLayer.isobars
			? [
					{
						key: 'isobars',
						label: 'Isobars',
						icon: 'icon-[mingcute--route-line]',
						hint: 'Lines of equal air pressure, with the highs and lows'
					}
				]
			: []),
		{
			key: 'warnings',
			label: 'Warnings',
			icon: 'icon-[mingcute--warning-line]',
			hint: 'The DWD warnings now'
		}
	]);

	// --- Rain radar (RainViewer): the last two hours as a loop --------------------------------
	let frames = $state([]);
	let pastFrames = $state(0);
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
			pastFrames = data.radar?.past?.length ?? list.length;
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
	let layers = $derived(
		mode === 'live' && shown.satellite
			? [{ key: 'satellite', url: satelliteUrl, opacity: 0.55, maxZoom: 9 }]
			: []
	);
	// The radar: all frames' tiles kept as pictures, the one shown drawn (see StormMap)
	let radar = $derived(
		mode === 'live' && shown.radar && frames.length ? { host, frames, frame, opacity: 0.85 } : null
	);
	/** The frames whose tiles are all here for the view */
	let radarReady = new Set();
	function setRadarReady(paths) {
		radarReady = new Set(paths);
	}

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

	// --- The forecast's maps: grids of points over the view (see weather.ts) -------------------
	let bounds = $state(null);
	const weatherGrids = gridCache(weatherGrid);
	const stormGrids = gridCache(stormGrid);
	let weather = $state.raw(null);
	let storm = $state.raw(null);
	let gridLoading = $state(false);
	let gridError = $state('');
	/** Asks again now and then (grids older than half an hour are loaded anew) */
	let gridTick = $state(0);
	let needWeather = $derived(
		(mode === 'forecast' && (mapLayer.group === 'weather' || shown.flow)) ||
			(mode === 'live' && shown.wind)
	);
	let needStorm = $derived(mode === 'forecast' && mapLayer.group === 'storm');
	let gridTimer;
	let gridAsk = 0;
	$effect(() => {
		const b = bounds;
		const wantWeather = needWeather;
		const wantStorm = needStorm;
		void gridTick;
		if (!b) return;
		// One that's here shows at once
		untrack(() => {
			const w = wantWeather && weatherGrids.find(b);
			if (w) weather = w;
			const s = wantStorm && stormGrids.find(b);
			if (s) storm = s;
		});
		clearTimeout(gridTimer);
		gridTimer = setTimeout(async () => {
			const ask = ++gridAsk;
			const jobs = [];
			if (wantWeather && !weatherGrids.find(b))
				jobs.push(weatherGrids.get(b).then((grid) => ask === gridAsk && (weather = grid)));
			if (wantStorm && !stormGrids.find(b))
				jobs.push(stormGrids.get(b).then((grid) => ask === gridAsk && (storm = grid)));
			if (!jobs.length) return;
			gridLoading = true;
			try {
				await Promise.all(jobs);
				if (ask === gridAsk) gridError = '';
			} catch (error) {
				if (ask === gridAsk)
					gridError = `Couldn't load the forecast${error?.message ? `: ${error.message}` : ''}`;
			} finally {
				if (ask === gridAsk) gridLoading = false;
			}
		}, 450);
	});

	// The time shown: hours from this one on (they play smoothly, see ForecastTimeline)
	let base = $state(Math.floor(Date.now() / 3600e3) * 3600e3);
	let liveTime = $state(Date.now());
	let hourOffset = $state(0);
	let forecastPlaying = $state(false);
	let forecastHours = $derived(mapLayer.group === 'storm' ? 48 : 72);
	$effect(() => {
		if (hourOffset > forecastHours - 1) hourOffset = forecastHours - 1;
	});
	let time = $derived(base + hourOffset * 3600e3);
	let mapGrid = $derived(mapLayer.group === 'storm' ? storm : weather);
	let weatherMap = $derived(
		mode === 'forecast' && mapGrid
			? {
					grid: mapGrid,
					layer: mapLayer,
					time,
					playing: forecastPlaying,
					labels: shown.values,
					isobars: mapLayer.group === 'weather' && shown.isobars
				}
			: null
	);
	let windMap = $derived(
		weather && ((mode === 'forecast' && shown.flow) || (mode === 'live' && shown.wind))
			? {
					grid: weather,
					time: mode === 'forecast' ? time : liveTime,
					opacity: mode === 'live' ? 0.7 : 1
				}
			: null
	);

	/** The map's value at a place (for the legend's marker) */
	function layerValueAt(place) {
		const grid = mapGrid;
		const at = grid && onGrid(grid, place.lat, place.lon);
		const values = at && valuesAt(grid, mapLayer.key, time);
		return values
			? limit(mapLayer.key, valueAt(values, grid.columns, grid.rows, at.gx, at.gy))
			: null;
	}

	// --- The pointer ----------------------------------------------------------------------
	let hover = $state(null);
	/** How far and where from your place */
	let hoverWhere = $derived(
		hover && home
			? `${Math.round(distanceKm(home, hover))} km ${compass(bearing(home, hover))} of ${home.name}`
			: ''
	);
	let readout = $derived(
		hover && mode !== 'forecast'
			? { coords: `${hover.lat.toFixed(2)}°, ${hover.lon.toFixed(2)}°`, text: hoverWhere }
			: null
	);
	let hoverValue = $derived(mode === 'forecast' && hover ? layerValueAt(hover) : null);

	// --- Flights over the weather (how they fly around the storms) -------------------------
	let flightsOn = $derived(mode === 'live' && !!shown.flights);
	$effect(() => {
		if (!flightsOn) return;
		const stop = useFlights();
		return () => {
			stop();
			followed.set(null);
		};
	});
	$effect(() => {
		if (!flightsOn || !bounds || !view) return;
		const nm = (kmBetween(view, { lat: bounds.north, lon: bounds.west }) / 1.852) * 1.05;
		setFlightArea({ lat: view.lat, lon: view.lon, radiusNm: nm });
	});
	let flight = $derived(flightsOn ? ($planes.find((p) => p.hex === $followed) ?? null) : null);

	// Where the plane picked comes from and goes (for its route on the map)
	let route = $state(null);
	let routeFor = '';
	$effect(() => {
		const p = flight;
		const key = p ? `${p.hex}/${p.callsign}` : '';
		if (key === routeFor) return;
		routeFor = key;
		route = null;
		if (!p) return;
		flightInfo(p).then((info) => {
			if (routeFor === key) route = { from: info.origin, to: info.destination };
		});
	});

	// --- Earthquakes (the EMSC's, live; see stores/quakes.ts) -----------------------------------
	let quakesOn = $derived(mode === 'quakes');
	let quakePeriod = $derived(
		QUAKE_PERIODS.find((p) => p.id === saved.quakePeriod) ?? QUAKE_PERIODS[1]
	);
	let quakeMinMag = $derived(saved.quakeMinMag ?? 0);
	let quakeSort = $derived(saved.quakeSort ?? 'latest');
	let quakeColour = $derived(saved.quakeColour ?? 'age');
	// The times shown age (and quakes leave the last hour)
	let now = $state(Date.now());
	let shownQuakes = $derived(
		quakesOn
			? $quakes.filter(
					(q) => now - q.time < quakePeriod.ms && (!quakeMinMag || q.mag >= quakeMinMag)
				)
			: []
	);
	let strongestQuake = $derived(
		shownQuakes.reduce((best, q) => (!best || q.mag > best.mag ? q : best), null)
	);
	/** Those on the map, for the list */
	let listedQuakes = $derived.by(() => {
		const b = bounds;
		const span = b ? b.east - b.west : 360;
		const list = b
			? shownQuakes.filter(
					(q) =>
						q.lat <= b.north &&
						q.lat >= b.south &&
						(span >= 360 || (((q.lon - b.west) % 360) + 360) % 360 <= span)
				)
			: shownQuakes;
		return quakeSort === 'strongest'
			? [...list].sort((x, y) => y.mag - x.mag || y.time - x.time)
			: list;
	});
	let quakeId = $state(null);
	let quake = $derived(
		quakesOn && quakeId ? ($quakes.find((q) => q.id === quakeId) ?? null) : null
	);
	// Picked from the list, it stays on the map even when the filters leave it out
	let mapQuakes = $derived(
		quake && !shownQuakes.includes(quake) ? [...shownQuakes, quake] : shownQuakes
	);
	function pickQuake(q, fly = false) {
		quakeId = q.id;
		if (fly) moveTo({ lat: q.lat, lon: q.lon, zoom: Math.max(view?.zoom ?? 5, 6) });
	}
	$effect(() => {
		if (!quakesOn) return;
		const stop = useQuakes();
		// New ones near you, or very strong ones anywhere
		const stopNews = onNewQuakes((list) => {
			const here = home;
			const notable = list.filter(
				(q) => q.mag >= 6 || (here && q.mag >= 2.5 && distanceKm(here, q) <= 300)
			);
			if (!notable.length) return;
			const q = notable.reduce((best, other) => (other.mag > best.mag ? other : best));
			const km = here ? distanceKm(here, q) : Infinity;
			showToast(
				`Earthquake M${q.mag.toFixed(1)} · ${km <= 1000 ? `${Math.round(km)} km ${compass(bearing(here, q))} of you` : q.region}`,
				'icon-[ri--earthquake-fill]',
				8000
			);
		});
		const tick = setInterval(() => (now = Date.now()), 30000);
		return () => {
			stop();
			stopNews();
			clearInterval(tick);
		};
	});
	// Opened for a quake (from the widget): to it once the quakes are here
	let openQuake = page.url.searchParams.get('quake');
	$effect(() => {
		if (!openQuake || !quakesOn) return;
		const q = $quakes.find((other) => other.id === openQuake);
		if (!q) return;
		openQuake = null;
		untrack(() => pickQuake(q, true));
	});
	// The plates' boundaries (where most quakes are)
	let plates = $state.raw(null);
	$effect(() => {
		if (!quakesOn || !shown.plates || plates) return;
		plateBoundaries()
			.then((paths) => (plates = paths))
			.catch((error) => console.warn('Could not load the plate boundaries', error));
	});
	let plateLines = $derived(
		quakesOn && shown.plates && plates
			? { paths: plates, colour: 'rgba(248, 113, 113, 0.45)' }
			: null
	);

	// --- A place looked at --------------------------------------------------------------------
	let probe = $state(null);
	let probeName = $state('');
	let outlook = $state(null);
	let alerts = $state(null);
	let pickedWarnings = $state([]);
	let probeError = $state('');
	let profile = $state(null);
	let profileAt = $state('peak');
	let forecast = $state.raw(null);
	let forecastError = $state('');
	let tab = $state('weather');
	let air = $state('skewt');
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
		forecast = null;
		forecastError = '';
		panelOpen = true;
		if (areas.length) tab = 'warnings';
		const id = ++probeId;
		loadForecast(id);
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
	function loadForecast(id = probeId) {
		if (!probe) return;
		placeForecast(probe.lat, probe.lon)
			.then((result) => id === probeId && (forecast = result))
			.catch(
				(error) =>
					id === probeId &&
					!forecast &&
					(forecastError = `Couldn't load the forecast${error?.message ? `: ${error.message}` : ''}`)
			);
	}
	function loadProfile(id = probeId) {
		if (!probe) return;
		const at = profileAt === 'peak' && outlook ? outlook.peak.time : Date.now();
		stormProfile(probe.lat, probe.lon, at)
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
		// Opened for the earthquakes or the forecast (from the widgets)
		const asked = page.url.searchParams.get('mode');
		if (openQuake || asked === 'quakes') setMode('quakes');
		else if (asked === 'forecast' || asked === 'live') setMode(asked);
		const stopLightning = useLightning();
		loadRadar();
		loadWarnings();
		const refresh = setInterval(
			() => {
				loadRadar();
				loadWarnings();
				loadForecast();
				gridTick++;
			},
			5 * 60 * 1000
		);
		const clock = setInterval(() => {
			liveTime = Date.now();
			const hour = Math.floor(Date.now() / 3600e3) * 3600e3;
			// A new hour: the forecast's time stays where it was
			if (hour !== base) {
				hourOffset = Math.max(0, hourOffset - (hour - base) / 3600e3);
				base = hour;
			}
		}, 60 * 1000);
		let wait = 0;
		let waitLoad = 0;
		const step = setInterval(() => {
			if (!playing || frames.length < 2) return;
			if (frame === frames.length - 1 && wait++ < 4) return;
			const next = (frame + 1) % frames.length;
			// The next frame's tiles first (a few seconds at most)
			if (!radarReady.has(frames[next].path) && waitLoad++ < 12) return;
			wait = 0;
			waitLoad = 0;
			frame = next;
		}, 450);
		return () => {
			stopLightning();
			setView(null);
			clearInterval(refresh);
			clearInterval(clock);
			clearInterval(step);
			clearTimeout(gridTimer);
			clearTimeout(saveTimer);
		};
	});

	const clock = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	const when = (value) => (value ? clock(value) : '');
	const PANEL_TABS = [
		{ id: 'weather', label: 'Weather' },
		{ id: 'overview', label: 'Storms' },
		{ id: 'sounding', label: 'Sounding' },
		{ id: 'warnings', label: 'Warnings' }
	];
	let nowSky = $derived(forecast ? skyOf(forecast.now.code) : null);
	// Something on the right: the plane or quake picked, or the place's forecast and analysis
	let rightOpen = $derived(!!flight || !!quake || (panelOpen && !quakesOn));
	// No blur behind the panels: the map under them moves every frame (the wind), and blurring
	// it again each frame made everything lag. Each panel is a layer of its own, so the map
	// moving under it doesn't paint what's in it again.
	const glass = 'bg-[#15181d]/[0.97] ring-1 ring-white/10 shadow-xl shadow-black/30 transform-gpu';
</script>

<div class="relative h-full min-h-[560px] overflow-hidden rounded-lg bg-[#111418]">
	{#if view}
		<StormMap
			lat={view.lat}
			lon={view.lon}
			zoom={view.zoom}
			{layers}
			{radar}
			onradarready={setRadarReady}
			{minZoom}
			weather={weatherMap}
			wind={windMap}
			warnings={shown.warnings && !quakesOn ? warnings : null}
			strikes={mode === 'live' && shown.lightning ? $strikes : null}
			{home}
			probe={quakesOn ? null : probe}
			rings={shown.rings && mode === 'live' ? [25, 50, 100] : []}
			planes={flightsOn ? $planes : null}
			selectedPlane={$followed}
			planeColour="#f8fafc"
			track={$followedTrack}
			{route}
			quakes={quakesOn ? mapQuakes : null}
			selectedQuake={quakeId}
			{quakeColour}
			lines={plateLines}
			onquake={(q) => pickQuake(q)}
			onplane={(plane) => {
				followed.set(plane.hex);
				panelOpen = true;
			}}
			onmove={moveTo}
			onpick={(place, areas) => {
				followed.set(null);
				if (quakesOn) quakeId = null;
				else pick(place, areas);
			}}
			onhover={(place) => (hover = place)}
			onbounds={(b) => (bounds = b)}
		/>
	{/if}

	<!-- Top: place, search and the modes (their names and the title where there's room) -->
	<div
		class="@container absolute top-3 left-3 z-20 flex items-center gap-2 {rightOpen
			? 'right-[26.5rem]'
			: 'right-3'}"
	>
		<div class="flex items-center gap-2 h-11 pl-3 pr-1.5 rounded-2xl {glass}">
			<span class="icon-[mingcute--sun-cloudy-fill] size-5 text-amber-300"></span>
			<span class="font-extrabold tracking-tight whitespace-nowrap hidden @min-[55rem]:block"
				>Weather</span
			>
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
			{#each [['live', 'Live', 'icon-[mingcute--radar-2-line]'], ['forecast', 'Forecast', 'icon-[mingcute--sun-cloudy-line]'], ['quakes', 'Quakes', 'icon-[ri--earthquake-line]']] as [value, label, icon] (value)}
				<button
					class="flex items-center gap-1.5 px-3.5 rounded-xl text-sm font-semibold cursor-pointer transition {mode ===
					value
						? 'bg-white text-black'
						: 'text-white/65 hover:text-white'}"
					aria-pressed={mode === value}
					title={label}
					onclick={() => setMode(value)}
					><span class="{icon} size-4"></span><span class="hidden @min-[47rem]:inline">{label}</span
					></button
				>
			{/each}
		</div>
		{#if !panelOpen && !flight && !quakesOn}
			<button
				class="ms-auto flex items-center gap-2 h-11 px-3 rounded-2xl text-sm font-semibold cursor-pointer {glass}"
				onclick={() => (panelOpen = true)}
			>
				{#if forecast}
					<WeatherIcon
						code={forecast.now.code}
						day={forecast.now.isDay}
						size={26}
						animated={false}
					/>
					<span class="tabular-nums">{Math.round(forecast.now.temp)}°</span>
				{:else}
					<span class="icon-[mingcute--layout-right-line] size-4"></span>
				{/if}
				<span class="max-w-32 truncate">{probeLabel || 'Forecast'}</span>
			</button>
		{/if}
	</div>

	<!-- Left: the layers (Live), the forecast's maps (Forecast) or the earthquakes (Quakes) -->
	{#if quakesOn}
		<div
			class="absolute left-3 top-[4.25rem] w-72 max-h-[calc(100%-10.5rem)] flex flex-col rounded-2xl overflow-hidden {glass}"
		>
			<QuakeRail
				listed={listedQuakes}
				total={shownQuakes.length}
				strongest={strongestQuake}
				loaded={$quakes.length > 0}
				period={quakePeriod.id}
				minMag={quakeMinMag}
				sort={quakeSort}
				selectedId={quakeId}
				{home}
				{now}
				onchange={(change) => setWidgetData(UID, change)}
				onpick={(q) => pickQuake(q, true)}
			/>
		</div>
	{:else if mode === 'live'}
		<div class="absolute left-3 top-[4.25rem] w-44 flex flex-col gap-0.5 p-1.5 rounded-2xl {glass}">
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
					{:else if layer.key === 'wind' && shown.wind && !weather}
						{#if gridError}
							<span class="text-[11px] text-rose-300" title={gridError}>!</span>
						{:else}
							<span class="icon-[mingcute--loading-line] size-3.5 animate-spin text-white/40"
							></span>
						{/if}
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div
			class="absolute left-3 top-[4.25rem] w-52 max-h-[calc(100%-12rem)] overflow-y-auto flex flex-col gap-0.5 p-1.5 rounded-2xl {glass}"
		>
			{#each [['weather', 'Weather maps'], ['storm', 'Storm maps']] as [group, title] (group)}
				<p
					class="px-2 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/40 {group ===
					'storm'
						? 'mt-1.5'
						: ''}"
				>
					{title}
				</p>
				{#each MAP_LAYERS.filter((l) => l.group === group) as l (l.id)}
					<button
						class="group flex items-center gap-2.5 h-8 px-2.5 rounded-xl text-[13px] font-semibold cursor-pointer transition {mapLayer.id ===
						l.id
							? 'bg-white text-black shadow-md shadow-black/30'
							: 'text-white/65 hover:text-white hover:bg-white/[0.06]'}"
						aria-pressed={mapLayer.id === l.id}
						title={l.hint}
						onclick={() => setLayer(l.id)}
					>
						<span class="{l.icon} size-[17px] shrink-0"></span>
						<span class="flex-1 text-start truncate">{l.label}</span>
						<span
							class="w-7 h-1.5 shrink-0 rounded-full ring-1 {mapLayer.id === l.id
								? 'ring-black/10'
								: 'ring-white/10 opacity-70 group-hover:opacity-100'}"
							style="background: {legendGradient(l)}"
						></span>
					</button>
				{/each}
			{/each}
			<div class="my-1.5 h-px bg-white/10"></div>
			<p class="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
				On the map
			</p>
			{#each overlays as o (o.key)}
				<button
					class="flex items-center gap-2.5 h-8 px-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition {shown[
						o.key
					]
						? 'text-white'
						: 'text-white/45 hover:text-white/80'}"
					aria-pressed={!!shown[o.key]}
					title={o.hint}
					onclick={() => toggle(o.key)}
				>
					<span class="{o.icon} size-[17px] shrink-0"></span>
					<span class="flex-1 text-start">{o.label}</span>
					<span
						class="relative w-7 h-4 shrink-0 rounded-full transition {shown[o.key]
							? 'bg-sky-400'
							: 'bg-white/15'}"
					>
						<span
							class="absolute top-0.5 size-3 rounded-full bg-white shadow transition-all {shown[
								o.key
							]
								? 'left-3.5'
								: 'left-0.5'}"
						></span>
					</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Zoom -->
	<div
		class="absolute bottom-[6.5rem] flex flex-col rounded-2xl {glass} {rightOpen
			? 'right-[26.5rem]'
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
			onclick={() => view && moveTo({ ...view, zoom: Math.max(minZoom, view.zoom - 1) })}
			><span class="icon-[mingcute--minimize-line] size-4"></span></button
		>
		{#if quakesOn}
			<button
				class="grid place-items-center size-9 cursor-pointer hover:text-sky-300 border-t border-white/10"
				aria-label="The whole world"
				title="The whole world"
				onclick={() => moveTo({ lat: 25, lon: view?.lon ?? 15, zoom: 2 })}
				><span class="icon-[mingcute--earth-2-line] size-4"></span></button
			>
		{/if}
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
		class="absolute bottom-3 left-3 flex flex-col gap-2 pointer-events-none {rightOpen
			? 'right-[26.5rem]'
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
			<div class="flex items-center gap-3 h-16 px-3 rounded-2xl pointer-events-auto {glass}">
				<RadarTimeline {frames} past={pastFrames} bind:frame bind:playing on={shown.radar} />
				{#if shown.radar}
					<div class="hidden xl:block"><RadarLegend /></div>
				{/if}
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
		{:else if mode === 'forecast'}
			<div class="flex items-stretch gap-2 pointer-events-auto">
				<div class="hidden lg:flex items-center w-60 shrink-0 px-3.5 rounded-2xl {glass}">
					<MapLegend layer={mapLayer} marker={hoverValue} />
				</div>
				<div class="flex-1 min-w-0 flex items-center h-16 px-3 rounded-2xl {glass}">
					<ForecastTimeline
						{base}
						hours={forecastHours}
						bind:value={hourOffset}
						bind:playing={forecastPlaying}
						loading={gridLoading && !mapGrid}
						label={mapLayer.label}
					/>
				</div>
			</div>
		{:else}
			<div
				class="self-start max-w-full flex items-center gap-3 h-14 px-2 rounded-2xl overflow-hidden pointer-events-auto {glass}"
			>
				<QuakeLegend
					colourBy={quakeColour}
					plates={!!shown.plates}
					sizes={!rightOpen}
					oncolour={(by) => setWidgetData(UID, { quakeColour: by })}
					onplates={() => toggle('plates')}
				/>
			</div>
		{/if}
	</div>

	<!-- Right: the plane picked, or the place's forecast and analysis -->
	{#if flight}
		<aside class="absolute top-3 right-3 bottom-3 w-[25rem] overflow-y-auto rounded-2xl {glass}">
			<FlightPanel
				plane={flight}
				track={$followedTrack}
				onclose={() => followed.set(null)}
				onopen={() => goto(`/flights?hex=${flight.hex}`)}
			/>
		</aside>
	{:else if quake}
		<aside
			class="absolute top-3 right-3 bottom-3 w-[25rem] flex flex-col rounded-2xl overflow-hidden {glass}"
		>
			<QuakePanel
				{quake}
				all={$quakes}
				{home}
				{now}
				onclose={() => (quakeId = null)}
				onpick={(q) => pickQuake(q, true)}
			/>
		</aside>
	{:else if panelOpen && !quakesOn}
		<aside
			class="absolute top-3 right-3 bottom-3 w-[25rem] flex flex-col rounded-2xl overflow-hidden {glass}"
		>
			<header class="px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
				<div class="flex items-center gap-3">
					<span class="grid place-items-center size-11 shrink-0 rounded-xl bg-white/[0.05]">
						{#if forecast}
							<WeatherIcon
								code={forecast.now.code}
								day={forecast.now.isDay}
								size={38}
								animated={false}
							/>
						{:else if forecastError}
							<span class="icon-[mingcute--warning-line] size-5 text-rose-400"></span>
						{:else}
							<span class="icon-[mingcute--loading-line] size-5 animate-spin text-white/40"></span>
						{/if}
					</span>
					<div class="min-w-0 flex-1">
						<p class="font-bold truncate">{probeLabel || 'Click the map'}</p>
						<p class="text-sm text-white/60 truncate">
							{#if forecast && nowSky}
								{nowSky.label} · {Math.round(forecast.now.temp)}°
							{:else}
								{forecastError || 'Loading…'}
							{/if}
						</p>
					</div>
					<button
						class="grid place-items-center size-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
						aria-label="Hide the forecast"
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
							{:else if t.id === 'overview' && outlook && outlook.level > 0}
								<span
									class="absolute top-1 right-1.5 size-1.5 rounded-full"
									style="background: {LEVELS[outlook.level].colour}"
								></span>
							{/if}
						</button>
					{/each}
				</div>
			</header>

			<div class="flex-1 min-h-0 overflow-y-auto p-3">
				{#if tab === 'weather'}
					<PlaceForecast weather={forecast} error={forecastError} />
				{:else if tab === 'overview'}
					{#if outlook && probeLevel}
						<div class="flex items-center gap-3 p-3 mb-3 rounded-2xl bg-white/[0.04]">
							<span
								class="grid place-items-center size-10 shrink-0 rounded-xl text-black"
								style="background: {probeLevel.colour}"
							>
								<span class="icon-[mingcute--thunderstorm-fill] size-6"></span>
							</span>
							<div class="min-w-0">
								<p class="font-extrabold" style="color: {probeLevel.colour}">{probeLevel.label}</p>
								<p class="text-xs text-white/60">
									{outlook.thunder
										? `Thunder possible from ${outlook.thunder.hour}:00`
										: `Most energy at ${outlook.peak.hour}:00`}
								</p>
							</div>
						</div>
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
						<p class="text-sm text-white/50">{probeError || 'Loading the outlook…'}</p>
					{/if}
				{:else if tab === 'sounding'}
					<div class="flex items-center gap-2 mb-3">
						<div class="flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold">
							{#each [['skewt', 'Skew-T'], ['hodograph', 'Hodograph']] as [value, label] (value)}
								<button
									class="px-2 h-6 rounded-md cursor-pointer {air === value
										? 'bg-white/15'
										: 'text-white/55 hover:text-white'}"
									onclick={() => (air = value)}>{label}</button
								>
							{/each}
						</div>
						<p class="flex-1 text-xs text-white/50 truncate">
							{profile ? clock(profile.time) : 'Loading…'}
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
							{#if air === 'skewt'}
								<SkewT {profile} width={350} height={380} />
								<p class="mt-2 text-[11px] text-white/45">
									Red: temperature · green: dew point · dashed: a rising parcel · LCL: cloud base
								</p>
							{:else}
								<Hodograph {profile} size={350} />
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
									<p class="text-[11px] text-white/50">{when(area.onset)} – {when(area.expires)}</p>
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
										{when(alert.onset)} – {when(alert.expires)}
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
