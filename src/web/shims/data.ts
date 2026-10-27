// The web app has no library of downloaded beatmaps: its "library" is the songs of the
// user's playlists and the songs kept on the phone (src/web/library.ts fills it in), which
// the radio picks from.

import { get, writable } from 'svelte/store';
import { fetch as webFetch } from './http';
import { freshToken } from './auth';
import type { MapSet, StoredMapSet } from '../../lib/types';

export const mapDataStore = writable<Record<string, StoredMapSet>>({});

/** (nothing of the library is saved on the phone: the speed mods' store asks) */
export async function saveMapData() {}

/**
 * All playlists' songs are there: what follows the library (the daily mixes) goes on. (The
 * desktop app's library has a beatmap set per key; this one only says it's ready.)
 */
export function libraryReady() {
	mapDataStore.set({ web: {} as StoredMapSet });
}

/** The songs the radio can pick from */
export const libraryPool = writable<MapSet[]>([]);

const keyOf = (song: MapSet) => `${song.id}:${song.track ?? 0}`;

export const librarySongs = (): MapSet[] => get(libraryPool);

let byKey: { pool: MapSet[]; map: Map<string, MapSet> } | null = null;
export function libraryByKey(): Map<string, MapSet> {
	const pool = get(libraryPool);
	if (byKey?.pool !== pool) byKey = { pool, map: new Map(pool.map((song) => [keyOf(song), song])) };
	return byKey.map;
}

export const librarySetSongs = (setId: number | string): MapSet[] =>
	get(libraryPool).filter((song) => song.id == setId);

// What the desktop app's covers ask for (its SongCover and PlaylistCover show here as they are)

/** The S of the app, grey, where a cover can't be loaded */
const LOGO = `${__WEB_BASE__}/logo.png`;

/** A cover: the small square (300×300), or for big ones the whole background */
export async function thumbnailUrl(
	setId: number | string,
	_track = 0,
	large = false
): Promise<string> {
	return `https://assets.ppy.sh/beatmaps/${setId}/covers/${large ? 'fullsize' : 'list@2x'}.jpg`;
}

/** What to try when a cover can't be loaded: the whole background, the banner, the square */
const SMALLER: [RegExp, string][] = [
	[/\/covers\/fullsize\.jpg$/, '/covers/cover@2x.jpg'],
	[/\/covers\/cover@2x\.jpg$/, '/covers/list@2x.jpg']
];

export function handleImageError(event: Event) {
	const image = event.target as HTMLImageElement;
	for (const [from, to] of SMALLER) {
		if (from.test(image.src)) {
			image.src = image.src.replace(from, to);
			return;
		}
	}
	image.src = LOGO;
	image.style.filter = 'grayscale(100%)';
	image.style.opacity = '0.7';
}

export function getImageUrl(imageUrl: string | null | undefined) {
	return imageUrl || LOGO;
}

export function colorFromString(text = '') {
	let hash = 0;
	for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return `oklch(0.42 0.12 ${Math.abs(hash) % 360})`;
}

const imageColors = new Map<string, Promise<string | null>>();

/** An image's average color (only if its server lets the app read it: CORS) */
export function colorFromImage(url: string): Promise<string | null> {
	if (!imageColors.has(url))
		imageColors.set(
			url,
			new Promise((resolve) => {
				const image = new Image();
				image.crossOrigin = 'anonymous';
				image.onload = () => {
					try {
						const canvas = document.createElement('canvas');
						canvas.width = canvas.height = 16;
						const context = canvas.getContext('2d')!;
						context.drawImage(image, 0, 0, 16, 16);
						const pixels = context.getImageData(0, 0, 16, 16).data;
						let r = 0;
						let g = 0;
						let b = 0;
						for (let i = 0; i < pixels.length; i += 4) {
							r += pixels[i];
							g += pixels[i + 1];
							b += pixels[i + 2];
						}
						const n = pixels.length / 4;
						resolve(`rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`);
					} catch {
						resolve(null);
					}
				};
				image.onerror = () => resolve(null);
				image.src = url;
			})
		);
	return imageColors.get(url)!;
}

// osu!'s search and a beatmap set (the smart playlists' autofill and the beatmap page ask)

export async function fetchMaps(
	search = '',
	cursorString = '',
	filters: { status?: string; sort?: string; genre?: string; language?: string } = {}
) {
	const params = new URLSearchParams({ q: search });
	if (filters.status) params.set('s', filters.status);
	if (filters.sort) params.set('sort', filters.sort);
	if (cursorString) params.set('cursor_string', cursorString);
	if (filters.genre) params.set('g', filters.genre);
	if (filters.language) params.set('l', filters.language);
	const response = await webFetch(`https://osu.ppy.sh/api/v2/beatmapsets/search?${params}`, {
		headers: { Authorization: `Bearer ${await freshToken()}` }
	});
	if (!response.ok) throw new Error(`osu! answered ${response.status}`);
	return response.json();
}

export async function fetchBeatmapset(setId: number | string) {
	const response = await webFetch(`https://osu.ppy.sh/api/v2/beatmapsets/${setId}`, {
		headers: { Authorization: `Bearer ${await freshToken()}` }
	});
	if (!response.ok) throw new Error(`osu! answered ${response.status}`);
	return response.json();
}
