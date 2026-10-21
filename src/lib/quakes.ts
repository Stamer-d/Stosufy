// Earthquakes from the EMSC (the European-Mediterranean Seismological Centre, which gathers
// what the networks of the world locate, down to the small quakes in Europe), live as each
// one is located; the USGS's list of the week when the EMSC can't be reached. And how they
// show on a map: big ones big, coloured by how old or how deep they are.

import { fetchWithin } from './fastFetch';

export interface Quake {
	id: string;
	/** ms */
	time: number;
	lat: number;
	lon: number;
	/** km */
	depth: number;
	mag: number;
	/** ML, Mw, Mb… */
	magType: string;
	region: string;
	/** The network or agency that located it */
	source: string;
	/** Its page at the EMSC or USGS */
	url: string;
}

export type QuakeSource = 'emsc' | 'usgs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How far back quakes are loaded and kept */
export const KEEP_MS = 7 * DAY;

const EMSC = 'https://www.seismicportal.eu/fdsnws/event/1/query';
export const EMSC_LIVE = 'wss://www.seismicportal.eu/standing_order/websocket';
const USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
const PLATES =
	'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';

/** Ml → ML, mww → Mww (how magnitudes are written) */
function magTypeName(type: unknown) {
	const t = String(type ?? '').toLowerCase();
	if (!t) return 'M';
	return t === 'ml' ? 'ML' : 'M' + t.slice(1);
}

