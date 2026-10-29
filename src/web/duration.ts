// How long a song really is. The mirror sends some songs (Ogg Vorbis served as mp3, mp3
// without a table of its frames) so that Safari can only guess their length, and it guessed
// twice as long: the position line was wrong, and so was the song's end. The Stosufy API
// reads the file once and says (kept here, by difficulty, also for offline); until it has, a
// length Safari makes up is taken for what osu! says the beatmap is long.

import { get } from 'svelte/store';
import { offline } from '../lib/stores/network';
import { keyOf } from './songs';
import type { MapSet } from '../lib/types';

const API = 'https://api.stamer-d.de/v2/stosufy/duration/';
const KEY = 'stosufy-web-durations';
const known: Record<string, number> = (() => {
	try {
		return JSON.parse(localStorage.getItem(KEY) || '{}');
	} catch {
		return {};
	}
})();
const asking = new Set<string>();

function keep(key: string, seconds: number) {
	delete known[key];
	known[key] = Math.round(seconds * 100) / 100;
	// (the oldest go: a few thousand songs at most)
	const keys = Object.keys(known);
	for (const old of keys.slice(0, Math.max(0, keys.length - 5000))) delete known[old];
	try {
		localStorage.setItem(KEY, JSON.stringify(known));
	} catch {
		// (asked again next time)
	}
}

/** Asks how long the song is, once (the answer is kept) */
export function askDuration(song: MapSet | null | undefined) {
	const key = song ? keyOf(song) : '';
	if (!(Number(key) > 0) || key in known || asking.has(key) || get(offline)) return;
	asking.add(key);
	fetch(API + key)
		.then((response) => (response.ok ? response.json() : null))
		.then((answer) => {
			if (answer?.seconds > 0) keep(key, answer.seconds);
		})
		.catch(() => {})
		.finally(() => asking.delete(key));
}

/**
 * The song's length (s): known, else the element's if it can be (not far past what osu! says
 * the beatmap is long), else osu!'s
 */
export function songDuration(song: MapSet | null | undefined, element: number) {
	if (!song) return element || 0;
	const sure = known[keyOf(song)];
	if (sure) return sure;
	const beatmap = Number(song.beatmaps?.[0]?.total_length) || 0;
	if (element > 0 && Number.isFinite(element) && (!beatmap || element < beatmap * 1.4 + 30))
		return element;
	return beatmap || (Number.isFinite(element) ? element : 0);
}
