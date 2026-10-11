// Radio: a queue of songs from the library that are similar to a song, and autoplay, which
// keeps playing similar songs when a queue ends.

import { get } from 'svelte/store';
import { formatSongData, mapDataStore } from './data';
import { sameSong } from '../tracks';
import type { MapSet } from '../types';

const RADIO_LENGTH = 40;

const normalized = (text: string | undefined) => (text ?? '').toLowerCase().trim();
const tagsOf = (song: MapSet) =>
	new Set(
		normalized(song.tags)
			.split(/\s+/)
			.filter((tag) => tag.length > 2)
	);

/** How similar a song is to the seed: same artist, same mapper, close BPM, shared tags */
function similarity(seed: MapSet, song: MapSet, seedTags: Set<string>) {
	let score = 0;
	if (normalized(seed.artist) && normalized(seed.artist) === normalized(song.artist)) score += 5;
	if (normalized(seed.creator) && normalized(seed.creator) === normalized(song.creator)) score += 3;
	if (seed.bpm && song.bpm) {
		const difference = Math.abs(song.bpm - seed.bpm) / seed.bpm;
		if (difference < 0.04) score += 2.5;
		else if (difference < 0.1) score += 1.2;
	}
	let shared = 0;
	for (const tag of tagsOf(song)) if (seedTags.has(tag)) shared++;
	score += Math.min(shared, 4) * 0.6;
	// A little randomness, so a radio doesn't always play the same songs in the same order
	return score + Math.random() * 1.5;
}

/** The most similar downloaded songs, without the seed and the excluded ones */
export function similarSongs(seed: MapSet, exclude: MapSet[] = []): MapSet[] {
	const seedTags = tagsOf(seed);
	return formatSongData(get(mapDataStore))
		.filter((song) => !sameSong(song, seed) && !exclude.some((other) => sameSong(other, song)))
		.map((song) => ({ song, score: similarity(seed, song, seedTags) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, RADIO_LENGTH)
		.map(({ song }) => song);
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
