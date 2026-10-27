// The web app has no library of downloaded beatmaps: its "library" is the songs of the
// user's playlists and the songs kept on the phone (src/web/library.ts fills it in), which
// the radio picks from.

import { get, writable } from 'svelte/store';
import type { MapSet, StoredMapSet } from '../../lib/types';

export const mapDataStore = writable<Record<string, StoredMapSet>>({});

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
