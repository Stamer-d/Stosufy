// Traffic: buses, trams, metros and trains moving along their lines (Transitous, the open
// public transport routing of the community: timetables and live data of most countries),
// the stops with their next departures, shared bikes (CityBikes), ships (AIS: worldwide
// through the Stamer API, else the Baltic Sea from Digitraffic) and what's on Germany's
// motorways (Autobahn GmbH).

import type { Feature, LayerSource } from '../types';
import { getJson, backendJson, cached, inBatches, NotConfigured } from '../http';
import { alongLine, decodePolyline, deadReckoning, ago, clockTime } from '../features';
import { distanceKm } from '../../map';
import { addWidget } from '../../homeWidgets';

const MOTIS = 'https://api.transitous.org/api';

const MODES: Record<string, { label: string; colour: string; size: number }> = {
	BUS: { label: 'Bus', colour: '#22c55e', size: 3.5 },
	COACH: { label: 'Coach', colour: '#16a34a', size: 4 },
	TRAM: { label: 'Tram', colour: '#ef4444', size: 4 },
	SUBWAY: { label: 'Metro', colour: '#3b82f6', size: 4.5 },
	METRO: { label: 'Metro', colour: '#3b82f6', size: 4.5 },
	SUBURBAN: { label: 'Suburban train', colour: '#10b981', size: 4.5 },
	REGIONAL_RAIL: { label: 'Regional train', colour: '#f43f5e', size: 5 },
	REGIONAL_FAST_RAIL: { label: 'Regional train', colour: '#f43f5e', size: 5 },
	RAIL: { label: 'Train', colour: '#f43f5e', size: 5 },
	LONG_DISTANCE: { label: 'Long distance train', colour: '#f8fafc', size: 5.5 },
	HIGHSPEED_RAIL: { label: 'High speed train', colour: '#f8fafc', size: 5.5 },
	NIGHT_RAIL: { label: 'Night train', colour: '#c4b5fd', size: 5.5 },
	FERRY: { label: 'Ferry', colour: '#0ea5e9', size: 5 },
	FUNICULAR: { label: 'Funicular', colour: '#a855f7', size: 4 },
	AERIAL_LIFT: { label: 'Cable car', colour: '#a855f7', size: 4 },
	CABLE_CAR: { label: 'Cable car', colour: '#a855f7', size: 4 },
	OTHER: { label: 'Other', colour: '#94a3b8', size: 3.5 }
};
const modeOf = (mode: string) => MODES[mode] ?? MODES.OTHER;
const colourOf = (route: string | undefined, fallback: string) =>
	route && /^#?[0-9a-f]{6}$/i.test(route) ? `#${route.replace('#', '')}` : fallback;
const hhmm = (ms: number) =>
	new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
/** +3 when late (minutes), from the time it has and the planned one */
function delay(actual?: string, planned?: string) {
	if (!actual || !planned) return 0;
	return Math.round((Date.parse(actual) - Date.parse(planned)) / 60000);
}

