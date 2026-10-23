// Radio: a queue of songs from the library that are similar to a song (or a few), and
// autoplay, which keeps playing similar songs when a queue ends.
//
// Songs are alike when they share an artist (collaborations count for each), come from the
// same anime or game, have the same mapper, genre or language, a tempo that fits (half and
// double time too) or tags. The listening history adds the user's taste: songs played a lot
// and liked ones come more often, often skipped ones less, and what was heard a moment ago
// waits. The order flows: tempos close to each other, never the same artist twice in a row.

import { get } from 'svelte/store';
import { formatSongData, mapDataStore } from './data';
import { favourites } from './favourites';
import { history, playCounts, songKey, type SongPlays } from './history';
import { songBpm } from '../dj/library';
import { artistsOf, sameSong } from '../tracks';
import type { MapSet } from '../types';

const RADIO_LENGTH = 40;
/** How many of the most similar songs the order is picked from */
const POOL = 120;
/** With fewer songs left, the radio gets more */
export const RADIO_TOP_UP = 5;

const normalized = (text: string | null | undefined) => (text ?? '').toLowerCase().trim();

interface Features {
	artists: Set<string>;
	creator: string;
	genre: string;
	language: string;
	source: string;
	/** BPM from the beatmap's timing (null: unknown) */
	tempo: number | null;
	tags: Set<string>;
}

// (osu!'s "Unspecified" and "Other" say nothing)
const known = (value: string | null | undefined) => {
	const text = normalized(value);
	return /^(unspecified|other|any)$/.test(text) ? '' : text;
};

const featureCache = new WeakMap<MapSet, Features>();
function featuresOf(song: MapSet): Features {
	let features = featureCache.get(song);
	if (!features) {
		const tempo = songBpm(song, get(mapDataStore)) || song.bpm || null;
		features = {
			artists: new Set(artistsOf(song.artist ?? '').map(normalized)),
			creator: normalized(song.creator),
			genre: known(song.genre),
			language: known(song.language),
			source: normalized(song.songSource),
			tempo,
			tags: new Set(
				normalized(song.tags)
					.split(/\s+/)
					.filter((tag) => tag.length > 2)
			)
		};
		featureCache.set(song, features);
	}
	return features;
}

/** How far apart two tempos are (0: the same), half and double time counting as the same */
function tempoDistance(a: number | null, b: number | null) {
	if (!a || !b) return null;
	const ratio = Math.abs(Math.log2(b / a));
	return Math.min(ratio, Math.abs(ratio - 1));
}

const sharesAny = <T>(a: Set<T>, b: Set<T>) => [...a].some((value) => b.has(value));

/** How alike two songs are (higher: more) */
function similarity(a: Features, b: Features) {
	let score = 0;
	if (sharesAny(a.artists, b.artists)) score += 5;
	if (a.source && a.source === b.source) score += 4;
	if (a.creator && a.creator === b.creator) score += 2;
	if (a.genre && b.genre) score += a.genre === b.genre ? 1.5 : -1;
	if (a.language && b.language) score += a.language === b.language ? 1 : -0.8;
	const tempo = tempoDistance(a.tempo, b.tempo);
	if (tempo != null) {
		// (in octaves: 0.04 is about 3 %)
		if (tempo < 0.04) score += 2;
		else if (tempo < 0.1) score += 1;
		else if (tempo > 0.26) score -= 0.5;
	}
	let shared = 0;
	for (const tag of b.tags) if (a.tags.has(tag)) shared++;
	score += Math.min(shared, 4) * 0.5;
	return score;
}

const HOUR = 3600;

/** What the user's history and likes say about a song (around 0: nothing) */
function taste(song: MapSet, plays: Map<string, SongPlays>, liked: Set<string>, now: number) {
	let score = liked.has(songKey(song)) ? 1.5 : 0;
	const entry = plays.get(songKey(song));
	if (!entry) return score;
	score += Math.min(Math.log2(1 + entry.plays), 3) * 0.5;
	// Skipped again and again: hardly ever (it would take a lot of alike to make up for it)
	const heard = entry.plays + entry.skips;
	if (heard >= 2) score -= (entry.skips / heard) * (heard >= 4 ? 6 : 4);
	const ago = now - entry.last;
	if (ago < HOUR) score -= 4;
	else if (ago < 6 * HOUR) score -= 1.5;
	else if (ago < 24 * HOUR) score -= 0.5;
	return score;
}

