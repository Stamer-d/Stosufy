// Space: the space stations (the ISS with its path and when it flies over you), satellites
// and Starlink worked out from their orbits (CelesTrak's elements, SGP4), the next rocket
// launches (Launch Library 2) and the aurora with the space weather (NOAA SWPC).

import {
	json2satrec,
	propagate,
	gstime,
	eciToGeodetic,
	eciToEcf,
	ecfToLookAngles,
	degreesLat,
	degreesLong,
	type SatRec
} from 'satellite.js';
import type { Feature, FieldSource, LayerSource } from '../types';
import { getJson, cached } from '../http';
import { ago, clockTime, scale } from '../features';
import { compass } from '../../storm';
import { addWidget } from '../../homeWidgets';

// --- Orbits -------------------------------------------------------------------------------------

export function positionOf(satrec: SatRec, time: number) {
	const date = new Date(time);
	const pv = propagate(satrec, date);
	if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
	const geo = eciToGeodetic(pv.position, gstime(date));
	const v = pv.velocity as any;
	return {
		lat: degreesLat(geo.latitude),
		lon: degreesLong(geo.longitude),
		height: geo.height,
		speed: v ? Math.hypot(v.x, v.y, v.z) : 0
	};
}

/** Where it is, worked out at most every `step` ms (thousands of satellites at once) */
function mover(satrec: SatRec, step: number) {
	let last = -Infinity;
	let at: { lat: number; lon: number; heading: number } | null = null;
	return (now: number) => {
		if (Math.abs(now - last) < step) return at;
		last = now;
		const p = positionOf(satrec, now);
		const ahead = positionOf(satrec, now + 10000);
		if (!p) return (at = null);
		const heading = ahead
			? (Math.atan2(
					(((ahead.lon - p.lon + 540) % 360) - 180) * Math.cos((p.lat * Math.PI) / 180),
					ahead.lat - p.lat
				) *
					180) /
				Math.PI
			: 0;
		return (at = { lat: p.lat, lon: p.lon, heading });
	};
}

const elements = (group: string, signal: AbortSignal) =>
	// CelesTrak asks not to be asked for the same group more than every two hours
	cached(`celestrak-${group}`, 6 * 60 * 60 * 1000, () =>
		getJson<any[]>(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, signal)
	);

function satrecOf(omm: any): SatRec | null {
	try {
		const satrec = json2satrec(omm);
		return satrec.error ? null : satrec;
	} catch {
		return null;
	}
}

/** Where you are, for the passes over you */
let observer: { lat: number; lon: number; name?: string } | null = null;
export function setObserver(place: { lat: number; lon: number; name?: string } | null) {
	observer = place;
}

/** When it flies over a place (higher than 10°) in the next two days */
export function passes(satrec: SatRec, place: { lat: number; lon: number }, hours = 48) {
	const observerGeo = {
		latitude: (place.lat * Math.PI) / 180,
		longitude: (place.lon * Math.PI) / 180,
		height: 0.1
	};
	const list: {
		start: number;
		end: number;
		peak: number;
		maxElevation: number;
		from: number;
		to: number;
	}[] = [];
	let pass: (typeof list)[number] | null = null;
	const now = Date.now();
	for (let t = now; t < now + hours * 3600000; t += 20000) {
		const date = new Date(t);
		const pv = propagate(satrec, date);
		if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
		const look = ecfToLookAngles(observerGeo, eciToEcf(pv.position, gstime(date)));
		const elevation = (look.elevation * 180) / Math.PI;
		const azimuth = (look.azimuth * 180) / Math.PI;
		if (elevation > 10) {
			if (!pass)
				pass = { start: t, end: t, peak: t, maxElevation: elevation, from: azimuth, to: azimuth };
			pass.end = t;
			pass.to = azimuth;
			if (elevation > pass.maxElevation) {
				pass.maxElevation = elevation;
				pass.peak = t;
			}
		} else if (pass) {
			list.push(pass);
			pass = null;
			if (list.length >= 8) break;
		}
	}
	return list;
}

