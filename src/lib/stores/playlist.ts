import { sameSong, trackOf } from '../tracks';
import { showToast } from './toast';
import { fetch } from '@tauri-apps/plugin-http';
import { get, writable } from 'svelte/store';
import { keyStore } from './auth';
import { formatSongData, mapDataStore } from './data';
import * as api from '../api';
import type { MapSet, Playlist, PlaylistId } from '../types';

export const playlists = writable<Playlist[]>([]);

export const playlistSongsCache = writable<Record<string, { songs: MapSet[] }>>({});
export const playlistLoadingStatus = writable<Record<string, boolean>>({});

const token = () => get(keyStore).access_token;

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

	const songInfo = await api.addSongToPlaylist(
		token(),
		Number(playlistId),
		Number(setId),
		Number(mapId)
	);

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
	await api.removeSongFromPlaylist(token(), Number(playlistId), songId);
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
	try {
		await api.moveSongInPlaylist(token(), Number(playlistId), moved.songInfo.id, target);
	} catch (error) {
		console.error('Could not move the song:', error);
		showToast("Couldn't save the new order", 'icon-[mingcute--warning-line]');
		await getPlaylistSongs(playlistId, true);
	}
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

		const beatmapRequests = mapIdChunks.map((chunk) =>
			fetch(`https://osu.ppy.sh/api/v2/beatmaps?ids[]=${chunk.join('&ids[]=')}`, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${get(keyStore).access_token}`,
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
		enhancedSongs.forEach((song) => {
			if (!song.beatmap || !song.beatmap.beatmapset) return;

			const beatmapsetId = song.beatmap.beatmapset.id;
			// Sets with several songs: each song of the set is its own entry
			const stored = downloaded[beatmapsetId];
			const track = trackOf(stored, song.beatmap.id);
			const key = `${beatmapsetId}:${track}`;
			const local = stored?.beatmaps?.[song.beatmap.id];

			if (!beatmapsetGroups[key]) {
				beatmapsetGroups[key] = {
					...song.beatmap.beatmapset,
					...(track ? { title: local?.title, artist: local?.artist, track } : {}),
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
