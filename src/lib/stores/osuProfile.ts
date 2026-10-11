// Playlists from the osu! profile: favourites, most played and top plays. Creating one
// again updates it (only new songs are added).

import { get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from './auth';
import { user, userSettings, updateUserSettings } from './user';
import { playlists, createPlaylist, addSongToPlaylist, getPlaylistSongs } from './playlist';
import { queueDownloads } from './downloadQueue';
import type { MapSet } from '../types';

export type ProfileList = 'favourite' | 'most_played' | 'best';

export const PROFILE_LISTS: Record<
	ProfileList,
	{ title: string; label: string; description: string; icon: string; count: (user: any) => number }
> = {
	favourite: {
		title: 'osu! Favourites',
		label: 'Favourites',
		description: 'The beatmaps you favourited',
		icon: 'icon-[mingcute--heart-line]',
		count: (u) => u?.favourite_beatmapset_count ?? 0
	},
	most_played: {
		title: 'osu! Most played',
		label: 'Most played',
		description: 'Your 100 most played beatmaps',
		icon: 'icon-[mingcute--fire-line]',
		count: (u) => Math.min(100, u?.beatmap_playcounts_count ?? 0)
	},
	best: {
		title: 'osu! Top plays',
		label: 'Top plays',
		description: 'The beatmaps of your 100 best scores',
		icon: 'icon-[mingcute--trophy-line]',
		count: (u) => Math.min(100, u?.scores_best_count ?? 0)
	}
};

export interface ProfileImportState {
	list: ProfileList | null;
	state: 'idle' | 'loading' | 'adding' | 'done' | 'error';
	done: number;
	total: number;
	added: number;
	message?: string;
}

export const profileImport = writable<ProfileImportState>({
	list: null,
	state: 'idle',
	done: 0,
	total: 0,
	added: 0
});

const PAGE_SIZE = 100;
const MAX_FAVOURITES = 500;

async function osuApi(path: string) {
	const response = await fetch(`https://osu.ppy.sh/api/v2/${path}`, {
		headers: { Authorization: `Bearer ${get(keyStore).access_token}` }
	});
	if (!response.ok) throw new Error(`osu! API error (HTTP ${response.status})`);
	return response.json();
}

/** A set as the playlist and the downloads need it: with the chosen difficulty first */
function song(set: any, beatmap: any): MapSet {
	return {
		...set,
		beatmaps: [beatmap, ...(set.beatmaps ?? []).filter((m) => m.id !== beatmap.id)]
	};
}

/** The songs of a profile list, newest or most played first, one per beatmap set */
async function loadList(list: ProfileList): Promise<MapSet[]> {
	const me = get(user);
	const songs: MapSet[] = [];
	if (list === 'favourite') {
		for (let offset = 0; offset < MAX_FAVOURITES; offset += PAGE_SIZE) {
			const page = await osuApi(
				`users/${me.id}/beatmapsets/favourite?limit=${PAGE_SIZE}&offset=${offset}`
			);
			for (const set of page) {
				// The hardest difficulty, like osu! picks for a set
				const beatmap = [...(set.beatmaps ?? [])].sort(
					(a, b) => b.difficulty_rating - a.difficulty_rating
				)[0];
				if (beatmap) songs.push(song(set, beatmap));
			}
			if (page.length < PAGE_SIZE) break;
		}
	} else if (list === 'most_played') {
		const page = await osuApi(`users/${me.id}/beatmapsets/most_played?limit=${PAGE_SIZE}`);
		for (const entry of page) songs.push(song(entry.beatmapset, entry.beatmap));
	} else {
		const mode = me.playmode ?? 'osu';
		const page = await osuApi(`users/${me.id}/scores/best?limit=${PAGE_SIZE}&mode=${mode}`);
		for (const score of page) songs.push(song(score.beatmapset, score.beatmap));
	}
	const seen = new Set();
	return songs.filter((entry) => !seen.has(entry.id) && seen.add(entry.id));
}

/** The playlist made for a list before, if it still exists */
export function profilePlaylist(list: ProfileList) {
	const id = get(userSettings).settings?.profilePlaylists?.[list];
	return get(playlists).find((playlist) => playlist.id == id) ?? null;
}

/**
 * Creates the playlist of a profile list, or adds the new songs to the one made before,
 * and queues the songs that aren't downloaded yet if `download` is set
 */
export async function importProfileList(list: ProfileList, download: boolean) {
	const current = get(profileImport);
	if (current.state === 'loading' || current.state === 'adding') return;
	profileImport.set({ list, state: 'loading', done: 0, total: 0, added: 0 });
	try {
		const songs = await loadList(list);
		let playlist = profilePlaylist(list);
		if (!playlist) {
			playlist = await createPlaylist(PROFILE_LISTS[list].title);
			playlists.update((all) => [all[0], playlist, ...all.slice(1)]);
			updateUserSettings({
				profilePlaylists: { ...get(userSettings).settings?.profilePlaylists, [list]: playlist.id }
			});
		}
		const existing = new Set(
			(await getPlaylistSongs(playlist.id, true)).songs.map((entry) => String(entry.id))
		);
		const missing = songs.filter((entry) => !existing.has(String(entry.id)));
		profileImport.update((s) => ({ ...s, state: 'adding', total: missing.length }));
		for (const entry of missing) {
			await addSongToPlaylist(playlist.id, entry);
			profileImport.update((s) => ({ ...s, done: s.done + 1, added: s.added + 1 }));
		}
		const count = existing.size + missing.length;
		playlists.update((all) =>
			all.map((p) => (p.id == playlist.id ? { ...p, song_amount: count } : p))
		);
		if (download)
			queueDownloads(songs.map((entry) => ({ set: entry, mapId: entry.beatmaps[0].id })));
		profileImport.update((s) => ({ ...s, state: 'done' }));
	} catch (error) {
		console.error('Could not import the osu! profile list:', error);
		profileImport.update((s) => ({
			...s,
			state: 'error',
			message: error instanceof Error ? error.message : String(error)
		}));
	}
}

/** Whether the "Playlists from your osu! profile" window is open */
export const profileImportOpen = writable(false);
