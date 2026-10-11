// Favourite songs ("Liked Songs"): kept by the Stamer API, so they follow the user to every
// device. They show as a playlist of their own (id -2) next to the downloaded songs.

import { derived, get, writable } from 'svelte/store';
import * as api from '../api';
import { keyStore } from './auth';
import { mapDataStore } from './data';
import { playlists, playlistSongsCache } from './playlist';
import { showToast } from './toast';
import { trackOf } from '../tracks';
import type { MapSet, Playlist } from '../types';

export const LIKED_ID = -2;

export interface Favourite {
	setId: number;
	mapId: number;
	createdAt: string | null;
}

export const favourites = writable<Favourite[]>([]);

/** The "Liked Songs" playlist as the library lists it */
export function likedPlaylist(count: number): Playlist {
	return {
		id: LIKED_ID,
		title: 'Liked Songs',
		description: 'The songs you liked',
		image_url: null,
		song_amount: count,
		created_at: null,
		updated_at: null,
		public: false
	};
}

const token = () => get(keyStore).access_token;

/** Whether a favourite is this song (the same set, and the same song of sets with several) */
function matches(favourite: Favourite, song: MapSet) {
	if (favourite.setId != song.id) return false;
	return trackOf(get(mapDataStore)[song.id], favourite.mapId) === (song.track ?? 0);
}

/** Whether a song is liked: $isFavourite(song) */
export const isFavourite = derived(
	favourites,
	(list) => (song: MapSet | null | undefined) => !!song && list.some((f) => matches(f, song))
);

export async function loadFavourites() {
	const list = await api.getFavourites(token());
	favourites.set(
		list.map((song) => ({
			setId: Number(song.set_id),
			mapId: Number(song.map_id),
			createdAt: song.created_at ?? null
		}))
	);
}

function updateCount() {
	const count = get(favourites).length;
	playlists.update((list) =>
		list.map((p) => (p.id == LIKED_ID ? { ...p, song_amount: count } : p))
	);
}

/** Likes a song, or unlikes it */
export async function toggleFavourite(song: MapSet) {
	const mapId = Number(song.beatmaps?.[0]?.id);
	const setId = Number(song.id);
	if (!(setId > 0) || !(mapId > 0)) return;
	const liked = get(favourites).some((f) => matches(f, song));
	const before = get(favourites);
	const cacheBefore = get(playlistSongsCache)[LIKED_ID];

	// Right away, then saved
	if (liked) {
		favourites.set(before.filter((f) => !matches(f, song)));
		playlistSongsCache.update((cache) =>
			cache[LIKED_ID]
				? {
						...cache,
						[LIKED_ID]: {
							songs: cache[LIKED_ID].songs.filter(
								(s) => !(s.id == song.id && (s.track ?? 0) == (song.track ?? 0))
							)
						}
					}
				: cache
		);
	} else {
		const createdAt = new Date().toISOString();
		favourites.set([{ setId, mapId, createdAt }, ...before]);
		playlistSongsCache.update((cache) =>
			cache[LIKED_ID]
				? {
						...cache,
						[LIKED_ID]: {
							songs: [
								{
									...song,
									created_at: createdAt,
									songInfo: {
										id: null,
										set_id: setId,
										map_id: mapId,
										position: -Date.now(),
										created_at: createdAt
									}
								},
								...cache[LIKED_ID].songs
							]
						}
					}
				: cache
		);
	}
	updateCount();
	showToast(
		liked ? `Removed "${song.title}" from Liked Songs` : `Added "${song.title}" to Liked Songs`,
		liked ? 'icon-[mingcute--heart-line]' : 'icon-[mingcute--heart-fill]'
	);

	try {
		await api.setFavourite(token(), setId, mapId, !liked);
	} catch (error) {
		console.error('Could not save the like:', error);
		favourites.set(before);
		playlistSongsCache.update((cache) =>
			cacheBefore ? { ...cache, [LIKED_ID]: cacheBefore } : cache
		);
		updateCount();
		showToast("Couldn't save that, try again", 'icon-[mingcute--warning-line]');
	}
}