export const transit: LayerSource = {
	id: 'transit',
	category: 'traffic',
	label: 'Public transport',
	icon: 'icon-[mingcute--train-line]',
	hint: 'Buses, trams, metros and trains on their way, from timetables and live data (far out only trains; zoom in for all)',
	attribution: 'Transitous (MOTIS)',
	on: true,
	byArea: true,
	moving: true,
	minZoom: 6,
	every: 60 * 1000,
	legend: [
		{ label: 'Long distance', colour: MODES.LONG_DISTANCE.colour },
		{ label: 'Regional', colour: MODES.REGIONAL_RAIL.colour },
		{ label: 'Suburban', colour: MODES.SUBURBAN.colour },
		{ label: 'Metro', colour: MODES.SUBWAY.colour },
		{ label: 'Tram', colour: MODES.TRAM.colour },
		{ label: 'Bus', colour: MODES.BUS.colour }
	],
	async load(a, signal) {
		const zoom = Math.round(a.zoom);
		const precision = zoom >= 11 ? 5 : zoom >= 8 ? 4 : zoom >= 5 ? 3 : 2;
		const now = Date.now();
		const segments = await getJson<any[]>(
			`${MOTIS}/v6/map/trips?zoom=${zoom}&min=${a.south.toFixed(4)},${a.west.toFixed(4)}&max=${a.north.toFixed(4)},${a.east.toFixed(4)}&startTime=${new Date(now - 30000).toISOString()}&endTime=${new Date(now + 100000).toISOString()}&precision=${precision}`,
			signal
		);
		return (segments ?? []).map((s) => {
			const mode = modeOf(s.mode);
			const start = Date.parse(s.departure);
			const end = Date.parse(s.arrival);
			const line = s.polyline ? decodePolyline(s.polyline, precision) : [];
			const trip = s.trips?.[0] ?? {};
			return {
				id: `trip:${trip.tripId}:${s.departure}`,
				lat: s.from?.lat,
				lon: s.from?.lon,
				shape: 'dot' as const,
				size: mode.size,
				colour: colourOf(s.routeColor, mode.colour),
				label: trip.routeShortName || trip.displayName,
				labelZoom: 13,
				at: (t: number) =>
					t < start || t > end || line.length < 2
						? null
						: alongLine(line, (t - start) / Math.max(1, end - start)),
				data: { s, mode, trip }
			};
		});
	},
	async details(f, signal) {
		const { s, mode, trip } = f.data;
		const late = delay(s.departure, s.scheduledDeparture);
		const base = {
			title: trip.displayName || trip.routeShortName || mode.label,
			subtitle: `${mode.label} · ${s.from?.name} → ${s.to?.name}`,
			badge: {
				text: (trip.routeShortName || mode.label).slice(0, 7),
				colour: f.colour,
				small: s.realTime ? 'live' : 'timetable'
			},
			stats: [
				{ label: 'Next stop', value: s.to?.name ?? '–', hint: `at ${hhmm(Date.parse(s.arrival))}` },
				{
					label: 'Delay',
					value: s.realTime ? (late > 0 ? `+${late} min` : 'On time') : '–',
					hint: s.realTime ? 'live' : 'no live data'
				}
			],
			source: 'Transitous, open public transport data'
		};
		// The whole trip: its stops and times
		const itinerary = await getJson(
			`${MOTIS}/v6/trip?tripId=${encodeURIComponent(trip.tripId)}`,
			signal
		).catch(() => null);
		const leg = itinerary?.legs?.find((l: any) => l.tripId === trip.tripId) ?? itinerary?.legs?.[0];
		if (!leg) return base;
		const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to].filter(Boolean);
		const now = Date.now();
		return {
			...base,
			subtitle: `${mode.label}${leg.headsign ? ` → ${leg.headsign}` : ''}${leg.agencyName ? ` · ${leg.agencyName}` : ''}`,
			rowsTitle: 'Stops',
			rows: stops.map((p: any) => {
				const time = p.departure ?? p.arrival;
				const planned = p.scheduledDeparture ?? p.scheduledArrival;
				const late = delay(time, planned);
				return {
					title: p.name,
					sub: p.track ? `Platform ${p.track}` : undefined,
					value: time ? hhmm(Date.parse(time)) : '',
					badge: late > 0 ? `+${late}` : undefined,
					colour: time && Date.parse(time) < now ? 'rgba(255,255,255,0.4)' : undefined
				};
			})
		};
	}
};

export const stops: LayerSource = {
	id: 'stops',
	category: 'traffic',
	label: 'Stops & departures',
	icon: 'icon-[mingcute--bus-line]',
	hint: 'The stops nearby (zoom in): click one for its next departures, live',
	attribution: 'Transitous (MOTIS)',
	on: true,
	byArea: true,
	minZoom: 14,
	every: 10 * 60 * 1000,
	async load(a, signal) {
		const places = await getJson<any[]>(
			`${MOTIS}/v6/map/stops?min=${a.south.toFixed(5)},${a.west.toFixed(5)}&max=${a.north.toFixed(5)},${a.east.toFixed(5)}`,
			signal
		);
		return (places ?? []).map((p) => ({
			id: `stop:${p.stopId}`,
			lat: p.lat,
			lon: p.lon,
			shape: 'square' as const,
			size: 3,
			colour: '#e2e8f0',
			label: p.name,
			labelZoom: 16,
			data: p
		}));
	},
	async details(f, signal) {
		const p = f.data;
		const rows = await departures({ stopId: p.stopId }, 14, signal);
		return {
			title: p.name,
			subtitle: 'Next departures',
			rowsTitle: rows.length ? 'Departures' : 'No departures soon',
			rows,
			actions: [
				{
					label: 'Show its departures on the home screen',
					icon: 'icon-[mingcute--layout-grid-line]',
					run: () =>
						addWidget('mac-departures', { stop: { id: p.stopId, name: p.name } }, 'the departures')
				}
			],
			source: 'Transitous, open public transport data'
		};
	}
};