/** How well a song follows another: a tempo close to it, the same genre */
function flow(previous: Features | null, next: Features) {
	if (!previous) return 0;
	let score = 0;
	const tempo = tempoDistance(previous.tempo, next.tempo);
	if (tempo != null && tempo < 0.07) score += 1;
	if (previous.genre && previous.genre === next.genre) score += 0.5;
	return score;
}

/**
 * Songs of the library for a radio from `seeds` (the first one leads, the others count less),
 * without the excluded ones, in an order that flows from the last seed on
 */
export function radioSongs(seeds: MapSet[], exclude: MapSet[] = []): MapSet[] {
	if (!seeds.length) return [];
	const seedFeatures = seeds.map(featuresOf);
	const weights = seeds.map((_, i) => (i === 0 ? 1 : 0.6));
	const total = weights.reduce((sum, w) => sum + w, 0);
	const plays = playCounts(get(history).plays);
	const liked = new Set(get(favourites).map((f) => songKey(librarySongById(f.setId, f.mapId))));
	const now = Date.now() / 1000;
	const skipped = [...seeds, ...exclude];

	const pool = formatSongData(get(mapDataStore))
		.filter((song) => !skipped.some((other) => sameSong(other, song)))
		.map((song) => {
			const features = featuresOf(song);
			const alike =
				seedFeatures.reduce((sum, seed, i) => sum + weights[i] * similarity(seed, features), 0) /
				total;
			return { song, features, score: alike + taste(song, plays, liked, now) };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, POOL);

	// One after another: the best next song, a little at random so a radio isn't always the same
	const order: MapSet[] = [];
	const artistCount = new Map<string, number>();
	let previous = seedFeatures.at(-1) ?? null;
	while (order.length < RADIO_LENGTH && pool.length) {
		let best = 0;
		let bestScore = -Infinity;
		pool.forEach(({ features, score }, i) => {
			let value = score + flow(previous, features) + Math.random() * 1.2;
			if (previous && sharesAny(previous.artists, features.artists)) value -= 3;
			for (const artist of features.artists) value -= (artistCount.get(artist) ?? 0) * 1;
			if (value > bestScore) {
				bestScore = value;
				best = i;
			}
		});
		const [next] = pool.splice(best, 1);
		order.push(next.song);
		for (const artist of next.features.artists)
			artistCount.set(artist, (artistCount.get(artist) ?? 0) + 1);
		previous = next.features;
	}
	return order;
}

/** The most similar downloaded songs, without the seed and the excluded ones */
export function similarSongs(seed: MapSet, exclude: MapSet[] = []): MapSet[] {
	return radioSongs([seed], exclude);
}

/**
 * A song of the radio was skipped right away: the songs like it (its artist, its anime or
 * game, its mapper) go to the end of what's still to come
 */
export function afterSkip(upcoming: MapSet[], skipped: MapSet): MapSet[] {
	const gone = featuresOf(skipped);
	const unlike = (song: MapSet) => {
		const features = featuresOf(song);
		let penalty = 0;
		if (sharesAny(gone.artists, features.artists)) penalty += 3;
		if (gone.source && gone.source === features.source) penalty += 2;
		if (gone.creator && gone.creator === features.creator) penalty += 1;
		if (gone.genre && gone.genre === features.genre) penalty += 0.5;
		return penalty < 2.5;
	};
	return [...upcoming.filter(unlike), ...upcoming.filter((song) => !unlike(song))];
}

/** The library's song of a set and difficulty (for liked songs, which are kept by those) */
function librarySongById(setId: number | string, mapId: number | string): MapSet {
	const set = get(mapDataStore)[setId];
	const songs = set ? formatSongData({ [setId]: set }) : [];
	const song = songs.find((s) => s.beatmaps?.some((map) => map.id == mapId)) ?? songs[0];
	return song ?? ({ id: setId, beatmaps: [] } as MapSet);
}

/** The library's entry for a song (e.g. from the beatmap search), to play it in full */
export function librarySong(song: MapSet): MapSet | null {
	const library = formatSongData(get(mapDataStore));
	return (
		library.find((entry) => sameSong(entry, song)) ??
		library.find((entry) => entry.id == song.id) ??
		null
	);
}
