import { writable } from 'svelte/store';

/** What's typed into the search bar in the title bar */
export const searchQuery = writable('');

/** Downloaded songs matching every word of the query (title, artist, mapper, tags, difficulty) */
export function matchesQuery(
	song: {
		title?: string;
		artist?: string;
		creator?: string;
		tags?: string;
		genre?: string | null;
		language?: string | null;
		songSource?: string;
		beatmaps?: { version?: string }[];
	},
	query: string
) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return false;
	const text = [
		song.title,
		song.artist,
		song.creator,
		song.tags,
		song.genre,
		song.language,
		song.songSource,
		...(song.beatmaps ?? []).map((map) => map.version)
	]
		.join(' ')
		.toLowerCase();
	return words.every((word) => text.includes(word));
}
