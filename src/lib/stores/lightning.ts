// Live lightning from the Blitzortung.org community network (strikes within seconds), kept
// for the last half hour. Connected only while something shows it.

import { writable, get } from 'svelte/store';
import { distanceKm } from '../map';

export interface Strike {
	/** ms */
	time: number;
	lat: number;
	lon: number;
}

const KEEP = 30 * 60 * 1000;
const MAX = 20000;
const SERVERS = ['ws1', 'ws7', 'ws8', 'ws5', 'ws6'].map((name) => `wss://${name}.blitzortung.org/`);

/** The strikes of the last half hour, oldest first */
export const strikes = writable<Strike[]>([]);
export const lightningStatus = writable<'off' | 'connecting' | 'live' | 'error'>('off');

let users = 0;
let socket: WebSocket | null = null;
let server = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let pending: Strike[] = [];
let flush: ReturnType<typeof setTimeout> | undefined;

/** The network's messages are LZW-packed JSON */
function unpack(text: string) {
	const dict: Record<number, string> = {};
	const chars = text.split('');
	let current = chars[0];
	let previous = current;
	const out = [current];
	let code = 256;
	for (let i = 1; i < chars.length; i++) {
		const value = chars[i].charCodeAt(0);
		const entry = value < 256 ? chars[i] : (dict[value] ?? previous + current);
		out.push(entry);
		current = entry.charAt(0);
		dict[code++] = previous + current;
		previous = entry;
	}
	return out.join('');
}

function add(strike: Strike) {
	pending.push(strike);
	// Many strikes come at once: added together, a few times a second
	flush ??= setTimeout(() => {
		flush = undefined;
		const cutoff = Date.now() - KEEP;
		const fresh = pending;
		pending = [];
		strikes.update((list) => {
			const kept = list.filter((s) => s.time > cutoff);
			kept.push(...fresh);
			return kept.length > MAX ? kept.slice(-MAX) : kept;
		});
	}, 250);
}

function connect() {
	if (!users || socket) return;
	lightningStatus.set('connecting');
	const ws = new WebSocket(SERVERS[server % SERVERS.length]);
	socket = ws;
	ws.onopen = () => {
		ws.send('{"a":111}');
		lightningStatus.set('live');
	};
	ws.onmessage = (event) => {
		try {
			const data = JSON.parse(unpack(String(event.data)));
			if (typeof data.lat === 'number' && typeof data.lon === 'number')
				add({
					time: Math.round((data.time ?? Date.now() * 1e6) / 1e6),
					lat: data.lat,
					lon: data.lon
				});
		} catch {
			// Not a strike
		}
	};
	ws.onclose = () => {
		if (socket === ws) socket = null;
		if (!users) return;
		// The next server, a bit later
		lightningStatus.set('error');
		server++;
		retry = setTimeout(connect, 3000);
	};
	ws.onerror = () => ws.close();
}

/** Keeps the connection while something shows lightning; returns the stop */
export function useLightning() {
	users++;
	connect();
	return () => {
		users--;
		if (users) return;
		clearTimeout(retry);
		socket?.close();
		socket = null;
		lightningStatus.set('off');
	};
}

/** Strikes near a place: how many in a time, and the nearest one */
export function strikesNear(
	list: Strike[],
	place: { lat: number; lon: number },
	radiusKm: number,
	sinceMs: number
) {
	let count = 0;
	let nearest: (Strike & { km: number; bearing: number }) | null = null;
	const since = Date.now() - sinceMs;
	for (const strike of list) {
		if (strike.time < since) continue;
		// Rough box first: most strikes are far away
		if (Math.abs(strike.lat - place.lat) > radiusKm / 100) continue;
		const km = distanceKm(place, strike);
		if (km > radiusKm) continue;
		count++;
		if (!nearest || km < nearest.km) {
			const y =
				Math.sin(((strike.lon - place.lon) * Math.PI) / 180) *
				Math.cos((strike.lat * Math.PI) / 180);
			const x =
				Math.cos((place.lat * Math.PI) / 180) * Math.sin((strike.lat * Math.PI) / 180) -
				Math.sin((place.lat * Math.PI) / 180) *
					Math.cos((strike.lat * Math.PI) / 180) *
					Math.cos(((strike.lon - place.lon) * Math.PI) / 180);
			nearest = { ...strike, km, bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
		}
	}
	return { count, nearest };
}

export function latestStrikes() {
	return get(strikes);
}
