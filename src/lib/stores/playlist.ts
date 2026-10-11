import { sameSong, trackOf } from '../tracks';
import { showToast } from './toast';
import { fetch } from '@tauri-apps/plugin-http';
import { get, writable } from 'svelte/store';
import { keyStore, freshToken } from './auth';
import { formatSongData, mapDataStore } from './data';
import * as api from '../api';
import type { MapSet, Playlist, PlaylistId } from '../types';

export const playlists = writable<Playlist[]>([]);

export const playlistSongsCache = writable<Record<string, { songs: MapSet[] }>>({});
export const playlistLoadingStatus = writable<Record<string, boolean>>({});

const token = () => get(keyStore).access_token;

// --- Changes to a playlist: one after another, tried again, and checked with the server ----

const queues = new Map<string, Promise<unknown>>();
const pending = new Map<string, number>();
const RETRIES = 3;

/** Errors trying again won't fix */
const final = (error: unknown) =>
	/not found|already in playlist|not owned/i.test(error instanceof Error ? error.message : '');

/**
 * Runs a change of a playlist after the ones before it (quick clicks stay in order), tries
 * it again if the connection hiccups, and once the playlist's changes are done, takes its
 * songs and count from the server, so what's shown is what's saved
 */
function change<T>(playlistId: PlaylistId, run: () => Promise<T>, what: string): Promise<T | null> {
	const key = String(playlistId);
	pending.set(key, (pending.get(key) ?? 0) + 1);
	const job = (queues.get(key) ?? Promise.resolve()).then(async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await run();
			} catch (error) {
				if (final(error) || attempt >= RETRIES - 1) {
					console.error(`Could not ${what}:`, error);
					showToast(
						`Couldn't ${what}. The playlist shows what's saved.`,
						'icon-[mingcute--warning-line]'
					);
					failed.add(key);
					return null;
				}
				await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
			}
		}
	});
	queues.set(
		key,
		job.catch(() => null)
	);
	job.finally(() => {
		const left = (pending.get(key) ?? 1) - 1;
		pending.set(key, left);
		if (left === 0) {
			queues.delete(key);
			refreshFromServer(playlistId);
		}
	});
	return job;
}

const failed = new Set<string>();

/** After changes: the playlist's count (and after a failure its songs) from the server */
async function refreshFromServer(playlistId: PlaylistId) {
	const key = String(playlistId);
	try {
		const saved = (await api.getPlaylists(token())).find((p) => p.id == playlistId);
		if (saved) {
			playlists.update((list) =>
				list.map((p) => (p.id == playlistId ? { ...p, song_amount: saved.song_amount } : p))
			);
		}
		if (failed.delete(key)) await getPlaylistSongs(playlistId, true);
	} catch (error) {
		console.warn('Could not check the playlist with the server:', error);
	}
}

export async function getPlaylists(accessToken: string): Promise<Playlist[]> {
	return api.getPlaylists(accessToken);
}

export async function createPlaylist(title: string): Promise<Playlist> {
	return api.createPlaylist(token(), title);
}

export async function deletePlaylist(id: PlaylistId) {
	await api.deletePlaylist(token(), Number(id));
}

export async function editPlaylist(
	id: PlaylistId,
	title: string,
	description: string,
	isPublic: boolean,
	imageFile: File | null = null
): Promise<Playlist> {
	return api.editPlaylist(
		token(),
		{ id: Number(id), title, description, public: isPublic },
		imageFile
	);
}

export async function addSongToPlaylist(playlistId: PlaylistId, mapSetData: MapSet) {
	const setId = mapSetData.id;
	const mapId = mapSetData.beatmaps[0].id;

	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}
		const newSong = {
			...mapSetData,
			songInfo: {
				id: null,
				set_id: setId,
				map_id: mapId,
				created_at: new Date().toISOString()
			},
			created_at: new Date().toISOString()
		};
		let updatedSongs = [...cache[playlistId].songs, newSong];
		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});

	const songInfo = await change(
		playlistId,
		() => api.addSongToPlaylist(token(), Number(playlistId), Number(setId), Number(mapId)),
		`add "${mapSetData.title}" to the playlist`
	);
	if (!songInfo) return null;

	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}

		const updatedSongs = cache[playlistId].songs.map((song, index) => {
			if (index === cache[playlistId].songs.length - 1 && sameSong(song, mapSetData)) {
				return {
					...song,
					songInfo
				};
			}
			return song;
		});

		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});

	return songInfo;
}

export async function removeSongFromPlaylist(playlistId: PlaylistId, songId: number) {
	const updatedPlaylists = get(playlists).map((p) => {
		if (p.id == playlistId) {
			return { ...p, song_amount: Math.max(0, p.song_amount - 1) };
		}
		return p;
	});

	playlists.set(updatedPlaylists);
	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}

		const updatedSongs = cache[playlistId].songs.filter((song) => song.songInfo?.id !== songId);

		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});
	await change(
		playlistId,
		() => api.removeSongFromPlaylist(token(), Number(playlistId), songId),
		'remove the song'
	);
}