/** The next departures of a stop, or of the stops around a place (within `radius` m) */
export async function departures(
	where: { stopId: string } | { lat: number; lon: number; radius: number },
	n: number,
	signal?: AbortSignal
) {
	const query =
		'stopId' in where
			? `stopId=${encodeURIComponent(where.stopId)}`
			: `center=${where.lat.toFixed(5)},${where.lon.toFixed(5)}&radius=${where.radius}`;
	const answer = await getJson(`${MOTIS}/v6/stoptimes?${query}&n=${n}`, signal);
	return ((answer?.stopTimes ?? []) as any[]).map((t) => {
		const time = t.place?.departure ?? t.place?.arrival;
		const late = delay(time, t.place?.scheduledDeparture ?? t.place?.scheduledArrival);
		const mode = modeOf(t.mode);
		return {
			title: `${t.routeShortName || t.displayName || mode.label} → ${t.headsign || t.tripTo?.name || ''}`,
			sub: [
				mode.label,
				'stopId' in where ? '' : t.place?.name,
				t.place?.track ? `Platform ${t.place.track}` : '',
				t.cancelled ? 'Cancelled' : ''
			]
				.filter(Boolean)
				.join(' · '),
			value: time ? hhmm(Date.parse(time)) : '',
			time: time ? Date.parse(time) : 0,
			badge: t.cancelled ? '✕' : late > 0 ? `+${late}` : undefined,
			colour: colourOf(t.routeColor, mode.colour),
			line: t.routeShortName || t.displayName || mode.label
		};
	});
}

/** Stops by their name, the nearest to a place first */
export async function findStops(
	text: string,
	near?: { lat: number; lon: number },
	signal?: AbortSignal
) {
	const bias = near ? `&place=${near.lat.toFixed(4)},${near.lon.toFixed(4)}&placeBias=5` : '';
	const list = await getJson<any[]>(
		`${MOTIS}/v1/geocode?text=${encodeURIComponent(text)}&type=STOP&numResults=6${bias}`,
		signal
	);
	return (list ?? []).map((m) => ({
		id: m.id as string,
		name: m.name as string,
		where: (m.areas ?? []).map((a: any) => a.name).find(Boolean) as string | undefined
	}));
}

// --- Shared bikes ------------------------------------------------------------------------------

const bikeNetworks = (signal: AbortSignal) =>
	cached('citybikes', 24 * 60 * 60 * 1000, () =>
		getJson('https://api.citybik.es/v2/networks?fields=id,name,location,company', signal).then(
			(data) => data?.networks ?? []
		)
	);

