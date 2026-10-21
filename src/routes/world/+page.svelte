<script>
	// The world center: one map with everything that can be followed live, by category.
	// Weather (radar, lightning, DWD warnings, satellite, and the storm forecast maps), Earth
	// (earthquakes, tsunami alerts, disasters, volcanoes, fires, NASA's events, river levels,
	// plate boundaries), Environment (air quality, pollen, UV, waves, dust sensors,
	// radiation), Traffic (flights, public transport moving along its lines, stops with their
	// departures, ships, shared bikes, the Autobahn), Space (the ISS and its passes,
	// satellites, Starlink, launches, aurora and space weather) and Cameras (public webcams
	// with their live picture). A layer can be pinned to show in every category.
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { fastFetch as tauriFetch } from '#lib/fastFetch.ts';
	import WorldMap from '#lib/components/world/WorldMap.svelte';
	import LayerRail from '#lib/components/world/LayerRail.svelte';
	import FeaturePanel from '#lib/components/world/FeaturePanel.svelte';
	import AnalysisPanel from '#lib/components/world/AnalysisPanel.svelte';
	import FlightRail from '#lib/components/world/FlightRail.svelte';
	import SpaceRail from '#lib/components/world/SpaceRail.svelte';
	import FlightPanel from '#lib/components/flights/FlightPanel.svelte';
	import QuakeRail from '#lib/components/quakes/QuakeRail.svelte';
	import QuakeLegend from '#lib/components/quakes/QuakeLegend.svelte';
	import QuakePanel from '#lib/components/quakes/QuakePanel.svelte';
	import {
		widgetData,
		placeOf,
		detectedPlace,
		setWidgetData,
		setPlace,
		clearPlace,
		searchPlaces
	} from '#lib/stores/widgetData.ts';
	import { stormGrid, LEVELS, FIELDS, warningAreas, compass } from '#lib/storm.ts';
	import { tileBounds, distanceKm, bearing } from '#lib/map.ts';
	import { strikes, lightningStatus, useLightning, strikesNear } from '#lib/stores/lightning.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { thunderOn, toggleThunder, setListener, setView } from '#lib/stores/thunder.ts';
	import {
		planes,
		followed,
		followedTrack,
		setFlightArea,
		useFlights,
		flightStatus
	} from '#lib/stores/flights.ts';
	import { kmBetween, flightInfo, planeNow } from '#lib/flights.ts';
	import { quakes, quakeStatus, useQuakes, onNewQuakes } from '#lib/stores/quakes.ts';
	import { QUAKE_PERIODS, plateBoundaries } from '#lib/quakes.ts';
	import { CATEGORIES, LAYERS, LAYER, CATEGORY_FIELDS } from '#lib/world/registry.ts';
	import {
		layerFeatures,
		layerStatus,
		fieldState,
		setActiveLayers,
		setArea,
		setField as showField,
		stopAll
	} from '#lib/world/runtime.ts';
	import { setObserver } from '#lib/world/sources/space.ts';
	import { css } from '#lib/world/features.ts';

	// The storm center's settings go on (the view, the layers, your place)
	const UID = '_storm';
	let saved = $derived($widgetData[UID] ?? {});
	let home = $derived(placeOf($widgetData, UID) ?? $detectedPlace);
	let chosenPlace = $derived(!!placeOf($widgetData, UID));
	const set = (change) => setWidgetData(UID, change);

	// --- The view --------------------------------------------------------------------------
	const MIN_ZOOM = 2;
	const MAX_ZOOM = 16;
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
		saveTimer = setTimeout(() => set({ view: kept }), 800);
	}
	const flyTo = (place, zoom = Math.max(view?.zoom ?? 7, 7)) =>
		moveTo({ lat: place.lat, lon: place.lon, zoom });
	const zoomBy = (step) =>
		view && moveTo({ ...view, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + step)) });

	// --- Categories and layers ----------------------------------------------------------------
	let category = $derived(
		CATEGORIES.some((c) => c.id === saved.category)
			? saved.category
			: saved.mode === 'quakes'
				? 'earth'
				: 'weather'
	);
	let weatherMode = $derived(saved.mode === 'forecast' ? 'forecast' : 'live');
	let on = $derived({
		...Object.fromEntries(LAYERS.map((l) => [l.id, !!l.on])),
		...saved.layers
	});
	let pinned = $derived(saved.pinned ?? []);
	/** Shown now: on, and of this category or pinned */
	const here = (id) => !!on[id] && (LAYER[id]?.category === category || pinned.includes(id));
	// The weather's live layers rest while its forecast maps are shown
	let weatherLive = $derived(category !== 'weather' || weatherMode === 'live');
	const toggle = (id) => set({ layers: { ...on, [id]: !on[id] } });
	function pin(id) {
		const pinning = !pinned.includes(id);
		set({
			pinned: pinning ? [...pinned, id] : pinned.filter((x) => x !== id),
			layers: pinning ? { ...on, [id]: true } : on
		});
	}
	function setCategory(id) {
		set({ category: id });
		if (category === 'weather' || id === 'weather') panelOpen = id === 'weather';
	}
	let railLayers = $derived(LAYERS.filter((l) => l.category === category));
	let railOthers = $derived(
		pinned.map((id) => LAYER[id]).filter((l) => l && l.category !== category)
	);

	// --- The trackers (see world/runtime.ts) ----------------------------------------------------
	let activeSources = $derived(LAYERS.filter((l) => l.source && here(l.id)).map((l) => l.source));
	$effect(() => setActiveLayers(activeSources));
	let mapFeatures = $derived(
		activeSources.filter((s) => !s.moving).flatMap((s) => $layerFeatures[s.id] ?? [])
	);
	let mapMovers = $derived(
		activeSources.filter((s) => s.moving).flatMap((s) => $layerFeatures[s.id] ?? [])
	);
	let bounds = $state(null);
	$effect(() => {
		if (bounds && view) setArea({ ...bounds, lat: view.lat, lon: view.lon, zoom: view.zoom });
	});
	// Each category's coloured map (the weather has its forecast maps)
	const DEFAULT_FIELD = { environment: 'aqi', space: 'aurora' };
	let categoryFields = $derived(CATEGORY_FIELDS[category]);
	let fieldChoice = $derived(
		saved.fields && category in saved.fields
			? saved.fields[category]
			: (DEFAULT_FIELD[category] ?? null)
	);
	let activeField = $derived(categoryFields.find((f) => f.id === fieldChoice) ?? null);
	$effect(() => showField(activeField));
	const chooseField = (id) => set({ fields: { ...saved.fields, [category]: id } });

	// --- Something picked on the map ----------------------------------------------------------
	// Raw: the tracker and its feature stay themselves (compared by identity)
	let picked = $state.raw(null);
	let pickedShown = $derived(picked && activeSources.includes(picked.source) ? picked : null);
	function pickFeature(feature) {
		const source = activeSources.find((s) => $layerFeatures[s.id]?.includes(feature));
		if (!source) return;
		picked = { source, feature };
		quakeId = null;
		followed.set(null);
	}
	/** By its id (from a list, like the launches) */
	function pickFeatureById(id) {
		for (const s of activeSources) {
			const feature = $layerFeatures[s.id]?.find((f) => f.id === id);
			if (feature) {
				pickFeature(feature);
				flyTo(feature, Math.max(view?.zoom ?? 5, 5));
				return;
			}
		}
	}

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
	let radarOn = $derived(here('radar') && weatherLive);
	$effect(() => {
		if (!radarOn) return;
		loadRadar();
		const refresh = setInterval(loadRadar, 5 * 60 * 1000);
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
			clearInterval(refresh);
			clearInterval(step);
		};
	});
	// Meteosat's infrared picture: the coldest (whitest) cloud tops are the storms
	const satelliteUrl = (z, x, y) => {
		const b = tileBounds(x, y, z);
		return `https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.1.1&request=GetMap&layers=msg_fes:ir108&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox=${b.minX},${b.minY},${b.maxX},${b.maxY}`;
	};
	let tileLayers = $derived(
		here('satellite') && weatherLive
			? [{ key: 'satellite', url: satelliteUrl, opacity: 0.55, maxZoom: 9 }]
			: []
	);
	// The radar: all frames' tiles kept as pictures, the one shown drawn (see WorldMap)
	let radar = $derived(radarOn && frames.length ? { host, frames, frame, opacity: 0.85 } : null);
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
	let warningsOn = $derived(here('warnings'));
	$effect(() => {
		if (!warningsOn) return;
		loadWarnings();
		const refresh = setInterval(loadWarnings, 5 * 60 * 1000);
		return () => clearInterval(refresh);
	});

	// --- Lightning ----------------------------------------------------------------------------
	let lightningOn = $derived(here('lightning') && weatherLive);
	$effect(() => {
		if (!lightningOn) return;
		return useLightning();
	});
	// Heard from where you are
	$effect(() => setListener(home));
	// Strikes on the map crackle
	$effect(() => setView(lightningOn ? bounds : null));
	const NEAR_KM = 15;
	let nearby = $derived(
		lightningOn && home ? strikesNear($strikes, home, 50, 15 * 60 * 1000) : null
	);
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
	let fieldId = $derived(saved.field ?? 'risk');
	let field = $derived(FIELDS.find((f) => f.id === fieldId) ?? FIELDS[0]);
	let forecastOn = $derived(category === 'weather' && weatherMode === 'forecast');
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
		if (!forecastOn || !b) return;
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
			const cachedGrid = gridCache.get(key);
			if (cachedGrid && Date.now() - cachedGrid.at < 20 * 60 * 1000) {
				grid = cachedGrid.grid;
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
	let forecastField = $derived.by(() => {
		if (!forecastOn || !grid) return null;
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
	/** The map coloured now: the forecast, or the category's map */
	let mapField = $derived(
		forecastOn
			? forecastField
			: activeField && $fieldState.id === activeField.id && $fieldState.rows
				? { rows: $fieldState.rows, colour: activeField.colour }
				: null
	);

	/** The coloured map's value at a place (between the grid points) */
	function fieldAt(place) {
		const rows = mapField?.rows;
		if (!rows?.length || !rows[0]?.length) return null;
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
		if (mapField) {
			const value = fieldAt(hover);
			if (value != null && isFinite(value)) {
				if (forecastOn) {
					const text =
						field.id === 'risk'
							? LEVELS[Math.min(4, Math.round(value))].label
							: `${field.id === 'li' ? value.toFixed(1) : Math.round(value)} ${field.unit}`;
					return { coords, text: `${field.label} ${text}` };
				}
				const shown = activeField.format ? activeField.format(value) : Math.round(value);
				return { coords, text: `${activeField.label} ${shown} ${activeField.unit}` };
			}
		}
		if (!home) return { coords, text: '' };
		const km = distanceKm(home, hover);
		return {
			coords,
			text: `${Math.round(km)} km ${compass(bearing(home, hover))} of ${home.name}`
		};
	});

	// --- Flights ------------------------------------------------------------------------------
	let flightsOn = $derived(here('flights'));
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
	let why = $state('');
	let follow = $state(false);
	function pickPlane(plane, reason = '') {
		why = reason;
		followed.set(plane.hex);
		picked = null;
		quakeId = null;
		follow = true;
		moveTo({ lat: plane.lat, lon: plane.lon, zoom: Math.max(view?.zoom ?? 7, 7) });
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
		if (flyWhenFound && flight?.hex === flyWhenFound) {
			flyWhenFound = null;
			untrack(() => pickPlane(flight));
		}
	});

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
	let quakesOn = $derived(here('quakes'));
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
		picked = null;
		followed.set(null);
		if (fly) moveTo({ lat: q.lat, lon: q.lon, zoom: Math.max(view?.zoom ?? 5, 6) });
	}
	$effect(() => {
		if (!quakesOn) return;
		const stop = useQuakes();
		// New ones near you, or very strong ones anywhere
		const stopNews = onNewQuakes((list) => {
			const near = home;
			const notable = list.filter(
				(q) => q.mag >= 6 || (near && q.mag >= 2.5 && distanceKm(near, q) <= 300)
			);
			if (!notable.length) return;
			const q = notable.reduce((best, other) => (other.mag > best.mag ? other : best));
			const km = near ? distanceKm(near, q) : Infinity;
			showToast(
				`Earthquake M${q.mag.toFixed(1)} · ${km <= 1000 ? `${Math.round(km)} km ${compass(bearing(near, q))} of you` : q.region}`,
				'icon-[ri--earthquake-fill]',
				8000
			);
		});
		return () => {
			stop();
			stopNews();
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
	let platesOn = $derived(here('plates'));
	$effect(() => {
		if (!platesOn || plates) return;
		plateBoundaries()
			.then((paths) => (plates = paths))
			.catch((error) => console.warn('Could not load the plate boundaries', error));
	});
	let plateLines = $derived(
		platesOn && plates ? { paths: plates, colour: 'rgba(248, 113, 113, 0.45)' } : null
	);

	// --- A place looked at (the weather's analysis) --------------------------------------------
	let probe = $state(null);
	let probeName = $state('');
	let pickedWarnings = $state([]);
	let panelOpen = $state(true);
	function pick(place, areas = [], name = '') {
		probe = place;
		probeName = name;
		pickedWarnings = areas;
		panelOpen = true;
	}
	$effect(() => {
		if (home && !probe) untrack(() => pick({ lat: home.lat, lon: home.lon }, [], home.name));
	});
	let probeLabel = $derived(
		probeName ||
			(probe && home && distanceKm(home, probe) < 1
				? home.name
				: probe
					? `${probe.lat.toFixed(2)}°, ${probe.lon.toFixed(2)}°`
					: '')
	);

	// The ISS's passes over your place
	$effect(() => setObserver(home));

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
		if (category === 'weather') pick({ lat: place.lat, lon: place.lon }, [], place.name);
	}
	function useMyLocation() {
		clearPlace();
		const place = $detectedPlace;
		if (place) goToPlace(place);
	}

	onMount(() => {
		// Opened for a category, a quake or a plane (from the widgets)
		const params = page.url.searchParams;
		const wanted = params.get('category') ?? (params.get('mode') === 'quakes' ? 'earth' : null);
		if (openQuake) set({ category: 'earth' });
		else if (wanted && CATEGORIES.some((c) => c.id === wanted)) set({ category: wanted });
		const hex = params.get('hex')?.toLowerCase();
		if (hex) {
			set({ category: 'traffic' });
			followed.set(hex);
			flyWhenFound = hex;
		}
		const tick = setInterval(() => (now = Date.now()), 30000);
		return () => {
			clearInterval(tick);
			setView(null);
			stopAll();
			clearTimeout(gridTimer);
			clearTimeout(saveTimer);
		};
	});

	// --- What's on the right ------------------------------------------------------------------
	let rightPanel = $derived(
		flight
			? 'flight'
			: quake
				? 'quake'
				: pickedShown
					? 'feature'
					: category === 'weather' && panelOpen && probe
						? 'analysis'
						: null
	);
	let rightOpen = $derived(!!rightPanel);
	function closeRight() {
		if (rightPanel === 'flight') followed.set(null);
		else if (rightPanel === 'quake') quakeId = null;
		else if (rightPanel === 'feature') picked = null;
		else panelOpen = false;
	}

	// The legends under the map: the coloured map's, then those of the layers shown here
	let legends = $derived(
		activeSources
			.filter((s) => s.legend?.length && s.category === category)
			.map((s) => ({ id: s.id, label: s.label, icon: s.icon, items: s.legend }))
	);
	let layerRailStatus = $derived({
		...$layerStatus,
		lightning: { live: $lightningStatus === 'live' },
		warnings: { count: warnings?.length, state: warningsError ? 'error' : undefined },
		quakes: {
			count: shownQuakes.length,
			state: $quakeStatus.state === 'error' ? 'error' : undefined
		},
		flights: {
			count: $planes.length,
			state: $flightStatus.state === 'error' ? 'error' : undefined
		}
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
	const FIELD_ICONS = {
		risk: 'icon-[mingcute--thunderstorm-line]',
		cape: 'icon-[mingcute--fire-line]',
		li: 'icon-[mingcute--arrow-up-circle-line]',
		shear: 'icon-[mingcute--wind-line]',
		gust: 'icon-[mingcute--tornado-line]'
	};
	const glass = 'bg-[#15181d]/85 backdrop-blur-xl ring-1 ring-white/10 shadow-xl shadow-black/30';
</script>

<div class="relative h-full min-h-[560px] overflow-hidden rounded-lg bg-[#111418]">
	{#if view}
		<WorldMap
			lat={view.lat}
			lon={view.lon}
			zoom={view.zoom}
			minZoom={MIN_ZOOM}
			maxZoom={MAX_ZOOM}
			layers={tileLayers}
			{radar}
			onradarready={setRadarReady}
			field={mapField}
			warnings={warningsOn ? warnings : null}
			strikes={lightningOn ? $strikes : null}
			{home}
			probe={category === 'weather' ? probe : null}
			rings={here('rings') ? [25, 50, 100] : []}
			planes={flightsOn ? $planes : null}
			selectedPlane={$followed}
			planeColour={category === 'traffic' ? null : '#f8fafc'}
			track={$followedTrack}
			{route}
			quakes={quakesOn ? mapQuakes : null}
			selectedQuake={quakeId}
			{quakeColour}
			lines={plateLines}
			features={mapFeatures}
			movers={mapMovers}
			selectedFeature={pickedShown?.feature.id ?? null}
			onfeature={pickFeature}
			onquake={(q) => pickQuake(q)}
			onplane={(plane) => pickPlane(plane)}
			onmove={(next) => {
				// Dragged away (zooming keeps following)
				if (next.zoom === view?.zoom) follow = false;
				moveTo(next);
			}}
			onpick={(place, areas) => {
				followed.set(null);
				quakeId = null;
				picked = null;
				if (category === 'weather') pick(place, areas);
			}}
			onhover={(place) => (hover = place)}
			onbounds={(b) => (bounds = b)}
		/>
	{/if}

	<!-- Top: place, search and the categories (names and title where there's room) -->
	<div
		class="@container absolute top-3 left-3 flex items-center gap-2 {rightOpen
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		<div class="flex items-center gap-2 h-11 pl-3 pr-1.5 shrink-0 rounded-2xl {glass}">
			<span class="icon-[mingcute--earth-2-fill] size-5 text-sky-300"></span>
			<span class="font-extrabold tracking-tight whitespace-nowrap hidden @min-[72rem]:block"
				>World center</span
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
					class="w-44 @min-[60rem]:w-56 h-8 pl-8 pr-2 rounded-xl bg-white/[0.06] text-sm outline-none ring-1 ring-white/10 focus:ring-white/30 placeholder:text-white/35"
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
									title="Use as your place: marked on the map, for warnings, lightning, quakes and the ISS passes"
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
				<span class="max-w-24 truncate hidden @min-[50rem]:inline">{home?.name ?? 'Locating…'}</span
				>
			</button>
		</div>
		<div class="flex p-1 h-11 min-w-0 rounded-2xl {glass}" role="group" aria-label="Category">
			{#each CATEGORIES as c (c.id)}
				<button
					class="flex items-center gap-1.5 px-2.5 @min-[64rem]:px-3 rounded-xl text-sm font-semibold cursor-pointer transition {category ===
					c.id
						? 'bg-white text-black'
						: 'text-white/65 hover:text-white'}"
					aria-pressed={category === c.id}
					title={c.label}
					onclick={() => setCategory(c.id)}
					><span class="{c.icon} size-4"></span><span class="hidden @min-[64rem]:inline"
						>{c.label}</span
					></button
				>
			{/each}
		</div>
		{#if category === 'weather' && !rightOpen}
			<button
				class="ms-auto flex items-center gap-2 h-11 px-4 shrink-0 rounded-2xl text-sm font-semibold cursor-pointer {glass}"
				onclick={() => (panelOpen = true)}
				><span class="icon-[mingcute--layout-right-line] size-4"></span>Analysis</button
			>
		{/if}
	</div>

	<!-- Left: the category's layers and what belongs to them -->
	<div
		class="absolute left-3 top-[4.25rem] {category === 'weather'
			? 'w-60'
			: 'w-72'} max-h-[calc(100%-10.5rem)] flex flex-col rounded-2xl overflow-hidden {glass}"
	>
		<div class="min-h-0 overflow-y-auto">
			{#if category === 'weather'}
				<div class="p-1.5 pb-0">
					<div class="grid grid-cols-2 p-0.5 rounded-xl bg-white/[0.05] text-xs font-semibold">
						{#each [['live', 'Live', 'icon-[mingcute--radar-2-line]'], ['forecast', 'Forecast', 'icon-[mingcute--chart-line-line]']] as [value, label, icon] (value)}
							<button
								class="flex items-center justify-center gap-1.5 h-7 rounded-lg cursor-pointer {weatherMode ===
								value
									? 'bg-white text-black'
									: 'text-white/60 hover:text-white'}"
								aria-pressed={weatherMode === value}
								onclick={() => set({ mode: value })}
								><span class="{icon} size-3.5"></span>{label}</button
							>
						{/each}
					</div>
				</div>
				{#if weatherMode === 'forecast'}
					<div class="flex flex-col gap-0.5 p-1.5">
						<p
							class="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40"
						>
							Forecast maps
						</p>
						{#each FIELDS as f (f.id)}
							<button
								class="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer transition {fieldId ===
								f.id
									? 'bg-white text-black'
									: 'text-white/60 hover:text-white hover:bg-white/[0.06]'}"
								title={f.hint}
								onclick={() => set({ field: f.id })}
							>
								<span class="{FIELD_ICONS[f.id]} size-[18px]"></span>
								<span class="flex-1 text-start">{f.label}</span>
							</button>
						{/each}
						<div class="my-1 h-px bg-white/10"></div>
						<button
							class="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer {on.warnings
								? 'bg-white/10 text-white'
								: 'text-white/45 hover:text-white/80'}"
							onclick={() => toggle('warnings')}
							><span class="icon-[mingcute--warning-line] size-[18px]"></span>Warnings</button
						>
					</div>
				{:else}
					<LayerRail
						layers={railLayers}
						others={railOthers}
						{on}
						{pinned}
						status={layerRailStatus}
						ontoggle={toggle}
						onpin={pin}
					/>
				{/if}
			{:else}
				<LayerRail
					layers={railLayers}
					others={railOthers}
					{on}
					{pinned}
					status={layerRailStatus}
					fields={categoryFields}
					fieldId={activeField?.id ?? null}
					fieldState={$fieldState}
					ontoggle={toggle}
					onpin={pin}
					onfield={chooseField}
				/>
				{#if category === 'earth' && quakesOn}
					<div class="border-t border-white/[0.06]">
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
							onchange={set}
							onpick={(q) => pickQuake(q, true)}
						/>
					</div>
				{:else if category === 'traffic' && flightsOn}
					<FlightRail onpick={pickPlane} />
				{:else if category === 'space'}
					<SpaceRail launches={here('launches')} onlaunch={pickFeatureById} />
				{/if}
			{/if}
		</div>
	</div>

	<!-- Zoom -->
	<div
		class="absolute bottom-24 flex flex-col rounded-2xl {glass} {rightOpen
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		{#if flight}
			<button
				class="grid place-items-center size-9 cursor-pointer border-b border-white/10 {follow
					? 'text-amber-300'
					: 'hover:text-sky-300'}"
				aria-label="Follow the plane"
				title="Keep the plane in the middle"
				aria-pressed={follow}
				onclick={() => (follow = !follow)}
				><span class="icon-[mingcute--aiming-line] size-4"></span></button
			>
		{/if}
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
				onclick={() => flyTo(home)}
				><span class="icon-[mingcute--aiming-2-line] size-4"></span></button
			>
		{/if}
	</div>

	<!-- Bottom: the weather's time, or the legends -->
	<div
		class="absolute bottom-3 left-3 flex flex-col gap-2 pointer-events-none {rightOpen
			? 'right-[24.5rem]'
			: 'right-3'}"
	>
		{#if readout}
			<div class="self-end px-3 py-1.5 rounded-xl text-xs tabular-nums {glass}">
				<span class="text-white/50">{readout.coords}</span>
				{#if readout.text}<span class="ms-2 font-semibold">{readout.text}</span>{/if}
			</div>
		{/if}
		{#if forecastOn && gridError}
			<div
				class="self-start flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-rose-200 {glass}"
			>
				<span class="icon-[mingcute--warning-line] size-4 shrink-0 text-rose-400"></span>
				{gridError}
			</div>
		{/if}
		{#if category === 'weather' && weatherMode === 'live'}
			<div class="flex items-center gap-3 h-14 px-3 rounded-2xl pointer-events-auto {glass}">
				<button
					class="grid place-items-center size-9 shrink-0 rounded-full bg-white text-black cursor-pointer hover:scale-105 transition disabled:opacity-40"
					aria-label={playing ? 'Pause the radar' : 'Play the radar'}
					disabled={!radarOn || !frames.length}
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
						{frames[frame] && radarOn
							? `Radar ${ago(frames[frame].time)}`
							: radarOn
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
					disabled={!radarOn || !frames.length}
					class="flex-1 accent-sky-400"
					aria-label="Radar time"
				/>
				{#if lightningOn}
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
		{:else if forecastOn}
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
		{:else if activeField || legends.length || (category === 'earth' && quakesOn)}
			<div
				class="self-start max-w-full flex items-center gap-3 h-14 px-2 rounded-2xl overflow-x-auto overflow-y-hidden pointer-events-auto {glass}"
			>
				{#if activeField}
					<div
						class="flex shrink-0 items-center gap-2 ps-1.5 text-[11px] text-white/65 tabular-nums"
					>
						<span class="{activeField.icon} size-4 text-white/80"></span>
						<span class="leading-tight">
							<span class="block font-semibold text-white">{activeField.label}</span>
							<span class="block text-[10px] text-white/45"
								>{$fieldState.time
									? clock($fieldState.time)
									: $fieldState.state === 'loading'
										? 'Loading…'
										: ''}</span
							>
						</span>
						{#each activeField.legend as value (value)}
							<span class="flex items-center gap-1">
								<span
									class="size-2.5 rounded-sm"
									style="background: {css(activeField.colour(value))}"
								></span>
								{value}
							</span>
						{/each}
						{#if activeField.unit}<span>{activeField.unit}</span>{/if}
					</div>
				{/if}
				{#if category === 'earth' && quakesOn}
					{#if activeField}<div class="w-px h-8 shrink-0 bg-white/10"></div>{/if}
					<QuakeLegend
						colourBy={quakeColour}
						plates={!!on.plates}
						sizes={!rightOpen}
						oncolour={(by) => set({ quakeColour: by })}
						onplates={() => toggle('plates')}
					/>
				{/if}
				{#each legends as legend (legend.id)}
					<div class="w-px h-8 shrink-0 bg-white/10"></div>
					<div
						class="flex shrink-0 items-center gap-2 text-[11px] text-white/65"
						title={legend.label}
					>
						<span class="{legend.icon} size-4 text-white/70"></span>
						{#each legend.items as item (item.label)}
							<span class="flex items-center gap-1 whitespace-nowrap">
								<span class="size-2.5 rounded-full" style="background: {item.colour}"></span>
								{item.label}
							</span>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Right: the plane, quake or thing picked, or the analysis of the place looked at -->
	{#if rightPanel}
		<aside
			class="absolute top-3 right-3 bottom-3 w-[23rem] flex flex-col rounded-2xl overflow-hidden {glass}"
		>
			{#if rightPanel === 'flight'}
				<div class="flex-1 min-h-0 overflow-y-auto">
					<FlightPanel plane={flight} {why} track={$followedTrack} onclose={closeRight} />
				</div>
			{:else if rightPanel === 'quake'}
				<QuakePanel
					{quake}
					all={$quakes}
					{home}
					{now}
					onclose={closeRight}
					onpick={(q) => pickQuake(q, true)}
				/>
			{:else if rightPanel === 'feature'}
				<FeaturePanel
					feature={pickedShown.feature}
					source={pickedShown.source}
					onclose={closeRight}
				/>
			{:else}
				<AnalysisPanel
					place={probe}
					label={probeLabel}
					areas={pickedWarnings}
					onclose={closeRight}
				/>
			{/if}
		</aside>
	{/if}
</div>
