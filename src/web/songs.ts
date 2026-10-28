// A song's links (the mirror's audio, osu!'s preview and covers) and what's kept of it:
// shared by the player and the downloads

import type { MapSet } from '../lib/types';

const MIRROR = 'https://catboy.best';

export const streamUrl = (song: MapSet) => `${MIRROR}/preview/audio/${song.beatmaps?.[0]?.id}/full`;
/** osu!'s 30 s preview, through the Stosufy API (osu! doesn't let pages read it, and the
 * songs' sound goes through Web Audio, which has to: see audioGraph.ts) */
export const previewUrl = (song: MapSet) => `https://api.stamer-d.de/v2/stosufy/preview/${song.id}`;
export const coverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/list@2x.jpg`;
/** The whole background (sharp on the big cover; falls back to the banner, see handleImageError) */
export const bigCoverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/fullsize.jpg`;
/** The banner (1800×500): its middle as a square is sharp enough for covers of a card */
export const mediumCoverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/cover@2x.jpg`;

/** A song's key among the downloads: the difficulty it's of */
export const keyOf = (song: MapSet) => String(song.beatmaps?.[0]?.id ?? song.id);

/** osu!'s genre and language come as text or as `{ id, name }`: the text */
const textOf = (value: unknown) =>
	(typeof value === 'object' && value ? (value as { name?: string }).name : value) as
		string | undefined;

/**
 * A song of osu!'s answers as the shared code wants it (the radio, the listening history):
 * the genre and language as text, where it's from as `songSource`
 */
export function normalized(song: MapSet): MapSet {
	const source = song.songSource ?? (song as { source?: string }).source ?? '';
	const genre = textOf(song.genre);
	const language = textOf(song.language);
	if (genre === song.genre && language === song.language && source === song.songSource) return song;
	return { ...song, genre, language, songSource: source } as MapSet;
}

/** Only what the player needs of a song (kept in localStorage) */
export function slim(original: MapSet): MapSet {
	const song = normalized(original);
	const map = song.beatmaps?.[0];
	return {
		id: song.id,
		title: song.title,
		artist: song.artist,
		creator: song.creator,
		track: song.track,
		// (for the listening history and the radio)
		genre: song.genre,
		language: song.language,
		songSource: song.songSource,
		bpm: song.bpm,
		beatmaps: map ? [{ id: map.id, total_length: map.total_length, version: map.version }] : []
	} as MapSet;
}
