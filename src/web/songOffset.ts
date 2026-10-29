// A song's own hitsound offset, as osu!'s local offset: on top of the one in the settings,
// for this beatmap set only, set while it plays. Songs are heard a little earlier or later
// depending on their file, so one offset doesn't fit all of them. This phone's own.

import { get, writable } from 'svelte/store';
import type { MapSet } from '../lib/types';
import { log } from './log';

const KEY = 'stosufy-web-song-offsets';
/** Most it goes either way (ms) */
const MOST = 300;

export const songOffsets = writable<Record<string, number>>(
	(() => {
		try {
			return JSON.parse(localStorage.getItem(KEY) || '{}');
		} catch {
			return {};
		}
	})()
);
songOffsets.subscribe((all) => {
	try {
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {
		// (as it was, next time)
	}
});

/** The song's own offset (ms; positive: the hitsounds later) */
export const songOffsetOf = (song: MapSet | null | undefined) =>
	song ? (get(songOffsets)[String(song.id)] ?? 0) : 0;

/** Moves the song's hitsounds later (positive) or earlier, by `by` ms; 0 puts it back */
export function nudgeSongOffset(song: MapSet, by: number) {
	const set = String(song.id);
	const now = by === 0 ? 0 : Math.max(-MOST, Math.min(MOST, songOffsetOf(song) + by));
	songOffsets.update((all) => {
		const next = { ...all };
		if (now) next[set] = now;
		else delete next[set];
		return next;
	});
	log(`hitsound offset for ${song.title}: ${now > 0 ? '+' : ''}${now} ms`);
}