export const bikes: LayerSource = {
	id: 'bikes',
	category: 'traffic',
	label: 'Shared bikes',
	icon: 'icon-[mingcute--bike-line]',
	hint: 'Bike sharing in 600+ cities; zoom into a city for its stations and how many bikes they have',
	attribution: 'CityBikes',
	byArea: true,
	every: 3 * 60 * 1000,
	legend: [
		{ label: 'Bikes', colour: '#22c55e' },
		{ label: 'Few', colour: '#f59e0b' },
		{ label: 'None', colour: '#ef4444' }
	],
	async load(a, signal) {
		const networks = (await bikeNetworks(signal)).filter(
			(n: any) =>
				n.location &&
				n.location.latitude <= a.north &&
				n.location.latitude >= a.south &&
				n.location.longitude >= a.west &&
				n.location.longitude <= a.east
		);
		if (a.zoom < 12)
			return networks.map((n: any) => ({
				id: `bikes:${n.id}`,
				lat: n.location.latitude,
				lon: n.location.longitude,
				shape: 'ring' as const,
				size: 5,
				colour: '#2dd4bf',
				label: n.name,
				labelZoom: 8,
				data: { network: n }
			}));
		// The nearest networks' stations
		const away = (n: any) => distanceKm(a, { lat: n.location.latitude, lon: n.location.longitude });
		const near = networks.sort((x: any, y: any) => away(x) - away(y)).slice(0, 4);
		const answers = await inBatches(near, 2, (n: any) =>
			getJson(`https://api.citybik.es/v2/networks/${n.id}?fields=stations,name,company`, signal)
				.then((d) => ({ n, stations: d?.network?.stations ?? [] }))
				.catch(() => ({ n, stations: [] }))
		);
		return answers.flatMap(({ n, stations }) =>
			stations.map((s: any) => ({
				id: `bike:${n.id}:${s.id}`,
				lat: s.latitude,
				lon: s.longitude,
				shape: 'dot' as const,
				size: 4,
				colour: !s.free_bikes ? '#ef4444' : s.free_bikes < 3 ? '#f59e0b' : '#22c55e',
				label: String(s.free_bikes ?? ''),
				labelZoom: 15,
				data: { network: n, station: s }
			}))
		);
	},
	details(f) {
		const { network: n, station: s } = f.data;
		if (!s)
			return {
				title: n.name,
				subtitle: [n.location?.city, n.location?.country].filter(Boolean).join(', '),
				text: 'Zoom in for its stations and how many bikes they have.',
				stats: [{ label: 'Run by', value: [].concat(n.company ?? []).join(', ') || '–' }],
				source: 'CityBikes'
			};
		const time = Date.parse(s.timestamp);
		return {
			title: s.name,
			subtitle: n.name,
			badge: { text: String(s.free_bikes ?? '–'), colour: f.colour, small: 'bikes' },
			stats: [
				{ label: 'Bikes', value: String(s.free_bikes ?? '–') },
				{ label: 'Free docks', value: String(s.empty_slots ?? '–') },
				...(s.extra?.ebikes != null ? [{ label: 'E-bikes', value: String(s.extra.ebikes) }] : []),
				...(isFinite(time) ? [{ label: 'Updated', value: ago(time) }] : [])
			],
			source: 'CityBikes'
		};
	}
};

// --- Ships ---------------------------------------------------------------------------------------

/** What the AIS ship type number means */
function shipKind(type: number) {
	if (type >= 70 && type < 80) return { label: 'Cargo', colour: '#22c55e' };
	if (type >= 80 && type < 90) return { label: 'Tanker', colour: '#ef4444' };
	if (type >= 60 && type < 70) return { label: 'Passenger', colour: '#3b82f6' };
	if (type === 30) return { label: 'Fishing', colour: '#f59e0b' };
	if (type === 36 || type === 37) return { label: 'Sailing / pleasure', colour: '#d946ef' };
	if (type >= 40 && type < 50) return { label: 'High speed craft', colour: '#facc15' };
	if ([31, 32, 52, 53].includes(type)) return { label: 'Tug', colour: '#2dd4bf' };
	if ([33, 34, 50, 51, 54, 55, 58].includes(type))
		return { label: 'Special (pilot, rescue, police)', colour: '#f97316' };
	if (type === 35) return { label: 'Military', colour: '#94a3b8' };
	return { label: 'Other', colour: '#cbd5e1' };
}

const NAV_STATUS = [
	'Under way (engine)',
	'At anchor',
	'Not under command',
	'Restricted manoeuvrability',
	'Constrained by draught',
	'Moored',
	'Aground',
	'Fishing',
	'Under way (sailing)'
];

interface Vessel {
	mmsi: number;
	lat: number;
	lon: number;
	sog?: number;
	cog?: number;
	heading?: number;
	name?: string;
	type?: number;
	destination?: string;
	status?: number;
	at?: number;
	callSign?: string;
	imo?: number;
}

