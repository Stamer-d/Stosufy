// Beatmap sets can contain more than one song: difficulties with their own audio file (and
// often their own title and background). Each distinct audio file is a "track", shown and
// played as its own song.

import type { Beatmap, MapSet, StoredMapSet } from './types';

/** The beatmaps of a set grouped by audio file, in the order of the beatmaps */
export function trackGroups(set: StoredMapSet): Beatmap[][] {
	const groups = new Map<string, Beatmap[]>();
	for (const beatmap of Object.values(set.beatmaps ?? {})) {
		const key = beatmap.audioFile?.toLowerCase() ?? '';
		groups.set(key, [...(groups.get(key) ?? []), beatmap]);
	}
	return [...groups.values()];
}

/** Which track of a downloaded set a beatmap belongs to; 0 when unknown */
export function trackOf(set: StoredMapSet | undefined, mapId: number | string | undefined) {
	if (!set || mapId == null) return 0;
	const index = trackGroups(set).findIndex((group) => group.some((map) => map.id == mapId));
	return Math.max(index, 0);
}

/** A downloaded set as songs: one per track, with the track's own title and artist */
export function splitTracks(set: StoredMapSet): MapSet[] {
	const groups = trackGroups(set);
	if (groups.length <= 1) return [{ ...set, beatmaps: groups[0] ?? [] }];
	return groups.map((beatmaps, track) => ({
		...set,
		title: beatmaps[0].title || set.title,
		artist: beatmaps[0].artist || set.artist,
		beatmaps,
		track
	}));
}

/** Whether two songs are the same track of the same set */
export function sameSong(a: MapSet | null | undefined, b: MapSet | null | undefined) {
	return !!a && !!b && a.id == b.id && (a.track ?? 0) == (b.track ?? 0);
}

/** A unique key for a song in lists, also for the songs of a set with several */
export function songKey(song: MapSet) {
	return `${song.id}:${song.track ?? 0}`;
}

/** The artists of a song: collaborations ("feat.", "vs.", "×") count for each of them */
export function artistsOf(artist: string) {
	return artist
		.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|×)\s+/i)
		.map((name) => name.trim())
		.filter(Boolean);
}

/** How long songs last together, like "1 h 5 min" (empty without their lengths) */
export function songsLength(songs: MapSet[]) {
	const seconds = songs.reduce(
		(sum, song) => sum + (Number(song.beatmaps?.[0]?.total_length) || 0),
		0
	);
	if (!seconds) return '';
	const minutes = Math.max(1, Math.round(seconds / 60));
	const hours = Math.floor(minutes / 60);
	return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * The song itself, whoever mapped it: osu! has many sets of the same song (a TV size, a cut,
 * a sped up one), they all have the same name here
 */
export function songName(song: { title?: string; artist?: string }) {
	const normal = (text: string | undefined) => (text ?? '').toLowerCase().trim();
	const title = normal(song.title);
	const bare = title.replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '').trim() || title;
	return `${normal(artistsOf(song.artist ?? '')[0])}|${bare.replace(/\s+/g, ' ')}`;
}
