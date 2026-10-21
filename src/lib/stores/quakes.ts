// The earthquakes of the last week, kept up to date while something shows them: loaded once,
// then live from the EMSC as each one is located, and asked for again every few minutes (for
// what the live feed missed, and the ones corrected later). Connected only while in use.

import { writable } from 'svelte/store';
import {
	loadQuakes,
	liveMessage,
	KEEP_MS,
	EMSC_LIVE,
	type Quake,
	type QuakeSource
} from '../quakes';

const POLL_MS = 2 * 60 * 1000;
/** The whole week again now and then (drops the quakes taken back), else what changed lately */
const FULL_EVERY_MS = 30 * 60 * 1000;
const RECENT_MS = 3 * 60 * 60 * 1000;

/** Newest first */
export const quakes = writable<Quake[]>([]);
export const quakeStatus = writable<{
	state: 'off' | 'loading' | 'live' | 'updating' | 'error';
	from?: QuakeSource;
}>({ state: 'off' });

const known = new Map<string, Quake>();
let source: QuakeSource | null = null;
let loadedAt = 0;
let failed = false;
let users = 0;
let loading = false;
let poll: ReturnType<typeof setInterval> | undefined;
/** When each quake came in live (ms), by its id */
const arrivedLive = new Map<string, number>();

/** Told about quakes that come in while watching (located in the last hour) */
const listeners = new Set<(list: Quake[]) => void>();
export function onNewQuakes(listener: (list: Quake[]) => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function publish() {
	const cutoff = Date.now() - KEEP_MS;
	for (const [id, quake] of known) if (quake.time < cutoff) known.delete(id);
	quakes.set([...known.values()].sort((a, b) => b.time - a.time));
}

function merge(list: Quake[], replace: boolean, tell: boolean) {
	const fresh = tell
		? list.filter((q) => !known.has(q.id) && Date.now() - q.time < 60 * 60 * 1000)
		: [];
	if (replace) known.clear();
	for (const quake of list) known.set(quake.id, quake);
	publish();
	if (fresh.length) for (const listener of listeners) listener(fresh);
}

function setStatus() {
	quakeStatus.set({
		state: !users
			? 'off'
			: !source
				? failed
					? 'error'
					: 'loading'
				: socketOpen && source === 'emsc'
					? 'live'
					: 'updating',
		from: source ?? undefined
	});
}

async function refresh() {
	if (!users || loading) return;
	loading = true;
	// The USGS's list is always the whole week; the EMSC's the whole week now and then
	const full = source !== 'emsc' || Date.now() - loadedAt > FULL_EVERY_MS;
	const asked = Date.now();
	try {
		const { list, from } = await loadQuakes(asked - (full ? KEEP_MS : RECENT_MS));
		const replace = full || from !== source;
		// What came in live meanwhile isn't in the answer yet: kept (and not told about again)
		const meanwhile =
			replace && from === 'emsc' && source === 'emsc'
				? [...known.values()].filter((q) => (arrivedLive.get(q.id) ?? 0) > asked)
				: [];
		if (replace) arrivedLive.clear();
		merge([...list, ...meanwhile], replace, from === source);
		if (replace) loadedAt = Date.now();
		source = from;
		failed = false;
	} catch (error) {
		console.warn('Could not load the earthquakes', error);
		failed = true;
	} finally {
		loading = false;
		setStatus();
	}
}

// --- Live (the EMSC's feed: each quake as it's located) ------------------------------------
interface Connection {
	close: () => void;
}
let socket: Connection | null = null;
let socketOpen = false;
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let wait = 5000;

function receive(text: string) {
	try {
		const { quake, deleted } = liveMessage(text);
		// Only onto the EMSC's own list (the USGS's has the same quakes by other names)
		if (source !== 'emsc') return;
		if (deleted && known.delete(deleted)) publish();
		if (quake) {
			arrivedLive.set(quake.id, Date.now());
			merge([quake], false, true);
		}
	} catch {
		// Not a quake
	}
}

function opened(id: number) {
	if (id !== attempt) return;
	socketOpen = true;
	wait = 5000;
	setStatus();
}

function lost(id: number) {
	if (id !== attempt) return;
	socket = null;
	socketOpen = false;
	setStatus();
	if (!users) return;
	// Again a bit later, longer each time it doesn't work
	retry = setTimeout(connect, wait);
	wait = Math.min(wait * 2, 2 * 60 * 1000);
}

/** From the app's backend, else the browser's WebSocket */
async function connect() {
	if (!users || socket) return;
	const id = ++attempt;
	try {
		const { default: TauriSocket } = await import('@tauri-apps/plugin-websocket');
		const ws = await TauriSocket.connect(EMSC_LIVE);
		if (id !== attempt || !users) {
			ws.disconnect().catch(() => {});
			return;
		}
		socket = { close: () => ws.disconnect().catch(() => {}) };
		ws.addListener((message) => {
			if (message.type === 'Text') receive(message.data as string);
			else if (message.type === 'Close') lost(id);
		});
		opened(id);
		return;
	} catch {
		// No backend connection: the browser's WebSocket
	}
	if (id !== attempt || !users) return;
	try {
		const ws = new WebSocket(EMSC_LIVE);
		socket = { close: () => ws.close() };
		ws.onopen = () => opened(id);
		ws.onmessage = (event) => receive(String(event.data));
		ws.onclose = () => lost(id);
		ws.onerror = () => ws.close();
	} catch {
		lost(id);
	}
}

/** Keeps the quakes up to date while something shows them; returns the stop */
export function useQuakes() {
	users++;
	if (users === 1) {
		setStatus();
		refresh();
		poll = setInterval(refresh, POLL_MS);
		connect();
	}
	return () => {
		users--;
		if (users) return;
		clearInterval(poll);
		clearTimeout(retry);
		attempt++;
		socket?.close();
		socket = null;
		socketOpen = false;
		setStatus();
	};
}
