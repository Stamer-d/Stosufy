// Which difficulty of a song's beatmap set the hitsounds (and the Nightcore beat's timing)
// come from, as in the desktop app: the one chosen for the set (the account's gameplayDifficulty,
// the desktop's too), else the hardest osu!standard one of the same song. The sets' difficulties
// are asked of osu! once; the hardest of each is kept on the phone (also for offline).

import { get, writable } from 'svelte/store';
import { fetchBeatmapset } from './shims/data';
import { userSettings, updateUserSettings } from './shims/user';
import { offline } from '../lib/stores/network';
import type { MapSet } from '../lib/types';

type Beatmap = {
	id: number;
	version?: string;
	mode?: string;
	difficulty_rating?: number;
	total_length?: number;
};

const sets = new Map<string, Promise<Beatmap[]>>();

/** A set's difficulties (asked of osu! once) */
export function setDifficulties(setId: string | number): Promise<Beatmap[]> {
	const id = String(setId);
	if (!sets.has(id))
		sets.set(
			id,
			fetchBeatmapset(id)
				.then((set) => (set.beatmaps ?? []) as Beatmap[])
				.catch((error) => {
					sets.delete(id);
					throw error;
				})
		);
	return sets.get(id)!;
}

/** The difficulties of the song itself (a set can have several songs, told apart by length) */
export function sameSong(song: MapSet, all: Beatmap[]) {
	const own = String(song.beatmaps?.[0]?.id ?? '');
	const length = Number(song.beatmaps?.[0]?.total_length) || 0;
	return all.filter(
		(map) =>
			String(map.id) === own ||
			!length ||
			!map.total_length ||
			Math.abs(map.total_length - length) <= 3
	);
}

/** The hardest osu!standard one (as the desktop app picks) */
function hardestOf(maps: Beatmap[]) {
	const standard = maps.filter((map) => map.mode === 'osu' || map.mode == null);
	let hardest: Beatmap | null = null;
	for (const map of standard.length ? standard : maps)
		if (!hardest || (map.difficulty_rating ?? 0) > (hardest.difficulty_rating ?? 0)) hardest = map;
	return hardest ? String(hardest.id) : null;
}

const KEY = 'stosufy-web-hardest';
/** The hardest difficulty of the sets known, by set */
export const hardest = writable<Record<string, string>>(
	(() => {
		try {
			return JSON.parse(localStorage.getItem(KEY) || '{}');
		} catch {
			return {};
		}
	})()
);
hardest.subscribe((all) => {
	try {
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {
		// (asked again next time)
	}
});

/** The difficulty whose hitsounds play: the chosen one, else the hardest, else the song's own */
export function hitsoundMapId(song: MapSet | null | undefined) {
	if (!song) return '';
	const set = String(song.id);
	const chosen = get(userSettings).settings?.gameplayDifficulty?.[set];
	return String(chosen ?? get(hardest)[set] ?? song.beatmaps?.[0]?.id ?? '');
}

/** Finds the hardest difficulty of the song's set if it isn't known yet (at most `wait` ms) */
export async function learnHardest(song: MapSet | null | undefined, wait = 2000) {
	if (!song || !(Number(song.id) > 0) || get(offline)) return;
	const set = String(song.id);
	if (get(userSettings).settings?.gameplayDifficulty?.[set] || get(hardest)[set]) return;
	const found = setDifficulties(set).then((all) => {
		const id = hardestOf(sameSong(song, all));
		if (id)
			hardest.update((known) => {
				const next = { ...known, [set]: id };
				// (the oldest go: a few thousand sets at most)
				const keys = Object.keys(next);
				for (const old of keys.slice(0, Math.max(0, keys.length - 3000))) delete next[old];
				return next;
			});
	});
	await Promise.race([found.catch(() => {}), new Promise((done) => setTimeout(done, wait))]);
}

/** Chooses the difficulty whose hitsounds play for a song's set (the hardest: no choice) */
export function chooseDifficulty(song: MapSet, mapId: string) {
	const set = String(song.id);
	const all = { ...get(userSettings).settings?.gameplayDifficulty };
	if (get(hardest)[set] === String(mapId)) delete all[set];
	else all[set] = String(mapId);
	updateUserSettings({ gameplayDifficulty: all });
}
