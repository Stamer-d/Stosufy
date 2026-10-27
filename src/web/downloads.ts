// Songs kept on the phone: their audio in IndexedDB, played from there (offline too). The
// browser lets the app read the audio only if the mirror allows it (CORS): the checks page
// tells.

import { writable } from 'svelte/store';
import { streamUrl } from './player';
import type { MapSet } from '../lib/types';

const DATABASE = 'stosufy-audio';
const STORE = 'audio';

let database: Promise<IDBDatabase> | null = null;
function open() {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return database;
}

async function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>) {
	const db = await open();
	return new Promise<T>((resolve, reject) => {
		const request = use(db.transaction(STORE, mode).objectStore(STORE));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

const keyOf = (song: MapSet) => String(song.beatmaps?.[0]?.id ?? song.id);

/** The songs kept (by the id of the difficulty they're of) */
export const downloaded = writable<Set<string>>(new Set());
if (typeof indexedDB !== 'undefined') {
	run('readonly', (store) => store.getAllKeys())
		.then((keys) => downloaded.set(new Set(keys.map(String))))
		.catch(() => {});
}
/** The songs being downloaded right now */
export const downloading = writable<Set<string>>(new Set());

export const isDownloaded = (keys: Set<string>, song: MapSet) => keys.has(keyOf(song));

/** Downloads a song's audio; throws if the mirror doesn't let the app read it */
export async function download(song: MapSet) {
	const key = keyOf(song);
	downloading.update((all) => new Set(all).add(key));
	try {
		const response = await fetch(streamUrl(song));
		if (!response.ok) throw new Error(`The mirror answered ${response.status}`);
		const blob = await response.blob();
		await run('readwrite', (store) => store.put(blob, key));
		downloaded.update((all) => new Set(all).add(key));
		// Kept for good, as far as iOS lets it (else it may clear it when space runs out)
		navigator.storage?.persist?.().catch(() => {});
	} finally {
		downloading.update((all) => {
			const next = new Set(all);
			next.delete(key);
			return next;
		});
	}
}

export async function removeDownload(song: MapSet) {
	const key = keyOf(song);
	await run('readwrite', (store) => store.delete(key));
	downloaded.update((all) => {
		const next = new Set(all);
		next.delete(key);
		return next;
	});
}

/** A song's kept audio to play (null: not kept) */
export async function localUrl(song: MapSet): Promise<string | null> {
	const blob = await run<Blob | undefined>('readonly', (store) => store.get(keyOf(song))).catch(
		() => undefined
	);
	return blob ? URL.createObjectURL(blob) : null;
}
