// The user's playlists and liked songs, loaded once after the login (from the Stosufy API,
// like the desktop app). The list of playlists is kept for a start without a connection;
// their songs are kept by the shared playlist store.

import { get, writable } from 'svelte/store';
import {
	playlists,
	getPlaylists,
	loadSavedPlaylists,
	getPlaylistSongs,
	playlistSongsCache,
	offlineLibrary
} from '../lib/stores/playlist';
import { autoDownload, downloadAll } from './downloads';
import { offline, whenOnline } from '../lib/stores/network';
import { keyStore } from './shims/auth';
import { favourites, loadFavourites, LIKED_ID } from '../lib/stores/favourites';
import { getStosufyUser } from '../lib/api';
import { user } from './shims/user';
import type { MapSet, Playlist } from '../lib/types';

const KEY = 'stosufy-web-playlists';

export const libraryState = writable<{ loading: boolean; error: string }>({
	loading: false,
	error: ''
});
/** Who's logged in (their osu! name and picture), kept for a start without a connection */
const USER_KEY = 'stosufy-web-user';
export const webUser = writable<{ username?: string; avatar_url?: string } | null>(
	typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem(USER_KEY) ?? 'null')
);
webUser.subscribe((user) => {
	try {
		if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
	} catch {
		// (asked again next time)
	}
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
		const [own] = await Promise.all([
			getPlaylists(token),
			loadFavourites().catch(() => {}),
			getStosufyUser(token)
				.then((profile) => {
					webUser.set(profile);
					// (the desktop app's stores know the user by it: the settings sync starts)
					user.set(profile);
				})
				.catch(() => {})
		]);
		playlists.set([liked(get(favourites).length), ...own]);
		loadSavedPlaylists().catch(() => {});
		libraryState.set({ loading: false, error: '' });
		keepDownloaded();
		showKeptSongs();
	} catch (e) {
		loadedFor = '';
		libraryState.set({ loading: false, error: e instanceof Error ? e.message : String(e) });
	}
}

/** The playlists songs can be added to (the user's own) */
export const ownPlaylists = (list: Playlist[]) => list.filter((p) => Number(p.id) > 0);

/** The playlists kept downloaded: their new songs are downloaded, one playlist after another */
async function keepDownloaded() {
	for (const id of get(autoDownload)) {
		if (get(offline)) return;
		const { songs } = await getPlaylistSongs(id, true).catch(() => ({ songs: [] }));
		if (songs?.length) await downloadAll(songs).catch(() => {});
	}
}

/** The playlists' songs as they were last time, right away (their covers, the radio) */
async function showKeptSongs() {
	const kept = (await offlineLibrary())?.songs ?? {};
	playlistSongsCache.update((cache) => {
		const next = { ...cache };
		for (const [id, entry] of Object.entries(kept)) if (!next[id]) next[id] = entry;
		return next;
	});
}
if (typeof window !== 'undefined') showKeptSongs();

// Back online: what changed in the meantime
if (typeof window !== 'undefined') whenOnline(() => loadLibrary(get(keyStore).access_token, true));
