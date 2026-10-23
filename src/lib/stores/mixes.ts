// Made for you: the songs heard last, the daily mixes and the forgotten favourites, from the
// listening history and the library.
//
// The daily mixes are made once a day, each around a theme the user listens to a lot (a
// genre, an anime or game, an artist): their favourite songs of it and the radio's songs
// like them. They stay the same all day (made with a random generator seeded by the day),
// so a mix doesn't change while it plays. Without a history yet, the liked songs and the
// library itself choose the themes.

import { derived, get, writable } from 'svelte/store';
import { counts, history, historyLoaded, songKey, type Play } from './history';
import { formatSongData, mapDataStore } from './data';
import { favourites } from './favourites';
import { radioSongs } from './radio';
import { artistsOf } from '../tracks';
import type { MapSet } from '../types';

export interface Mix {
	id: string;
	title: string;
	description: string;
	songs: MapSet[];
}

/** A mix as it's kept for the day: the songs by key */
interface PlannedMix {
	id: string;
	title: string;
	description: string;
	keys: string[];
}

const DAY = 86400;
const STORAGE_KEY = 'stosufy-daily-mixes';
const MIX_LENGTH = 30;
const THEMES = 3;
/** A theme needs this many songs in the library */
const THEME_SONGS = 8;
/** Plays this old count half (s) */
const HALF_LIFE = 21 * DAY;
/** Played this often, then not for this long: a forgotten favourite */
const FORGOTTEN_PLAYS = 3;
const FORGOTTEN_AFTER = 30 * DAY;

const today = () => {
	const now = new Date();
	return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
};

