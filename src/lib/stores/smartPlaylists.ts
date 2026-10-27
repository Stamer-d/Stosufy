// Smart playlists: the user puts in a few songs, autofill adds the songs like them, from the
// library and (if they want) from osu!, songs they don't have yet too (those stream or
// download when they play). They're kept in the settings, so they follow the user to every
// device; a song is kept with just enough to show and play it without the library.

import { derived, get, writable } from 'svelte/store';
import { userSettings, updateUserSettings } from './user';
import { fetchMaps, formatSongData, mapDataStore } from './data';
import { offline } from './network';
import { fitTo } from './radio';
import { artistsOf, songKey } from '../tracks';
import { GENRES, LANGUAGES } from '../genres';
import type { MapSet } from '../types';

/** A song of a smart playlist */
export interface SmartSong {
	/** The beatmap set, its difficulty that plays, and which song of a set with several */
	id: number | string;
	mapId: number | string;
	track?: number;
	title: string;
	artist: string;
	creator?: string;
	/** Its length (s) */
	length?: number;
	// What makes songs alike, kept with the songs the user put in (autofill asks about them)
	genre?: string | null;
	language?: string | null;
	songSource?: string;
	tags?: string;
	bpm?: number;
}

export interface SmartPlaylist {
	id: string;
	title: string;
	/** The songs the user put in: autofill looks for songs like them */
	seeds: SmartSong[];
	/** What autofill added */
	filled: SmartSong[];
	/** Songs taken out (by key): autofill doesn't bring them back */
	removed: string[];
	/** Autofill also brings songs from osu! that aren't downloaded */
	online: boolean;
	/** Autofill fills it up to this many songs */
	size: number;
}

export const SIZES = [25, 50, 100];

/** A smart playlist as saved, also one from before (made by rules: it starts out empty) */
function normalize(playlist: Partial<SmartPlaylist> & { id: string }): SmartPlaylist {
	return {
		id: playlist.id,
		title: playlist.title || 'Smart playlist',
		seeds: playlist.seeds ?? [],
		filled: playlist.filled ?? [],
		removed: playlist.removed ?? [],
		online: playlist.online ?? true,
		size: playlist.size ?? 50
	};
}

/** The user's smart playlists */
export const smartPlaylists = derived(userSettings, ($settings) =>
	(($settings.settings?.smartPlaylists ?? []) as SmartPlaylist[]).map(normalize)
);

function save(list: SmartPlaylist[]) {
	updateUserSettings({ smartPlaylists: list });
}

// --- Songs ---------------------------------------------------------------------------------

/** A song as a smart playlist keeps it (`details`: also what makes songs alike) */
export function toSmartSong(song: MapSet, details = false): SmartSong {
	const map = song.beatmaps?.[0];
	const kept: SmartSong = {
		id: song.id,
		mapId: map?.id ?? song.id,
		title: song.title ?? '',
		artist: song.artist ?? ''
	};
	if (song.track) kept.track = song.track;
	if (song.creator) kept.creator = song.creator;
	if (map?.total_length) kept.length = Math.round(Number(map.total_length));
	if (details) {
		// (a song straight from osu!'s search has them its own way)
		const name = (value: any, names: Record<number, string>, id: number) =>
			typeof value === 'string' ? value : (value?.name ?? names[id] ?? null);
		kept.genre = name(song.genre, GENRES, song.genre_id);
		kept.language = name(song.language, LANGUAGES, song.language_id);
		const from = song.songSource ?? (song.source !== 'osu' ? song.source : '');
		if (from) kept.songSource = from;
		// (the first tags are enough, the settings shouldn't grow much)
		if (song.tags) kept.tags = song.tags.split(/\s+/).slice(0, 20).join(' ');
		if (song.bpm) kept.bpm = song.bpm;
	}
	return kept;
}

const keyOf = (song: { id: number | string; track?: number }) => `${song.id}:${song.track ?? 0}`;

