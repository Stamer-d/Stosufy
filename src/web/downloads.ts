// Songs kept on the phone: their audio in IndexedDB, played from there (offline too), and
// what they are (title, artist…) for the Downloads tab. The browser lets the app read the
// audio only if the mirror allows it (CORS): the checks page tells.

import { osuFile } from './osuFiles';
import { hitsoundMapId, learnHardest } from './difficulties';
import { askDuration } from './duration';
import { get, writable } from 'svelte/store';
import { keyOf, slim, streamUrl } from './songs';
import type { MapSet } from '../lib/types';

const DATABASE = 'stosufy-audio';
const AUDIO = 'audio';
const SONGS = 'songs';
/** Downloads at once (a playlist's) */
const AT_ONCE = 2;

let database: Promise<IDBDatabase> | null = null;
function open() {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 2);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
			if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return database;
}

async function run<T>(
	name: string,
	mode: IDBTransactionMode,
	use: (store: IDBObjectStore) => IDBRequest<T>
) {
	const db = await open();
	return new Promise<T>((resolve, reject) => {
		const request = use(db.transaction(name, mode).objectStore(name));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** The songs kept (by the id of the difficulty they're of) */
export const downloaded = writable<Set<string>>(new Set());
/** What the kept songs are, the newest first */
export const downloadedSongs = writable<(MapSet & { keptAt?: number })[]>([]);
/** The songs being downloaded right now */
export const downloading = writable<Set<string>>(new Set());
/** The playlists kept downloaded: their new songs are downloaded too (by id) */
const AUTO_KEY = 'stosufy-web-auto-download';
function keptAuto(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(AUTO_KEY) ?? '[]'));
	} catch {
		return new Set();
	}
}
export const autoDownload = writable<Set<string>>(
	typeof localStorage === 'undefined' ? new Set() : keptAuto()
);
export function setAutoDownload(id: string | number, on: boolean) {
	autoDownload.update((all) => {
		const next = new Set(all);
		if (on) next.add(String(id));
		else next.delete(String(id));
		try {
			localStorage.setItem(AUTO_KEY, JSON.stringify([...next]));
		} catch {
			// (only for now)
		}
		return next;
	});
}

/** A playlist being downloaded: how far it is */
export const bulk = writable<{ done: number; total: number; failed: number } | null>(null);

async function refresh() {
	const [keys, songs] = await Promise.all([
		run(AUDIO, 'readonly', (store) => store.getAllKeys()),
		run<(MapSet & { keptAt?: number })[]>(SONGS, 'readonly', (store) => store.getAll())
	]);
	const kept = new Set(keys.map(String));
	downloaded.set(kept);
	downloadedSongs.set(
		songs.filter((song) => kept.has(keyOf(song))).sort((a, b) => (b.keptAt ?? 0) - (a.keptAt ?? 0))
	);
}
if (typeof indexedDB !== 'undefined') refresh().catch(() => {});

export const isDownloaded = (keys: Set<string>, song: MapSet) => keys.has(keyOf(song));
export const isDownloading = (keys: Set<string>, song: MapSet) => keys.has(keyOf(song));

const without = (all: Set<string>, key: string) => {
	const next = new Set(all);
	next.delete(key);
	return next;
};

/** Downloads a song's audio; throws if the mirror doesn't let the app read it */
export async function download(song: MapSet) {
	const key = keyOf(song);
	if (get(downloaded).has(key) || get(downloading).has(key)) return;
	downloading.update((all) => new Set(all).add(key));
	try {
		const response = await fetch(streamUrl(song));
		if (!response.ok) throw new Error(`The mirror answered ${response.status}`);
		// The bytes, not a Blob: Safari loses Blobs kept in IndexedDB (they can't be read after
		// a while, or can't be kept at all in some modes); bytes it keeps
		const kept: KeptAudio = {
			data: await response.arrayBuffer(),
			type: response.headers.get('content-type') || 'audio/mpeg'
		};
		const entry = { ...slim(song), keptAt: Date.now() };
		await run(AUDIO, 'readwrite', (store) => store.put(kept, key));
		await run(SONGS, 'readwrite', (store) => store.put(entry, key));
		downloaded.update((all) => new Set(all).add(key));
		downloadedSongs.update((all) => [entry, ...all.filter((other) => keyOf(other) !== key)]);
		// Kept for good, as far as iOS lets it (else it may clear it when space runs out)
		navigator.storage?.persist?.().catch(() => {});
		// Its beatmap too: hitsounds and the Nightcore beat offline
		learnHardest(song)
			.then(() => osuFile(hitsoundMapId(song)))
			.catch(() => {});
		// (and how long it is: Safari may get that wrong, offline too)
		askDuration(song);
	} finally {
		downloading.update((all) => without(all, key));
	}
}

let stopBulk = false;

/** Downloads all of these songs that aren't kept yet, a few at once */
export async function downloadAll(songs: MapSet[]) {
	if (get(bulk)) return;
	const todo = songs.filter((song) => !get(downloaded).has(keyOf(song)));
	if (!todo.length) return;
	stopBulk = false;
	bulk.set({ done: 0, total: todo.length, failed: 0 });
	let next = 0;
	const worker = async () => {
		while (!stopBulk && next < todo.length) {
			const song = todo[next++];
			let failed = 0;
			await download(song).catch(() => (failed = 1));
			bulk.update((b) => b && { ...b, done: b.done + 1, failed: b.failed + failed });
		}
	};
	await Promise.all(Array.from({ length: AT_ONCE }, worker));
	const result = get(bulk);
	bulk.set(null);
	return result;
}

/** Stops downloading a playlist (the songs being downloaded right now still finish) */
export function stopDownloadAll() {
	stopBulk = true;
}

export async function removeDownload(song: MapSet) {
	const key = keyOf(song);
	// Shown gone right away, then taken off the phone
	downloaded.update((all) => without(all, key));
	downloadedSongs.update((all) => all.filter((other) => keyOf(other) !== key));
	await run(AUDIO, 'readwrite', (store) => store.delete(key));
	await run(SONGS, 'readwrite', (store) => store.delete(key));
}

export async function removeAllDownloads() {
	downloaded.set(new Set());
	downloadedSongs.set([]);
	await run(AUDIO, 'readwrite', (store) => store.clear());
	await run(SONGS, 'readwrite', (store) => store.clear());
}

/** A song's kept audio to play (null: not kept) */
export async function localUrl(song: MapSet): Promise<string | null> {
	const kept = await run<KeptAudio | Blob | undefined>(AUDIO, 'readonly', (store) =>
		store.get(keyOf(song))
	).catch(() => undefined);
	if (!kept) return null;
	// (downloads from before were kept as a Blob)
	const blob = kept instanceof Blob ? kept : new Blob([kept.data], { type: kept.type });
	return blob.size ? URL.createObjectURL(blob) : null;
}

/** A song's audio as kept on the phone */
interface KeptAudio {
	data: ArrayBuffer;
	type: string;
}