/** The Baltic Sea's ships from Finland's open AIS data */
async function digitrafficShips(signal: AbortSignal): Promise<Vessel[]> {
	const [locations, meta] = await Promise.all([
		getJson('https://meri.digitraffic.fi/api/ais/v1/locations', signal),
		cached('digitraffic-vessels', 60 * 60 * 1000, () =>
			getJson<any[]>('https://meri.digitraffic.fi/api/ais/v1/vessels', signal).then((list) =>
				Object.fromEntries(
					(list ?? []).map((v) => [v.mmsi, [v.name, v.shipType, v.destination, v.callSign, v.imo]])
				)
			)
		).catch(() => ({}) as Record<string, any[]>)
	]);
	return (locations?.features ?? []).map((f: any) => {
		const p = f.properties ?? {};
		const m = (meta as Record<string, any[]>)[f.mmsi ?? p.mmsi] ?? [];
		return {
			mmsi: f.mmsi ?? p.mmsi,
			lon: f.geometry?.coordinates?.[0],
			lat: f.geometry?.coordinates?.[1],
			sog: p.sog,
			cog: p.cog,
			heading: p.heading,
			status: p.navStat,
			at: p.timestampExternal,
			name: m[0],
			type: m[1],
			destination: m[2],
			callSign: m[3],
			imo: m[4]
		};
	});
}