/** A kept song to play: the library's if it's downloaded, else what was kept of it */
function resolve(song: SmartSong, library: Map<string, MapSet>): MapSet {
	const own = library.get(keyOf(song)) ?? (song.track ? null : library.get(`${song.id}:0`));
	if (own) return own;
	return {
		id: song.id,
		title: song.title,
		artist: song.artist,
		creator: song.creator,
		track: song.track,
		genre: song.genre,
		language: song.language,
		songSource: song.songSource,
		tags: song.tags,
		bpm: song.bpm,
		preview_url: `//b.ppy.sh/preview/${song.id}.mp3`,
		beatmaps: [{ id: song.mapId, total_length: song.length }]
	};
}

const libraryByKey = () =>
	new Map(formatSongData(get(mapDataStore)).map((song) => [songKey(song), song]));

/** The songs of a smart playlist: the ones put in first, then what autofill added */
export function smartSongs(playlist: SmartPlaylist): MapSet[] {
	const library = libraryByKey();
	return [...playlist.seeds, ...playlist.filled].map((song) => resolve(song, library));
}

/** Whether a song is one the user put in (else autofill added it) */
export const isSeed = (playlist: SmartPlaylist, song: MapSet) =>
	playlist.seeds.some((seed) => keyOf(seed) === songKey(song));

// --- Editing -------------------------------------------------------------------------------

/** Makes a new smart playlist (from a song, if given); returns it */
export function createSmartPlaylist(from?: MapSet): SmartPlaylist {
	const playlist = normalize({
		id: Math.random().toString(36).slice(2, 10),
		title: from ? `Like ${from.title}` : 'New smart playlist',
		seeds: from ? [toSmartSong(from, true)] : []
	});
	save([...get(smartPlaylists), playlist]);
	return playlist;
}

export function updateSmartPlaylist(id: string, change: Partial<SmartPlaylist>) {
	save(get(smartPlaylists).map((p) => (p.id === id ? { ...p, ...change } : p)));
}

export function deleteSmartPlaylist(id: string) {
	save(get(smartPlaylists).filter((p) => p.id !== id));
}

const find = (id: string) => get(smartPlaylists).find((p) => p.id === id);

/** Puts a song in (one autofill added becomes one put in); false if it was in already */
export function addSeed(id: string, song: MapSet) {
	const playlist = find(id);
	const key = songKey(song);
	if (!playlist || playlist.seeds.some((seed) => keyOf(seed) === key)) return false;
	// (the library knows more about a downloaded song)
	const own = libraryByKey().get(key) ?? song;
	updateSmartPlaylist(id, {
		seeds: [...playlist.seeds, toSmartSong(own, true)],
		filled: playlist.filled.filter((other) => keyOf(other) !== key),
		removed: playlist.removed.filter((other) => other !== key)
	});
	return true;
}

/** Takes a song out; one autofill added it doesn't bring back */
export function removeSong(id: string, song: MapSet) {
	const playlist = find(id);
	if (!playlist) return;
	const key = songKey(song);
	const wasFilled = playlist.filled.some((other) => keyOf(other) === key);
	updateSmartPlaylist(id, {
		seeds: playlist.seeds.filter((other) => keyOf(other) !== key),
		filled: playlist.filled.filter((other) => keyOf(other) !== key),
		removed: wasFilled ? [...playlist.removed, key].slice(-300) : playlist.removed
	});
}

// --- Autofill ------------------------------------------------------------------------------

/** The smart playlists autofill is filling right now (by id) */
export const filling = writable<Record<string, boolean>>({});

/** Songs this little like the ones put in aren't added (unless there's nothing better) */
const ALIKE = 2;
const SOMEWHAT = 0.5;
/** At most this much of what autofill adds comes from osu!, while the library has songs */
const ONLINE_SHARE = 0.6;
/** How much more a downloaded song counts than one from osu! as alike */
const OWN = 1;
/** How many artists and anime/games of the songs put in are looked for on osu! */
const ARTIST_SEARCHES = 6;
const SOURCE_SEARCHES = 4;