/** Moves the song at index `from` of a playlist to index `to` (drag and drop) */
export async function moveSongInPlaylist(playlistId: PlaylistId, from: number, to: number) {
	const songs = get(playlistSongsCache)[playlistId]?.songs;
	if (!songs || from === to || !songs[from] || !songs[to]) return;
	const moved = songs[from];
	const target = songs[to].songInfo.position;
	// Show the new order right away; the songs keep the positions of their new places
	const positions = songs.map((song) => song.songInfo.position);
	const reordered = [...songs];
	reordered.splice(to, 0, ...reordered.splice(from, 1));
	playlistSongsCache.update((cache) => ({
		...cache,
		[playlistId]: {
			songs: reordered.map((song, i) => ({
				...song,
				songInfo: { ...song.songInfo, position: positions[i] }
			}))
		}
	}));
	await change(
		playlistId,
		() => api.moveSongInPlaylist(token(), Number(playlistId), moved.songInfo.id, target),
		'save the new order'
	);
}

export async function getPlaylistSongs(
	playlistId: PlaylistId,
	forceRefresh = false
): Promise<{ songs: MapSet[]; error?: string }> {
	if (!forceRefresh && get(playlistSongsCache)[playlistId]) {
		return get(playlistSongsCache)[playlistId];
	}
	playlistLoadingStatus.update((status) => ({
		...status,
		[playlistId]: true
	}));

	try {
		if (playlistId == -1) {
			const songs = formatSongData(get(mapDataStore));

			playlistSongsCache.update((cache) => ({
				...cache,
				[playlistId]: { songs }
			}));

			return { songs };
		}

		// Liked Songs (-2): the favourites, newest first
		const playlistSongs =
			playlistId == -2
				? (await api.getFavourites(token())).map((song, index) => ({ ...song, position: index }))
				: await api.getPlaylistSongs(token(), Number(playlistId));

		if (playlistSongs.length === 0) {
			playlistSongsCache.update((cache) => ({
				...cache,
				[playlistId]: { songs: [] }
			}));
			return { songs: [] };
		}

		const mapIds = playlistSongs.map((song) => song.map_id);

		// Process in chunks of 50
		const chunkSize = 50;
		const mapIdChunks = [];
		for (let i = 0; i < mapIds.length; i += chunkSize) {
			mapIdChunks.push(mapIds.slice(i, i + chunkSize));
		}

		const osuToken = await freshToken();
		const beatmapRequests = mapIdChunks.map((chunk) =>
			fetch(`https://osu.ppy.sh/api/v2/beatmaps?ids[]=${chunk.join('&ids[]=')}`, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${osuToken}`,
					'Content-Type': 'application/json'
				}
			})
		);

		const responses = await Promise.all(beatmapRequests);

		for (let i = 0; i < responses.length; i++) {
			if (!responses[i].ok) {
				throw new Error(`OSU API error! status: ${responses[i].status} for chunk ${i + 1}`);
			}
		}

		const responseDataPromises = responses.map((res) => res.json());
		const responseData = await Promise.all(responseDataPromises);

		let allBeatmaps: any[] = [];
		for (const data of responseData) {
			if (data.beatmaps) {
				allBeatmaps = [...allBeatmaps, ...data.beatmaps];
			}
		}

		const enhancedSongs = playlistSongs.map((song) => {
			const beatmap = allBeatmaps.find((bm) => bm.id?.toString() === song.map_id?.toString());

			return {
				id: song.id,
				set_id: song.set_id,
				map_id: song.map_id,
				position: song.position,
				created_at: song.created_at,
				updated_at: song.updated_at,
				beatmap: beatmap || null
			};
		});

		const beatmapsetGroups: Record<string, MapSet> = {};

		const downloaded = get(mapDataStore);
		// Sets that are in the playlist with several of their difficulties (sets with several
		// songs): not downloaded, each is its own song, named with its difficulty
		const mapsOfSet = new Map<string, Set<string>>();
		for (const song of enhancedSongs) {
			const setId = String(song.beatmap?.beatmapset?.id ?? '');
			if (!setId || downloaded[setId]) continue;
			mapsOfSet.set(setId, (mapsOfSet.get(setId) ?? new Set()).add(String(song.beatmap.id)));
		}
		enhancedSongs.forEach((song) => {
			if (!song.beatmap || !song.beatmap.beatmapset) return;

			const beatmapsetId = song.beatmap.beatmapset.id;
			// Sets with several songs: each song of the set is its own entry
			const stored = downloaded[beatmapsetId];
			const several = [...(mapsOfSet.get(String(beatmapsetId)) ?? [])];
			const guessed = several.length > 1 ? several.indexOf(String(song.beatmap.id)) : -1;
			const track = stored ? trackOf(stored, song.beatmap.id) : Math.max(0, guessed);
			const key = `${beatmapsetId}:${track}`;
			const local = stored?.beatmaps?.[song.beatmap.id];
			const named = stored
				? track
					? { title: local?.title, artist: local?.artist, track }
					: {}
				: guessed >= 0
					? {
							title: `${song.beatmap.beatmapset.title} (${song.beatmap.version})`,
							track
						}
					: {};

			if (!beatmapsetGroups[key]) {
				beatmapsetGroups[key] = {
					...song.beatmap.beatmapset,
					...named,
					songInfo: { ...song },
					beatmaps: [],
					// Store the position for sorting
					position: song.position
				};
			}
			beatmapsetGroups[key].beatmaps.push({
				...song.beatmap
			});
		});

		const structuredSongs = Object.values(beatmapsetGroups);

		// The playlist's own order (positions can be changed by dragging songs)
		structuredSongs.sort((a, b) => (a.songInfo.position ?? 0) - (b.songInfo.position ?? 0));

		playlistSongsCache.update((cache) => ({
			...cache,
			[playlistId]: { songs: structuredSongs }
		}));
		return { songs: structuredSongs };
	} catch (error) {
		console.error(`Error loading playlist ${playlistId}:`, error);
		return { songs: [], error: error instanceof Error ? error.message : String(error) };
	} finally {
		playlistLoadingStatus.update((status) => ({
			...status,
			[playlistId]: false
		}));
	}
}

export async function loadAllPlaylistSongs() {
	const allPlaylists = get(playlists);

	const concurrencyLimit = 3;
	const playlistIds = allPlaylists.map((playlist) => playlist.id);

	for (let i = 0; i < playlistIds.length; i += concurrencyLimit) {
		const batch = playlistIds.slice(i, i + concurrencyLimit);
		await Promise.all(batch.map((id) => getPlaylistSongs(id)));
	}

	return true;
}

// --- Public playlists of others -------------------------------------------------------------

/** Public playlists of others the user saved to their library */
export const savedPlaylists = writable<Playlist[]>([]);

export async function loadSavedPlaylists() {
	savedPlaylists.set(await api.getSavedPlaylists(token()));
}

/** Playlists of others opened (not in the library), by id */
export const otherPlaylists = writable<Record<string, Playlist>>({});

/** A playlist that's not the user's own: from the saved ones, else from the API */
export async function loadOtherPlaylist(id: PlaylistId) {
	const known = get(savedPlaylists).find((p) => p.id == id) ?? get(otherPlaylists)[id];
	if (known) return known;
	const playlist = await api.getPlaylist(token(), Number(id));
	otherPlaylists.update((all) => ({ ...all, [id]: playlist }));
	return playlist;
}

/**
 * Loads a public playlist of someone else again (its details and songs), so changes its
 * owner made show up right away
 */
export async function refreshOtherPlaylist(id: PlaylistId) {
	const [playlist] = await Promise.all([
		api.getPlaylist(token(), Number(id)).catch(() => null),
		getPlaylistSongs(id, true)
	]);
	if (!playlist) return;
	otherPlaylists.update((all) => ({ ...all, [id]: playlist }));
	savedPlaylists.update((list) => list.map((p) => (p.id == id ? { ...p, ...playlist } : p)));
}

/** Saves a public playlist of someone else to the library, or removes it */
export async function toggleSavedPlaylist(playlist: Playlist) {
	const saved = !get(savedPlaylists).some((p) => p.id == playlist.id);
	const updated = {
		...playlist,
		saved,
		saves: Math.max(0, (playlist.saves ?? 0) + (saved ? 1 : -1))
	};
	const before = get(savedPlaylists);
	savedPlaylists.set(saved ? [updated, ...before] : before.filter((p) => p.id != playlist.id));
	otherPlaylists.update((all) => ({ ...all, [playlist.id]: updated }));
	showToast(
		saved
			? `Saved "${playlist.title}" to your library`
			: `Removed "${playlist.title}" from your library`,
		saved ? 'icon-[mingcute--bookmark-fill]' : 'icon-[mingcute--bookmark-line]'
	);
	try {
		await api.savePlaylist(token(), Number(playlist.id), saved);
	} catch (error) {
		console.error('Could not save the playlist:', error);
		savedPlaylists.set(before);
		otherPlaylists.update((all) => ({ ...all, [playlist.id]: playlist }));
		showToast("Couldn't save that, try again", 'icon-[mingcute--warning-line]');
	}
}
