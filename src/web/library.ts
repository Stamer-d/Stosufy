// The user's playlists and liked songs, loaded once after the login (from the Stosufy API,
// like the desktop app). The list of playlists is kept for a start without a connection;
// their songs are kept by the shared playlist store.

import { get, writable } from 'svelte/store';
import { playlists, getPlaylists, loadSavedPlaylists } from '../lib/stores/playlist';
import { favourites, loadFavourites, LIKED_ID } from '../lib/stores/favourites';
import type { MapSet, Playlist } from '../lib/types';

const KEY = 'stosufy-web-playlists';

export const libraryState = writable<{ loading: boolean; error: string }>({
	loading: false,
	error: ''
});
/** The menu of a song (the ⋯ of a row): which song, and the playlist it's in */
export const songMenu = writable<{ song: MapSet; playlistId?: string | number } | null>(null);

const liked = (count: number): Playlist =>
	({ id: LIKED_ID, title: 'Liked Songs', song_amount: count }) as Playlist;

if (typeof localStorage !== 'undefined') {
	try {
		const kept = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		if (kept.length) playlists.set(kept);
	} catch {
		// (loaded in a moment)
	}
}
playlists.subscribe((list) => {
	try {
		if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
	} catch {
		// (full: it's loaded again next time)
	}
});
// (the liked songs' count follows the likes)
favourites.subscribe((list) =>
	playlists.update((all) =>
		all.map((p) => (p.id == LIKED_ID ? { ...p, song_amount: list.length } : p))
	)
);

let loadedFor = '';
export async function loadLibrary(token: string, again = false) {
	if (!token || (loadedFor === token && !again)) return;
	loadedFor = token;
	libraryState.set({ loading: true, error: '' });
	try {
		const [own] = await Promise.all([getPlaylists(token), loadFavourites().catch(() => {})]);
		playlists.set([liked(get(favourites).length), ...own]);
		loadSavedPlaylists().catch(() => {});
		libraryState.set({ loading: false, error: '' });
	} catch (e) {
		loadedFor = '';
		libraryState.set({ loading: false, error: e instanceof Error ? e.message : String(e) });
	}
}

/** The playlists songs can be added to (the user's own) */
export const ownPlaylists = (list: Playlist[]) => list.filter((p) => Number(p.id) > 0);