const normalized = (text: string | null | undefined) => (text ?? '').toLowerCase().trim();

/**
 * The song itself, whoever mapped it: osu! has many sets of the same song (a TV size, a cut,
 * a sped up one), only one of them should come
 */
function sameSongName(song: MapSet) {
	const title = normalized(song.title);
	const bare = title.replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '').trim() || title;
	return `${normalized(artistsOf(song.artist ?? '')[0])}|${bare.replace(/\s+/g, ' ')}`;
}

/** A beatmap set of osu!'s search as a song (its osu! difficulty plays) */
export function songFromSearch(set: any): MapSet {
	const maps = [...(set.beatmaps ?? [])].sort(
		(a, b) => Number(b.mode === 'osu') - Number(a.mode === 'osu')
	);
	return {
		id: set.id,
		title: set.title,
		artist: set.artist,
		creator: set.creator,
		user_id: set.user_id,
		status: set.status,
		tags: set.tags ?? '',
		bpm: set.bpm,
		genre: set.genre?.name ?? GENRES[set.genre_id] ?? null,
		language: set.language?.name ?? LANGUAGES[set.language_id] ?? null,
		songSource: set.source ?? '',
		preview_url: set.preview_url,
		play_count: set.play_count ?? 0,
		beatmaps: maps
	};
}

const mostCommon = (values: (string | null | undefined)[]) => {
	const count = new Map<string, number>();
	for (const value of values) if (value) count.set(value, (count.get(value) ?? 0) + 1);
	return [...count].sort((a, b) => b[1] - a[1]).map(([value]) => value);
};
const idOf = (names: Record<number, string>, name: string | undefined) =>
	Object.entries(names).find(([, other]) => other === name)?.[0] ?? '';

/** Songs on osu! like the ones put in: their artists, anime and games, genre and language */
async function searchOnline(seeds: MapSet[]): Promise<MapSet[]> {
	const quote = (text: string) => `"${text.replace(/"/g, '')}"`;
	const artists = mostCommon(seeds.map((seed) => artistsOf(seed.artist ?? '')[0]));
	const sources = mostCommon(seeds.map((seed) => seed.songSource?.trim()));
	const genre = mostCommon(seeds.map((seed) => seed.genre)).find((g) => g !== 'Other');
	const language = mostCommon(seeds.map((seed) => seed.language)).find((l) => l !== 'Other');
	const searches = [
		...artists.slice(0, ARTIST_SEARCHES).map((artist) => ({ q: `artist=${quote(artist)}` })),
		...sources.slice(0, SOURCE_SEARCHES).map((source) => ({ q: `source=${quote(source)}` })),
		// The most played of the genre and language, for the rest
		...(genre || language
			? [{ q: '', genre: idOf(GENRES, genre), language: idOf(LANGUAGES, language) }]
			: [])
	];
	const found: MapSet[] = [];
	// A few at a time: osu! shouldn't be asked for all at once
	for (let i = 0; i < searches.length; i += 3) {
		const results = await Promise.all(
			searches.slice(i, i + 3).map(({ q, ...filters }) =>
				fetchMaps(q, '', { status: '', sort: 'plays_desc', ...filters })
					.then((result) => (result?.beatmapsets ?? []) as any[])
					.catch(() => [])
			)
		);
		for (const sets of results) found.push(...sets.map(songFromSearch));
	}
	return found;
}

interface Candidate {
	song: MapSet;
	online: boolean;
	score: number;
	alike: number;
}

/**
 * Fills a smart playlist up with songs like the ones put in: from the library, and from
 * osu! if it may. What it added before is replaced (the songs taken out don't come back).
 * Returns how many songs it added.
 */