/** Random numbers from a seed: the same seed, the same numbers (mulberry32) */
export function seededRandom(seed: string) {
	let state = 0;
	for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const libraryByKey = (library: MapSet[]) => new Map(library.map((song) => [songKey(song), song]));

const normalized = (text: string | null | undefined) => (text ?? '').trim().toLowerCase();
const says = (text: string | null | undefined) =>
	!!text && !/^(unspecified|other|any)$/i.test(text.trim());

// --- Recently played -------------------------------------------------------------------

/** The songs of the library heard last (each once, the last first) */
export const recentlyPlayed = derived([history, mapDataStore], ([$history, $data]) => {
	const byKey = libraryByKey(formatSongData($data));
	const songs: MapSet[] = [];
	const seen = new Set<string>();
	for (let i = $history.plays.length - 1; i >= 0 && songs.length < 12; i--) {
		const [key, , heard, length] = $history.plays[i];
		if (seen.has(key) || !counts(heard, length)) continue;
		seen.add(key);
		const song = byKey.get(key);
		if (song) songs.push(song);
	}
	return songs;
});

// --- Forgotten favourites ----------------------------------------------------------------

/** Songs played a lot (or liked) that haven't been heard for a month */
export const forgottenFavourites = derived(
	[history, mapDataStore, favourites],
	([$history, $data, $favourites]): Mix | null => {
		const now = Date.now() / 1000;
		const since = $history.plays[0]?.[1];
		// Without a month of history, nothing is forgotten yet
		if (!since || now - since < FORGOTTEN_AFTER) return null;
		const library = formatSongData($data);
		const byKey = libraryByKey(library);
		const stats = new Map<string, { plays: number; last: number }>();
		for (const [key, at, heard, length] of $history.plays) {
			const entry = stats.get(key) ?? { plays: 0, last: 0 };
			if (counts(heard, length)) entry.plays++;
			entry.last = Math.max(entry.last, at);
			stats.set(key, entry);
		}
		const liked = new Set(
			$favourites.map((f) => {
				const song = library.find(
					(s) => s.id == f.setId && s.beatmaps?.some((map) => map.id == f.mapId)
				);
				return song ? songKey(song) : `${f.setId}:0`;
			})
		);
		const forgotten = [...byKey.keys()]
			.map((key) => ({ key, ...(stats.get(key) ?? { plays: 0, last: 0 }) }))
			.filter(
				({ key, plays, last }) =>
					now - last > FORGOTTEN_AFTER && (plays >= FORGOTTEN_PLAYS || liked.has(key))
			)
			.sort((a, b) => b.plays - a.plays || a.last - b.last)
			.slice(0, 50)
			.map(({ key }) => byKey.get(key)!);
		if (forgotten.length < 5) return null;
		return {
			id: 'forgotten',
			title: 'Forgotten favourites',
			description: 'Songs you loved and haven’t heard for a while',
			songs: forgotten
		};
	}
);

// --- Daily mixes ---------------------------------------------------------------------------

interface Theme {
	key: string;
	label: string;
	test: (song: MapSet) => boolean;
	weight: number;
	/** The songs of it the user likes most, by key */
	seeds: Map<string, number>;
}

/** The themes a song belongs to */
function themesOf(song: MapSet): Omit<Theme, 'weight' | 'seeds'>[] {
	const themes: Omit<Theme, 'weight' | 'seeds'>[] = [];
	if (says(song.songSource)) {
		const source = normalized(song.songSource);
		themes.push({
			key: `source:${source}`,
			label: song.songSource!.trim(),
			test: (s) => normalized(s.songSource) === source
		});
	}
	if (says(song.genre)) {
		const genre = normalized(song.genre);
		themes.push({
			key: `genre:${genre}`,
			label: song.genre!.trim(),
			test: (s) => normalized(s.genre) === genre
		});
	}
	for (const artist of artistsOf(song.artist ?? '')) {
		const name = normalized(artist);
		themes.push({
			key: `artist:${name}`,
			label: artist,
			test: (s) => artistsOf(s.artist ?? '').some((a) => normalized(a) === name)
		});
	}
	return themes;
}

/** What the user listens to (the last plays count most), else what they like and have */
function weights(plays: Play[], library: MapSet[], liked: Set<string>) {
	const now = Date.now() / 1000;
	const songWeights = new Map<string, number>();
	for (const [key, at, heard, length] of plays) {
		if (!counts(heard, length)) continue;
		const weight = Math.pow(0.5, Math.max(0, now - at) / HALF_LIFE);
		songWeights.set(key, (songWeights.get(key) ?? 0) + weight);
	}
	const heardAny = songWeights.size > 0;
	for (const song of library) {
		const key = songKey(song);
		// Liked songs count too; without a history yet, a little for every song (the themes
		// the library is full of)
		const base = liked.has(key) ? (heardAny ? 0.5 : 1) : heardAny ? 0 : 0.05;
		if (base) songWeights.set(key, (songWeights.get(key) ?? 0) + base);
	}
	return songWeights;
}

/** A theme's favourite songs (by key), the most liked first */
const topSeeds = (theme: Theme) =>
	[...theme.seeds]
		.filter(([, weight]) => weight > 0)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)
		.map(([key]) => key);

/** The items in a random order (every order as likely) */
function shuffled<T>(items: T[], random: () => number) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

function pickThemes(library: MapSet[], songWeights: Map<string, number>) {
	const themes = new Map<string, Theme>();
	for (const song of library) {
		const weight = songWeights.get(songKey(song)) ?? 0;
		for (const theme of themesOf(song)) {
			const entry = themes.get(theme.key) ?? { ...theme, weight: 0, seeds: new Map() };
			entry.weight += weight;
			entry.seeds.set(songKey(song), weight);
			themes.set(theme.key, entry);
		}
	}
	const chosen: { theme: Theme; top: Set<string> }[] = [];
	const sorted = [...themes.values()].sort((a, b) => b.weight - a.weight);
	for (const theme of sorted) {
		if (chosen.length >= THEMES) break;
		if (theme.seeds.size < THEME_SONGS) continue;
		const top = new Set(topSeeds(theme));
		// Not led by (mostly) the same favourites as a mix before it
		const overlaps = chosen.some(({ top: other }) => {
			let shared = 0;
			for (const key of top) if (other.has(key)) shared++;
			return shared / top.size > 0.5;
		});
		if (!overlaps) chosen.push({ theme, top });
	}
	return chosen.map(({ theme }) => theme);
}

/** The artists a mix is mostly made of, for its description */
function artistsIn(songs: MapSet[]) {
	const count = new Map<string, number>();
	for (const song of songs)
		for (const artist of artistsOf(song.artist ?? ''))
			count.set(artist, (count.get(artist) ?? 0) + 1);
	return [...count]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([artist]) => artist);
}