function satelliteDetails(f: Feature) {
	const { omm, satrec, group } = f.data;
	const now = positionOf(satrec, Date.now());
	const epoch = Date.parse(`${omm.EPOCH}Z`);
	const period = omm.MEAN_MOTION ? 1440 / omm.MEAN_MOTION : null;
	const over = observer ? passes(satrec, observer) : [];
	return {
		title: omm.OBJECT_NAME,
		subtitle: [group, omm.OBJECT_ID ? `launched ${omm.OBJECT_ID.slice(0, 4)}` : '']
			.filter(Boolean)
			.join(' · '),
		stats: [
			...(now
				? [
						{ label: 'Height', value: `${Math.round(now.height).toLocaleString()} km` },
						{
							label: 'Speed',
							value: `${now.speed.toFixed(2)} km/s`,
							hint: `${Math.round(now.speed * 3600).toLocaleString()} km/h`
						}
					]
				: []),
			...(period ? [{ label: 'Once round', value: `${Math.round(period)} min` }] : []),
			{ label: 'Inclination', value: `${Number(omm.INCLINATION).toFixed(1)}°` },
			{ label: 'NORAD', value: String(omm.NORAD_CAT_ID) },
			{ label: 'Orbit from', value: ago(epoch) }
		],
		rowsTitle: observer
			? over.length
				? `Over ${observer.name ?? 'you'} (higher than 10°)`
				: `Not over ${observer.name ?? 'you'} in the next 2 days`
			: undefined,
		rows: over.map((p) => ({
			title: clockTime(p.start),
			sub: `${compass(p.from)} → ${compass(p.to)} · ${Math.round((p.end - p.start) / 60000)} min`,
			value: `${Math.round(p.maxElevation)}°`
		})),
		links: [{ label: 'At N2YO', url: `https://www.n2yo.com/satellite/?s=${omm.NORAD_CAT_ID}` }],
		actions:
			omm.NORAD_CAT_ID === 25544
				? [
						{
							label: 'Show the ISS on the home screen',
							icon: 'icon-[mingcute--layout-grid-line]',
							run: () => addWidget('mac-iss', {}, 'the ISS')
						}
					]
				: [],
		source: 'CelesTrak orbital elements, positions by SGP4'
	};
}

/** A group of satellites as moving features */
function satelliteLayer(options: {
	id: string;
	label: string;
	icon: string;
	hint: string;
	groups: { group: string; label: string; colour: string }[];
	size: number;
	step: number;
	on?: boolean;
	/** Their path (an hour and a half around now) */
	path?: boolean;
}): LayerSource {
	return {
		id: options.id,
		category: 'space',
		label: options.label,
		icon: options.icon,
		hint: options.hint,
		attribution: 'CelesTrak',
		on: options.on,
		moving: true,
		every: 30 * 60 * 1000,
		legend:
			options.groups.length > 1
				? options.groups.map((g) => ({ label: g.label, colour: g.colour }))
				: undefined,
		async load(_, signal) {
			const list: Feature[] = [];
			const seen = new Set<number>();
			for (const g of options.groups) {
				for (const omm of (await elements(g.group, signal)) ?? []) {
					if (seen.has(omm.NORAD_CAT_ID)) continue;
					const satrec = satrecOf(omm);
					if (!satrec) continue;
					seen.add(omm.NORAD_CAT_ID);
					const iss = omm.NORAD_CAT_ID === 25544;
					let line: [number, number][] | undefined;
					if (options.path && (iss || /CSS|TIANHE/i.test(omm.OBJECT_NAME))) {
						line = [];
						for (let m = -45; m <= 90; m += 1) {
							const p = positionOf(satrec, Date.now() + m * 60000);
							if (p) line.push([p.lon, p.lat]);
						}
					}
					list.push({
						id: `sat:${omm.NORAD_CAT_ID}`,
						lat: 0,
						lon: 0,
						shape: iss ? 'star' : 'dot',
						size: iss ? 8 : options.size,
						colour: iss ? '#fde047' : g.colour,
						rank: iss ? 5 : 1,
						label: iss ? 'ISS' : omm.OBJECT_NAME,
						labelZoom: iss ? 0 : 7,
						at: mover(satrec, iss ? 0 : options.step),
						line,
						data: { omm, satrec, group: g.label }
					});
				}
			}
			return list;
		},
		details: satelliteDetails
	};
}

