// A song's links (the mirror's audio, osu!'s preview and covers) and what's kept of it:
// shared by the player and the downloads

import type { MapSet } from '../lib/types';

const MIRROR = 'https://catboy.best';

export const streamUrl = (song: MapSet) => `${MIRROR}/preview/audio/${song.beatmaps?.[0]?.id}/full`;
export const previewUrl = (song: MapSet) => `https://b.ppy.sh/preview/${song.id}.mp3`;
export const coverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/list@2x.jpg`;
export const bigCoverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/card@2x.jpg`;

/** A song's key among the downloads: the difficulty it's of */
export const keyOf = (song: MapSet) => String(song.beatmaps?.[0]?.id ?? song.id);

/** Only what the player needs of a song (kept in localStorage) */
export function slim(song: MapSet): MapSet {
	const map = song.beatmaps?.[0];
	return {
		id: song.id,
		title: song.title,
		artist: song.artist,
		creator: song.creator,
		track: song.track,
		beatmaps: map ? [{ id: map.id, total_length: map.total_length, version: map.version }] : []
	} as MapSet;
}