export async function autofill(id: string): Promise<number> {
	const start = find(id);
	if (!start || !start.seeds.length || get(filling)[id]) return 0;
	filling.update((all) => ({ ...all, [id]: true }));
	try {
		const library = libraryByKey();
		const seeds = start.seeds.map((seed) => resolve(seed, library));
		const fit = fitTo(seeds);
		const removed = new Set(start.removed);
		const taken = new Set([...seeds.map(songKey), ...removed]);
		// The same song in another set counts as taken too
		const takenNames = new Set(seeds.map(sameSongName));

		const candidates: Candidate[] = [];
		for (const song of library.values()) {
			if (taken.has(songKey(song))) continue;
			const { alike, taste } = fit(song);
			// (a bit more for the user's own: they chose to download it)
			candidates.push({ song, online: false, alike, score: alike + taste + OWN });
		}
		if (start.online && !get(offline)) {
			const downloaded = get(mapDataStore);
			const downloadedNames = new Set([...library.values()].map(sameSongName));
			const seen = new Set<string>();
			for (const song of await searchOnline(seeds)) {
				const name = sameSongName(song);
				if (downloaded[song.id] || taken.has(songKey(song))) continue;
				if (downloadedNames.has(name) || seen.has(name)) continue;
				seen.add(name);
				const { alike } = fit(song);
				// (a bit more for what many play: a stranger's song should be a good one)
				const plays = Number(song.play_count) || 0;
				const popular = Math.max(0, Math.min(1.5, (Math.log10(plays + 1) - 4) * 0.75));
				candidates.push({ song, online: true, alike, score: alike + popular });
			}
		}

		const wanted = Math.max(0, start.size - seeds.length);
		const picked = pick(candidates, wanted, takenNames);
		// The playlist may have changed while osu! was asked: only what autofill adds is replaced
		const now = find(id);
		if (!now) return 0;
		const nowTaken = new Set([...now.seeds.map(keyOf), ...now.removed]);
		const filled = picked
			.filter((song) => !nowTaken.has(songKey(song)))
			.map((song) => toSmartSong(song));
		updateSmartPlaylist(id, { filled });
		return filled.length;
	} finally {
		filling.update((all) => ({ ...all, [id]: false }));
	}
}

/**
 * The best `wanted` candidates: the most alike first, not one artist again and again, not
 * the same song twice, and not only osu!'s while the library has songs that fit
 */
function pick(candidates: Candidate[], wanted: number, takenNames: Set<string>): MapSet[] {
	const sorted = candidates.sort((a, b) => b.score - a.score);
	// Alike ones; with too few, the somewhat alike ones too
	let pool = sorted.filter((c) => c.alike >= ALIKE);
	if (pool.length < wanted) pool = sorted.filter((c) => c.alike >= SOMEWHAT);
	pool = pool.slice(0, Math.max(300, wanted * 3));

	const onlineCap = Math.ceil(wanted * ONLINE_SHARE);
	const picked: MapSet[] = [];
	const names = new Set(takenNames);
	const artistCount = new Map<string, number>();
	let online = 0;
	while (picked.length < wanted && pool.length) {
		const libraryLeft = pool.some((c) => !c.online);
		let best = -1;
		let bestValue = -Infinity;
		pool.forEach((candidate, i) => {
			if (candidate.online && online >= onlineCap && libraryLeft) return;
			let value = candidate.score;
			for (const artist of artistsOf(candidate.song.artist ?? ''))
				value -= (artistCount.get(normalized(artist)) ?? 0) * 0.7;
			if (value > bestValue) {
				bestValue = value;
				best = i;
			}
		});
		if (best < 0) break;
		const [next] = pool.splice(best, 1);
		const name = sameSongName(next.song);
		if (names.has(name)) continue;
		names.add(name);
		picked.push(next.song);
		if (next.online) online++;
		for (const artist of artistsOf(next.song.artist ?? ''))
			artistCount.set(normalized(artist), (artistCount.get(normalized(artist)) ?? 0) + 1);
	}
	return picked;
}
