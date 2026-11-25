// What Claude changed on the server (Stosufy's connector on the user's phone or claude.ai, which
// works while the apps are closed): the server tells the open apps over Stosufy Connect
// (command "refresh"), and they load the playlists, likes or settings again. Both apps use it.

import { get } from 'svelte/store';
import * as api from '../api';
import { keyStore } from './auth';
import { onConnectCommand } from './connect';
import { LIKED_ID, loadFavourites } from './favourites';
import { getPlaylistSongs, loadSavedPlaylists, playlists, playlistSongsCache } from './playlist';
import { pullSettings } from './settingsSync';

/** Loads the user's own playlists again, and the songs of those already shown */
async function reloadPlaylists() {
	const token = get(keyStore).access_token;
	if (!token) return;
	const own = await api.getPlaylists(token);
	const ids = new Set(own.map((p) => String(p.id)));
	playlists.update((all) => [...all.filter((p) => Number(p.id) <= 0), ...own]);
	const cached = Object.keys(get(playlistSongsCache)).filter((id) => Number(id) > 0);
	// (a deleted one is forgotten, the others load their songs again)
	playlistSongsCache.update((cache) =>
		Object.fromEntries(Object.entries(cache).filter(([id]) => Number(id) <= 0 || ids.has(id)))
	);
	await Promise.all(
		cached.filter((id) => ids.has(id)).map((id) => getPlaylistSongs(id, true).catch(() => null))
	);
	await loadSavedPlaylists().catch(() => {});
}

async function reloadFavourites() {
	await loadFavourites();
	if (get(playlistSongsCache)[LIKED_ID]) await getPlaylistSongs(LIKED_ID, true);
}

let listening = false;

/** Listens for the server's word that something changed (once) */
export function followClaudeChanges() {
	if (listening) return;
	listening = true;
	onConnectCommand('refresh', async (data: { what?: string[] }) => {
		const what = new Set(data?.what ?? ['playlists', 'favourites', 'settings']);
		await Promise.all([
			what.has('playlists') && reloadPlaylists(),
			what.has('favourites') && reloadFavourites(),
			what.has('settings') && pullSettings()
		]);
	});
}
