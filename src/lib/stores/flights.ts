// The planes on the map now, kept up to date every few seconds while a map shows them, with
// the trail each one flew since it's been seen. The plane picked is followed anywhere.

import { writable, get } from 'svelte/store';
import {
	planeOf,
	planesAround,
	planeByHex,
	topFlights,
	flightTrack,
	type Plane,
	type TopFlight,
	type TrailPoint
} from '../flights';

/** Every few seconds, like the flight radars (and within the network's limits) */
const EVERY_MS = 6000;

export const planes = writable<Plane[]>([]);
export const flightStatus = writable<{
	state: 'off' | 'loading' | 'live' | 'error';
	error?: string;
}>({
	state: 'off'
});
/** The plane picked (ICAO hex), followed wherever it flies */
export const followed = writable<string | null>(null);

/** The whole flight of the plane followed (since it took off), when the networks have it */
export const followedTrack = writable<TrailPoint[] | null>(null);
let trackFor: string | null = null;
let trackTimer: ReturnType<typeof setTimeout> | undefined;
followed.subscribe((hex) => {
	if (hex === trackFor) return;
	trackFor = hex;
	clearTimeout(trackTimer);
	followedTrack.set(null);
	if (!hex) return;
	const load = async () => {
		const track = await flightTrack(hex).catch(() => null);
		if (trackFor !== hex) return;
		if (track) followedTrack.set(track);
		// Again now and then: it flies on (what's seen meanwhile is added on the map)
		trackTimer = setTimeout(load, 2 * 60 * 1000);
	};
	load();
});

let area: { lat: number; lon: number; radiusNm: number } | null = null;
let users = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const known = new Map<string, Plane>();

/** The area the map shows (its middle, and how far to its corners) */
export function setFlightArea(next: { lat: number; lon: number; radiusNm: number } | null) {
	const changed =
		!area ||
		!next ||
		Math.abs(area.lat - next.lat) > 0.05 ||
		Math.abs(area.lon - next.lon) > 0.05 ||
		Math.abs(area.radiusNm - next.radiusNm) > area.radiusNm * 0.2;
	area = next;
	// Moved somewhere else: loaded soon, not at the next turn
	if (changed && users && next) schedule(500);
}

function schedule(ms: number) {
	clearTimeout(timer);
	timer = setTimeout(poll, ms);
}

async function poll() {
	if (!users) return;
	const now = Date.now();
	const where = area;
	if (!where) return schedule(1000);
	if (document.hidden) return schedule(EVERY_MS);
	if (get(flightStatus).state !== 'live') flightStatus.set({ state: 'loading' });
	try {
		const list = await planesAround(where.lat, where.lon, where.radiusNm);
		const seen = new Set<string>();
		for (const ac of list) {
			const hex = String(ac.hex ?? '').toLowerCase();
			const plane = planeOf(ac, now, known.get(hex));
			if (!plane) continue;
			seen.add(plane.hex);
			known.set(plane.hex, plane);
		}
		// The one followed, also out of the area
		const hex = get(followed);
		if (hex && !seen.has(hex)) {
			const [ac] = await planeByHex(hex).catch(() => []);
			const plane = ac ? planeOf(ac, Date.now(), known.get(hex)) : null;
			if (plane) {
				seen.add(hex);
				known.set(hex, plane);
			}
		}
		for (const key of known.keys()) if (!seen.has(key)) known.delete(key);
		planes.set([...known.values()]);
		flightStatus.set({ state: 'live' });
	} catch (error) {
		flightStatus.set({
			state: 'error',
			error: error instanceof Error ? error.message : String(error)
		});
	}
	schedule(EVERY_MS);
}

/** A plane found elsewhere (search, the top list): shown right away */
export function showPlane(plane: Plane) {
	const old = known.get(plane.hex);
	const merged = old && old.at > plane.at ? old : { ...plane, trail: old?.trail ?? plane.trail };
	known.set(plane.hex, merged);
	planes.set([...known.values()]);
	return merged;
}

/** Keeps the planes coming while something shows them; returns the stop */
export function useFlights() {
	users++;
	if (users === 1) schedule(100);
	return () => {
		users--;
		if (users) return;
		clearTimeout(timer);
		known.clear();
		planes.set([]);
		flightStatus.set({ state: 'off' });
	};
}

// --- The flights to watch -------------------------------------------------------------------

export const topList = writable<{ list: TopFlight[]; loading: boolean; at: number }>({
	list: [],
	loading: false,
	at: 0
});
let topUsers = 0;
let topTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshTop() {
	if (!topUsers) return;
	topList.update((t) => ({ ...t, loading: true }));
	try {
		const list = await topFlights(10);
		topList.set({ list, loading: false, at: Date.now() });
	} catch {
		topList.update((t) => ({ ...t, loading: false }));
	}
	clearTimeout(topTimer);
	topTimer = setTimeout(refreshTop, 2 * 60 * 1000);
}

export function useTopFlights() {
	topUsers++;
	const { at } = get(topList);
	if (topUsers === 1) {
		clearTimeout(topTimer);
		topTimer = setTimeout(
			refreshTop,
			Date.now() - at > 2 * 60 * 1000 ? 1500 : 2 * 60 * 1000 - (Date.now() - at)
		);
	}
	return () => {
		topUsers--;
		if (!topUsers) clearTimeout(topTimer);
	};
}
