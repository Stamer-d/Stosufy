// Sorting the songs of a playlist (or the downloaded songs)

import type { MapSet } from './types';

export type SongSort = 'custom' | 'recent' | 'title' | 'artist' | 'bpm' | 'length' | 'stars';

export function sortOptions(downloaded: boolean): { value: SongSort; label: string }[] {
	return [
		{ value: 'custom', label: downloaded ? 'Oldest first' : 'Custom order' },
		{ value: 'recent', label: 'Recently added' },
		{ value: 'title', label: 'Title' },
		{ value: 'artist', label: 'Artist' },
		{ value: 'bpm', label: 'BPM' },
		{ value: 'length', label: 'Length' },
		{ value: 'stars', label: 'Difficulty' }
	];
}

const addedAt = (song: MapSet) =>
	new Date(song.songInfo?.created_at ?? song.created_at ?? 0).getTime();
const longest = (song: MapSet) =>
	Math.max(0, ...(song.beatmaps ?? []).map((m) => m.total_length ?? 0));
const hardest = (song: MapSet) =>
	Math.max(0, ...(song.beatmaps ?? []).map((m) => m.difficulty_rating ?? 0));
const text = (value: string | undefined) => (value ?? '').toLocaleLowerCase();

/** The songs in the chosen order; 'custom' keeps the playlist's own order */
export function sortSongs(songs: MapSet[], sort: SongSort): MapSet[] {
	const sorted = [...songs];
	switch (sort) {
		case 'recent':
			return sorted.sort((a, b) => addedAt(b) - addedAt(a));
		case 'title':
			return sorted.sort((a, b) => text(a.title).localeCompare(text(b.title)));
		case 'artist':
			return sorted.sort(
				(a, b) =>
					text(a.artist).localeCompare(text(b.artist)) || text(a.title).localeCompare(text(b.title))
			);
		case 'bpm':
			return sorted.sort((a, b) => (b.bpm ?? 0) - (a.bpm ?? 0));
		case 'length':
			return sorted.sort((a, b) => longest(b) - longest(a));
		case 'stars':
			return sorted.sort((a, b) => hardest(b) - hardest(a));
		default:
			return sorted;
	}
}