export const ships: LayerSource = {
	id: 'ships',
	category: 'traffic',
	label: 'Ships',
	icon: 'icon-[mingcute--ship-line]',
	hint: 'Ships at sea from their AIS signals, moving on between updates',
	attribution: 'aisstream.io / Digitraffic (Fintraffic)',
	byArea: true,
	moving: true,
	minZoom: 5,
	every: 30 * 1000,
	legend: [
		{ label: 'Cargo', colour: '#22c55e' },
		{ label: 'Tanker', colour: '#ef4444' },
		{ label: 'Passenger', colour: '#3b82f6' },
		{ label: 'Fishing', colour: '#f59e0b' },
		{ label: 'Pleasure', colour: '#d946ef' }
	],
	async load(a, signal) {
		let vessels: Vessel[];
		try {
			const answer = await backendJson<{ vessels: Vessel[] }>(
				`ships?west=${a.west.toFixed(3)}&south=${a.south.toFixed(3)}&east=${a.east.toFixed(3)}&north=${a.north.toFixed(3)}`,
				signal
			);
			vessels = answer.vessels;
		} catch (error) {
			if (signal.aborted) throw error;
			// Not set up (or not reachable): the Baltic Sea's open data
			if (!(error instanceof NotConfigured)) console.warn('Ships from the Stamer API', error);
			vessels = (await digitrafficShips(signal)).filter(
				(v) => v.lat <= a.north && v.lat >= a.south && v.lon >= a.west && v.lon <= a.east
			);
		}
		const now = Date.now();
		return vessels
			.filter((v) => typeof v.lat === 'number' && Math.abs(v.lat) <= 90)
			.map((v) => {
				const kind = shipKind(v.type ?? 0);
				const heading = v.heading != null && v.heading < 360 ? v.heading : (v.cog ?? 0);
				const moving = (v.sog ?? 0) > 0.5 && (v.sog ?? 0) < 60;
				return {
					id: `ship:${v.mmsi}`,
					lat: v.lat,
					lon: v.lon,
					shape: 'boat' as const,
					size: 4,
					heading,
					colour: kind.colour,
					label: v.name?.trim() || undefined,
					labelZoom: 11,
					at: moving
						? deadReckoning(
								{ lat: v.lat, lon: v.lon, time: Math.min(now, v.at ?? now) },
								(v.sog ?? 0) * 1.852,
								v.cog ?? heading,
								180
							)
						: undefined,
					data: { v, kind }
				};
			});
	},
	details(f) {
		const { v, kind } = f.data;
		return {
			title: v.name?.trim() || `MMSI ${v.mmsi}`,
			subtitle: [kind.label, v.destination ? `→ ${v.destination}` : ''].filter(Boolean).join(' '),
			stats: [
				{
					label: 'Speed',
					value: v.sog != null ? `${v.sog.toFixed(1)} kn` : '–',
					hint: v.sog != null ? `${Math.round(v.sog * 1.852)} km/h` : ''
				},
				{ label: 'Course', value: v.cog != null ? `${Math.round(v.cog)}°` : '–' },
				{ label: 'Status', value: NAV_STATUS[v.status ?? -1] ?? '–' },
				{ label: 'MMSI', value: String(v.mmsi), hint: v.callSign ? `call sign ${v.callSign}` : '' },
				...(v.imo ? [{ label: 'IMO', value: String(v.imo) }] : []),
				...(v.at ? [{ label: 'Seen', value: ago(v.at) }] : [])
			],
			links: [
				{
					label: 'At MarineTraffic',
					url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${v.mmsi}`
				}
			],
			source: 'AIS (aisstream.io / Digitraffic)'
		};
	}
};

// --- Germany's motorways ---------------------------------------------------------------------------

const AUTOBAHN = 'https://verkehr.autobahn.de/o/autobahn';
const AUTOBAHN_KINDS: Record<string, { label: string; colour: string; shape: Feature['shape'] }> = {
	roadworks: { label: 'Roadworks', colour: '#f59e0b', shape: 'triangle' },
	warning: { label: 'Traffic warning', colour: '#ef4444', shape: 'diamond' },
	closure: { label: 'Closure', colour: '#b91c1c', shape: 'square' }
};

const autobahnRoads = (signal: AbortSignal) =>
	cached('autobahn-roads', 24 * 60 * 60 * 1000, () =>
		getJson(`${AUTOBAHN}/`, signal).then((d) => (d?.roads ?? []) as string[])
	);

/** One service of all motorways (each motorway is asked on its own) */
export async function autobahnService(service: string, signal: AbortSignal) {
	const roads = (await autobahnRoads(signal)).filter((road) => /^A\d+$/.test(road.trim()));
	const answers = await inBatches(roads, 8, (road) =>
		getJson(`${AUTOBAHN}/${encodeURIComponent(road.trim())}/services/${service}`, signal)
			.then((d) => ({ road, items: (d?.[service] ?? []) as any[] }))
			.catch(() => ({ road, items: [] as any[] }))
	);
	return answers.flatMap(({ road, items }) => items.map((item) => ({ road, item })));
}

export const autobahn: LayerSource = {
	id: 'autobahn',
	category: 'traffic',
	label: 'Autobahn',
	icon: 'icon-[mingcute--road-line]',
	hint: 'Roadworks, closures and traffic warnings on Germany’s motorways',
	attribution: 'Autobahn GmbH des Bundes',
	every: 10 * 60 * 1000,
	legend: Object.values(AUTOBAHN_KINDS).map((k) => ({ label: k.label, colour: k.colour })),
	async load(_, signal) {
		const seen = new Set<string>();
		const list: Feature[] = [];
		for (const service of Object.keys(AUTOBAHN_KINDS)) {
			const kind = AUTOBAHN_KINDS[service];
			for (const { road, item } of await autobahnService(service, signal)) {
				const lat = Number(item.coordinate?.lat);
				const lon = Number(item.coordinate?.long ?? item.coordinate?.lon);
				const id = `${service}:${item.identifier}`;
				if (!isFinite(lat) || !isFinite(lon) || seen.has(id)) continue;
				seen.add(id);
				const blocked = String(item.isBlocked) === 'true';
				list.push({
					id: `autobahn:${id}`,
					lat,
					lon,
					shape: kind.shape,
					size: blocked ? 5 : 4,
					colour: blocked ? AUTOBAHN_KINDS.closure.colour : kind.colour,
					rank: blocked ? 3 : service === 'warning' ? 2 : 1,
					label: road,
					labelZoom: 9,
					line:
						item.geometry?.type === 'LineString' && item.geometry.coordinates?.length > 1
							? item.geometry.coordinates
							: undefined,
					data: { road, item, kind, blocked }
				});
			}
		}
		return list;
	},
	details(f) {
		const { road, item, kind, blocked } = f.data;
		const start = Date.parse(item.startTimestamp ?? '');
		return {
			title: item.title ?? road,
			subtitle: [kind.label, item.subtitle].filter(Boolean).join(' · '),
			badge: { text: road, colour: '#1d4ed8', small: blocked ? 'blocked' : undefined },
			text: []
				.concat(item.description ?? [])
				.filter(Boolean)
				.join('\n'),
			stats: [
				...(isFinite(start) ? [{ label: 'Since', value: clockTime(start) }] : []),
				...(item.extent ? [{ label: 'Length', value: String(item.extent) }] : []),
				{ label: 'Blocked', value: blocked ? 'Yes' : 'No' }
			],
			links: [{ label: 'At autobahn.de', url: 'https://www.autobahn.de/verkehrslage' }],
			source: 'Autobahn GmbH des Bundes'
		};
	}
};