/** SOUTHERN GREECE → Southern Greece */
function regionName(text: string) {
	return text
		.toLowerCase()
		.replace(/(^|[\s\-(/])([a-z])/g, (_, before, letter) => before + letter.toUpperCase())
		.replace(/ (Of|And|The) /g, (word) => word.toLowerCase());
}

/** A quake of the EMSC (its lists and its live feed have the same shape) */
function fromEmsc(feature: any): Quake | null {
	const p = feature?.properties;
	if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || typeof p.mag !== 'number')
		return null;
	// Explosions (mines, quarries, tests) aren't quakes
	if (/^[ks][xmn]$/.test(p.evtype ?? '')) return null;
	const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(p.time) ? p.time : `${p.time}Z`);
	if (!isFinite(time)) return null;
	const id = String(p.unid ?? feature.id);
	return {
		id,
		time,
		lat: p.lat,
		lon: p.lon,
		depth: Math.max(0, Number(p.depth) || 0),
		mag: p.mag,
		magType: magTypeName(p.magtype),
		region: regionName(String(p.flynn_region ?? '')),
		source: String(p.auth ?? 'EMSC'),
		url: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(id)}`
	};
}

function fromUsgs(feature: any): Quake | null {
	const p = feature?.properties;
	const [lon, lat, depth] = feature?.geometry?.coordinates ?? [];
	if (!p || typeof lat !== 'number' || typeof lon !== 'number' || typeof p.mag !== 'number')
		return null;
	if (p.type && p.type !== 'earthquake') return null;
	return {
		id: `usgs:${feature.id}`,
		time: p.time,
		lat,
		lon,
		depth: Math.max(0, Number(depth) || 0),
		mag: p.mag,
		magType: magTypeName(p.magType),
		region: String(p.place ?? p.title ?? ''),
		source: String(p.net ?? 'us').toUpperCase(),
		url: p.url ?? ''
	};
}

/**
 * The quakes since a time (ms) from the EMSC; when it can't be reached, the USGS's of the
 * whole week (its list has no other start)
 */
export async function loadQuakes(since: number): Promise<{ list: Quake[]; from: QuakeSource }> {
	const ms = Date.now() - since > DAY ? 30000 : 15000;
	try {
		const start = new Date(since).toISOString().slice(0, 19);
		const list = await fetchWithin(
			`${EMSC}?format=json&orderby=time&limit=6000&starttime=${start}`,
			ms,
			async (response) => {
				// No quakes in the time
				if (response.status === 204) return [];
				if (!response.ok) throw new Error(`EMSC answered ${response.status}`);
				return ((await response.json()).features ?? []).map(fromEmsc).filter(Boolean);
			}
		);
		return { list, from: 'emsc' };
	} catch (error) {
		console.warn('EMSC not reachable, the USGS instead', error);
	}
	const list = await fetchWithin(USGS, 30000, async (response) => {
		if (!response.ok) throw new Error(`USGS answered ${response.status}`);
		return ((await response.json()).features ?? []).map(fromUsgs).filter(Boolean);
	});
	return { list, from: 'usgs' };
}

/** A message of the EMSC's live feed: a quake located (or corrected), or one taken back */
export function liveMessage(text: string): { quake: Quake | null; deleted?: string } {
	const message = JSON.parse(text);
	if (message?.action === 'delete') return { quake: null, deleted: String(message.data?.id ?? '') };
	return { quake: fromEmsc(message?.data) };
}

/** The boundaries of the tectonic plates (Bird, 2002) as lines of [lon, lat] */
let plates: Promise<[number, number][][]> | null = null;
export function plateBoundaries() {
	plates ??= fetchWithin(PLATES, 30000, async (response) => {
		if (!response.ok) throw new Error(`Plate boundaries: ${response.status}`);
		const lines: [number, number][][] = [];
		for (const feature of (await response.json()).features ?? []) {
			const geometry = feature?.geometry;
			const parts =
				geometry?.type === 'LineString'
					? [geometry.coordinates]
					: geometry?.type === 'MultiLineString'
						? geometry.coordinates
						: [];
			for (const part of parts) {
				// On over the date line (east of 180° on, not back across the whole map)
				const line: [number, number][] = [];
				for (const [lon, lat] of part) {
					const before = line[line.length - 1]?.[0] ?? lon;
					line.push([lon + Math.round((before - lon) / 360) * 360, lat]);
				}
				if (line.length > 1) lines.push(line);
			}
		}
		return lines;
	}).catch((error) => {
		plates = null;
		throw error;
	});
	return plates;
}

// --- What's shown --------------------------------------------------------------------------

export const QUAKE_PERIODS = [
	{ id: 'hour', label: '1 h', ms: HOUR },
	{ id: 'day', label: '24 h', ms: DAY },
	{ id: 'week', label: '7 days', ms: 7 * DAY }
];
/** The smallest magnitude shown (0: all) */
export const QUAKE_MAGNITUDES = [0, 2.5, 4.5, 6];

// --- How they look -------------------------------------------------------------------------

export const AGE_COLOURS = [
	{ label: 'Last hour', ms: HOUR, colour: '#ef4444' },
	{ label: 'Last day', ms: DAY, colour: '#fb923c' },
	{ label: 'This week', ms: Infinity, colour: '#facc15' }
];
export const DEPTH_COLOURS = [
	{ label: '0–35 km', km: 35, colour: '#f43f5e' },
	{ label: '35–70', km: 70, colour: '#fb923c' },
	{ label: '70–150', km: 150, colour: '#facc15' },
	{ label: '150–300', km: 300, colour: '#4ade80' },
	{ label: '300+ km', km: Infinity, colour: '#38bdf8' }
];

export type QuakeColouring = 'age' | 'depth';

export function quakeColour(quake: Quake, by: QuakeColouring, now = Date.now()) {
	if (by === 'depth') return DEPTH_COLOURS.find((d) => quake.depth < d.km)!.colour;
	return AGE_COLOURS.find((a) => now - quake.time < a.ms)!.colour;
}

/** The colour of a magnitude itself (for the numbers in lists) */
export function magColour(mag: number) {
	if (mag >= 7) return '#d946ef';
	if (mag >= 6) return '#ef4444';
	if (mag >= 4.5) return '#fb923c';
	if (mag >= 3) return '#facc15';
	return '#94a3b8';
}

/** px: a magnitude more is a bigger circle each time (the energy grows ~32 times) */
export function quakeRadius(mag: number) {
	const m = Math.max(0, Math.min(9.5, mag));
	return 1.5 + 0.45 * m * m;
}

const withAlpha = (hex: string, alpha: number) =>
	hex +
	Math.round(Math.max(0, Math.min(1, alpha)) * 255)
		.toString(16)
		.padStart(2, '0');

/**
 * Quakes on a map: a circle each, the biggest underneath; those of the last hour pulse.
 * `shifts` are where the world repeats on the screen (a map zoomed far out shows it more
 * than once).
 */
export function drawQuakes(
	c: CanvasRenderingContext2D,
	list: Quake[],
	toScreen: (lat: number, lon: number) => { x: number; y: number },
	width: number,
	height: number,
	{
		shifts = [0],
		colourBy = 'age',
		selected = null,
		scale = 1
	}: { shifts?: number[]; colourBy?: QuakeColouring; selected?: string | null; scale?: number } = {}
) {
	const now = Date.now();
	const pulse = (now % 2000) / 2000;
	const sorted = [...list].sort((a, b) => b.mag - a.mag);
	let picked: { quake: Quake; x: number; y: number; r: number; colour: string } | null = null;
	c.textAlign = 'center';
	c.textBaseline = 'middle';
	for (const quake of sorted) {
		const p = toScreen(quake.lat, quake.lon);
		const r = quakeRadius(quake.mag) * scale;
		const colour = quakeColour(quake, colourBy, now);
		for (const shift of shifts) {
			const x = p.x + shift;
			const y = p.y;
			if (x < -r - 40 || y < -r - 40 || x > width + r + 40 || y > height + r + 40) continue;
			if (quake.id === selected) {
				picked = { quake, x, y, r, colour };
				continue;
			}
			if (now - quake.time < HOUR) {
				c.beginPath();
				c.arc(x, y, r + pulse * (10 + r), 0, Math.PI * 2);
				c.strokeStyle = withAlpha(colour, (1 - pulse) * 0.8);
				c.lineWidth = 2;
				c.stroke();
			}
			c.beginPath();
			c.arc(x, y, r, 0, Math.PI * 2);
			c.fillStyle = withAlpha(colour, 0.72);
			c.fill();
			c.strokeStyle = 'rgba(0, 0, 0, 0.55)';
			c.lineWidth = 1;
			c.stroke();
			if (r >= 11) {
				c.font = `800 ${Math.min(14, Math.round(r * 0.6))}px system-ui, sans-serif`;
				c.fillStyle = 'rgba(0, 0, 0, 0.85)';
				c.fillText(quake.mag.toFixed(1), x, y + 0.5);
			}
		}
	}
	if (picked) {
		const { quake, x, y, r, colour } = picked;
		c.beginPath();
		c.arc(x, y, r + 5, 0, Math.PI * 2);
		c.fillStyle = 'rgba(255, 255, 255, 0.15)';
		c.fill();
		c.strokeStyle = '#ffffff';
		c.lineWidth = 2.5;
		c.stroke();
		c.beginPath();
		c.arc(x, y, r, 0, Math.PI * 2);
		c.fillStyle = colour;
		c.fill();
		c.font = '700 11px system-ui, sans-serif';
		const label = `M${quake.mag.toFixed(1)}`;
		const w = c.measureText(label).width + 10;
		c.fillStyle = 'rgba(0, 0, 0, 0.75)';
		c.beginPath();
		c.roundRect(x + r + 7, y - 9, w, 18, 5);
		c.fill();
		c.fillStyle = '#ffffff';
		c.fillText(label, x + r + 7 + w / 2, y + 0.5);
	}
	c.textAlign = 'start';
	c.textBaseline = 'alphabetic';
}

/** The quake under a point of the map: of those it's inside, the one whose middle is nearest */
export function quakeAt(
	list: Quake[],
	toScreen: (lat: number, lon: number) => { x: number; y: number },
	x: number,
	y: number,
	{ shifts = [0], scale = 1 }: { shifts?: number[]; scale?: number } = {}
) {
	let best: Quake | null = null;
	let bestDistance = Infinity;
	for (const quake of list) {
		const p = toScreen(quake.lat, quake.lon);
		const reach = Math.max(8, quakeRadius(quake.mag) * scale + 3);
		for (const shift of shifts) {
			const distance = Math.hypot(p.x + shift - x, p.y - y);
			if (distance <= reach && distance < bestDistance) {
				best = quake;
				bestDistance = distance;
			}
		}
	}
	return best;
}

// --- What the numbers mean -------------------------------------------------------------------

/** The usual class of a magnitude, and what a shallow quake of it does near its centre */
export function magClass(mag: number) {
	if (mag < 2) return { label: 'Micro', effect: 'Not felt, only recorded by seismometers' };
	if (mag < 3) return { label: 'Minor', effect: 'Hardly felt, recorded by seismometers' };
	if (mag < 4) return { label: 'Minor', effect: 'Often felt, rarely any damage' };
	if (mag < 5)
		return { label: 'Light', effect: 'Felt by most, things indoors rattle; damage unlikely' };
	if (mag < 6)
		return {
			label: 'Moderate',
			effect: 'Felt by everyone; damage to poorly built buildings possible'
		};
	if (mag < 7)
		return { label: 'Strong', effect: 'Damage in populated areas, also to well-built buildings' };
	if (mag < 8) return { label: 'Major', effect: 'Serious damage over large areas' };
	return { label: 'Great', effect: 'Destruction near the centre, felt very far away' };
}

/** How deep it is, in the words seismologists use */
export function depthClass(km: number) {
	return km < 70 ? 'Shallow' : km < 300 ? 'Intermediate' : 'Deep';
}

/** The energy set free, as an amount of TNT (log₁₀ E = 1.5 M + 4.8, E in joules) */
export function energyTnt(mag: number) {
	const tonnes = 10 ** (1.5 * mag + 4.8) / 4.184e9;
	const round = (n: number) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(1));
	if (tonnes < 1) return `${round(tonnes * 1000)} kg`;
	if (tonnes < 1000) return `${round(tonnes)} t`;
	if (tonnes < 1e6) return `${round(tonnes / 1000)} kt`;
	return `${round(tonnes / 1e6)} Mt`;
}

/** 5 min ago, 3 h ago, 2 d ago */
export function quakeAgo(time: number, now = Date.now()) {
	const minutes = Math.max(0, Math.round((now - time) / MINUTE));
	if (minutes < 60) return minutes <= 0 ? 'just now' : `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.round(hours / 24)} d ago`;
}