/** Today's mixes */
export function planMixes(plays: Play[], library: MapSet[], liked: Set<string>, day: string) {
	if (!library.length) return [];
	const byKey = libraryByKey(library);
	const songWeights = weights(plays, library, liked);
	const mixes: PlannedMix[] = [];

	pickThemes(library, songWeights).forEach((theme, i) => {
		const random = seededRandom(`${day}:${theme.key}`);
		// Their favourites of the theme lead, a few at random from the top ones
		const top = topSeeds(theme)
			.map((key) => byKey.get(key)!)
			.filter(Boolean);
		const seeds = shuffled(top, random).slice(0, 4);
		const radio = radioSongs(seeds, [], {
			length: MIX_LENGTH - seeds.length,
			random,
			only: theme.test
		});
		// A favourite every few songs
		const songs = [...radio];
		seeds.forEach((seed, n) => songs.splice(Math.min(n * 7, songs.length), 0, seed));
		const artists = artistsIn(songs).filter((a) => normalized(a) !== normalized(theme.label));
		mixes.push({
			id: `daily-${i + 1}`,
			title: `Daily Mix ${i + 1}`,
			description: [theme.label, ...artists].slice(0, 3).join(', ') + ' and more',
			keys: songs.map(songKey)
		});
	});

	// Songs of the library not heard yet, like the ones heard most
	const heard = new Set(plays.map(([key]) => key));
	if (heard.size) {
		const favouriteSongs = [...songWeights]
			.filter(([key]) => heard.has(key))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([key]) => byKey.get(key)!)
			.filter(Boolean);
		const fresh = radioSongs(favouriteSongs, favouriteSongs, {
			length: 25,
			random: seededRandom(`${day}:fresh`),
			only: (song) => !heard.has(songKey(song))
		});
		if (fresh.length >= 5) {
			mixes.push({
				id: 'fresh',
				title: 'Fresh finds',
				description: 'Songs from your library you haven’t heard yet',
				keys: fresh.map(songKey)
			});
		}
	}
	return mixes;
}

function readPlan(): { day: string; mixes: PlannedMix[] } | null {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
	} catch {
		return null;
	}
}

const plan = writable<{ day: string; mixes: PlannedMix[] } | null>(
	typeof window !== 'undefined' ? readPlan() : null
);

/** Today's mixes, with the songs of the library they're made of */
export const dailyMixes = derived([plan, mapDataStore], ([$plan, $data]) => {
	if (!$plan) return [] as Mix[];
	const byKey = libraryByKey(formatSongData($data));
	return $plan.mixes
		.map(({ keys, ...mix }) => ({
			...mix,
			songs: keys.map((key) => byKey.get(key)).filter((song): song is MapSet => !!song)
		}))
		.filter((mix) => mix.songs.length >= 5);
});

/** Makes today's mixes, unless they're made already */
async function refreshMixes() {
	const day = today();
	if (get(plan)?.day === day) return;
	await historyLoaded();
	const library = formatSongData(get(mapDataStore));
	if (!library.length) return;
	const liked = new Set(
		get(favourites).map((f) => {
			const song = library.find(
				(s) => s.id == f.setId && s.beatmaps?.some((map) => map.id == f.mapId)
			);
			return song ? songKey(song) : `${f.setId}:0`;
		})
	);
	const mixes = planMixes(get(history).plays, library, liked, day);
	const next = { day, mixes };
	plan.set(next);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// (made again next time)
	}
}

/** Every mix by its id (for the mix page) */
export const allMixes = derived(
	[dailyMixes, forgottenFavourites],
	([$daily, $forgotten]) =>
		new Map([...$daily, ...($forgotten ? [$forgotten] : [])].map((m) => [m.id, m]))
);

if (typeof window !== 'undefined') {
	// Once the library is there, and again when the day changes
	let waiting: ReturnType<typeof setTimeout> | null = null;
	mapDataStore.subscribe((data) => {
		if (waiting || !Object.keys(data ?? {}).length) return;
		waiting = setTimeout(() => {
			waiting = null;
			refreshMixes();
		}, 2000);
	});
	setInterval(refreshMixes, 15 * 60 * 1000);
}