export const stations = satelliteLayer({
	id: 'iss',
	label: 'ISS & space stations',
	icon: 'icon-[ri--space-ship-line]',
	hint: 'The ISS and the other crewed stations live, with their path and when they fly over you',
	groups: [{ group: 'stations', label: 'Space station', colour: '#fde047' }],
	size: 4,
	step: 0,
	on: true,
	path: true
});

export const satellites = satelliteLayer({
	id: 'satellites',
	label: 'Satellites',
	icon: 'icon-[ri--planet-line]',
	hint: 'The brightest satellites, navigation (GPS, Galileo, GLONASS, BeiDou) and weather satellites',
	groups: [
		{ group: 'visual', label: 'Bright', colour: '#f8fafc' },
		{ group: 'gnss', label: 'Navigation', colour: '#34d399' },
		{ group: 'weather', label: 'Weather', colour: '#38bdf8' }
	],
	size: 2.5,
	step: 1000,
	on: true
});

export const starlink = satelliteLayer({
	id: 'starlink',
	label: 'Starlink',
	icon: 'icon-[mingcute--signal-line]',
	hint: 'All of SpaceX’s Starlink satellites (thousands of them)',
	groups: [{ group: 'starlink', label: 'Starlink', colour: '#a78bfa' }],
	size: 1.5,
	step: 2000
});

/** The ISS's orbit (for its widget) */
export async function issOrbit(signal: AbortSignal) {
	const omm = ((await elements('stations', signal)) ?? []).find(
		(o: any) => o.NORAD_CAT_ID === 25544
	);
	return omm ? satrecOf(omm) : null;
}

// --- Rocket launches ------------------------------------------------------------------------------

const LAUNCH_STATUS: Record<string, string> = {
	Go: '#22c55e',
	TBC: '#facc15',
	TBD: '#94a3b8',
	Hold: '#f97316',
	'In Flight': '#38bdf8',
	Success: '#22c55e',
	Failure: '#ef4444',
	'Partial Failure': '#f97316'
};

/** T-2d 4h, T-35 min */
export function countdown(net: number, now = Date.now()) {
	const s = Math.round((net - now) / 1000);
	const abs = Math.abs(s);
	const d = Math.floor(abs / 86400);
	const h = Math.floor((abs % 86400) / 3600);
	const m = Math.floor((abs % 3600) / 60);
	const text = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m} min`;
	return s >= 0 ? `T-${text}` : `T+${text}`;
}

export const launchList = (signal: AbortSignal) =>
	// Launch Library answers 15 times an hour
	cached('launches', 30 * 60 * 1000, () =>
		getJson(
			'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=40&mode=detailed',
			signal
		).then((d) => (d?.results ?? []) as any[])
	);

export const launches: LayerSource = {
	id: 'launches',
	category: 'space',
	label: 'Rocket launches',
	icon: 'icon-[mingcute--rocket-line]',
	hint: 'The next launches worldwide at their pads, with the countdown',
	attribution: 'The Space Devs, Launch Library 2',
	on: true,
	every: 5 * 60 * 1000,
	legend: [
		{ label: 'Go', colour: LAUNCH_STATUS.Go },
		{ label: 'To be confirmed', colour: LAUNCH_STATUS.TBC },
		{ label: 'To be decided', colour: LAUNCH_STATUS.TBD }
	],
	async load(_, signal) {
		const list = await launchList(signal);
		// Several launches from one pad: the next on top, slightly apart
		const atPad = new Map<string, number>();
		return list
			.map((l): Feature | null => {
				const lat = Number(l.pad?.latitude);
				const lon = Number(l.pad?.longitude);
				if (!isFinite(lat) || !isFinite(lon)) return null;
				const key = `${lat},${lon}`;
				const n = atPad.get(key) ?? 0;
				atPad.set(key, n + 1);
				const net = Date.parse(l.net);
				const soon = net - Date.now() < 24 * 3600000;
				return {
					id: `launch:${l.id}`,
					lat: lat + n * 0.02,
					lon: lon + n * 0.02,
					shape: 'triangle',
					size: soon ? 7 : 5,
					colour: LAUNCH_STATUS[l.status?.abbrev] ?? '#94a3b8',
					rank: 10 - n,
					pulse: soon,
					label: n ? undefined : `${countdown(net)} ${l.rocket?.configuration?.name ?? ''}`,
					labelZoom: soon ? 0 : 3,
					data: l
				};
			})
			.filter(Boolean) as Feature[];
	},
	details(f) {
		const l = f.data;
		const net = Date.parse(l.net);
		const image = typeof l.image === 'string' ? l.image : l.image?.image_url;
		return {
			title: l.name,
			subtitle: [l.launch_service_provider?.name, l.pad?.location?.name]
				.filter(Boolean)
				.join(' · '),
			badge: { text: l.status?.abbrev ?? '?', colour: f.colour },
			image: image ? { url: image } : undefined,
			text: l.mission?.description ?? '',
			stats: [
				{ label: 'Launch', value: clockTime(net), hint: countdown(net) },
				{
					label: 'Rocket',
					value: l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name ?? '–'
				},
				...(l.mission?.orbit?.name ? [{ label: 'Orbit', value: l.mission.orbit.name }] : []),
				...(l.mission?.type ? [{ label: 'Mission', value: l.mission.type }] : []),
				{ label: 'Pad', value: l.pad?.name ?? '–' },
				...(l.probability != null && l.probability >= 0
					? [{ label: 'Weather go', value: `${l.probability}%` }]
					: [])
			],
			links: (l.vidURLs ?? []).slice(0, 2).map((v: any) => ({
				label: v.title ? `Watch: ${v.title}` : 'Watch the launch',
				url: v.url
			})),
			source: 'The Space Devs, Launch Library 2'
		};
	}
};

// --- The aurora and the space weather ----------------------------------------------------------

export const AURORA: FieldSource = {
	id: 'aurora',
	label: 'Aurora',
	icon: 'icon-[mingcute--moon-stars-line]',
	hint: 'How likely the aurora is over each place in the next half hour (NOAA’s OVATION model)',
	unit: '%',
	attribution: 'NOAA Space Weather Prediction Center',
	legend: [10, 30, 50, 80],
	colour: (v) =>
		scale(
			[
				[3, [0, 0, 0, 0]],
				[10, [34, 197, 94, 0.35]],
				[30, [132, 204, 22, 0.5]],
				[50, [250, 204, 21, 0.6]],
				[80, [239, 68, 68, 0.7]]
			],
			v
		),
	every: 10 * 60 * 1000,
	async load(a, signal) {
		const data = await getJson(
			'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
			signal
		);
		// A whole-degree grid of the world, longitudes 0–359
		const grid = new Map<number, number>();
		for (const [lon, lat, value] of data?.coordinates ?? [])
			grid.set(Math.round(lat) * 360 + Math.round(lon), value);
		const step = Math.max(1, Math.round((a.east - a.west) / 60));
		const rows = [];
		for (let lat = Math.floor(a.north); lat >= Math.ceil(a.south); lat -= step) {
			const row = [];
			for (let lon = Math.floor(a.west); lon <= Math.ceil(a.east); lon += step) {
				const l = ((Math.round(lon) % 360) + 360) % 360;
				row.push({ lat, lon, value: grid.get(Math.round(lat) * 360 + l) ?? 0 });
			}
			rows.push(row);
		}
		const time = Date.parse(data?.['Forecast Time'] ?? data?.['Observation Time'] ?? '');
		return { rows, time: isFinite(time) ? time : undefined };
	}
};

export interface SpaceWeather {
	kp: number | null;
	kpTime: number | null;
	scales: { R: string; S: string; G: string; text: string } | null;
}

/** The planetary K index now, and NOAA's scales (radio blackouts, radiation, geomagnetic storms) */
export async function spaceWeather(signal: AbortSignal): Promise<SpaceWeather> {
	const [kp, scales] = await Promise.all([
		getJson<any[]>('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', signal).catch(
			() => null
		),
		getJson('https://services.swpc.noaa.gov/products/noaa-scales.json', signal).catch(() => null)
	]);
	const last = kp?.at(-1);
	const today = scales?.['0'];
	return {
		kp: last ? Number(last.estimated_kp ?? last.kp_index) : null,
		kpTime: last ? Date.parse(`${last.time_tag}Z`) : null,
		scales: today
			? {
					R: today.R?.Scale ?? '0',
					S: today.S?.Scale ?? '0',
					G: today.G?.Scale ?? '0',
					text: today.G?.Text && today.G.Text !== 'none' ? today.G.Text : ''
				}
			: null
	};
}
