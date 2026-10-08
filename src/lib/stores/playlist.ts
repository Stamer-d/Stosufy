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
			if (index === cache[playlistId].songs.length - 1 && song.id === mapSetData.id) {
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

		const playlistSongs = await api.getPlaylistSongs(token(), Number(playlistId));

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

		enhancedSongs.forEach((song) => {
			if (!song.beatmap || !song.beatmap.beatmapset) return;

			const beatmapsetId = song.beatmap.beatmapset.id;

			if (!beatmapsetGroups[beatmapsetId]) {
				beatmapsetGroups[beatmapsetId] = {
					...song.beatmap.beatmapset,
					songInfo: { ...song },
					beatmaps: [],
					// Store the position for sorting
					position: song.position
				};
			}
			beatmapsetGroups[beatmapsetId].beatmaps.push({
				...song.beatmap
			});
		});

		const structuredSongs = Object.values(beatmapsetGroups);

		structuredSongs.sort(
			(a, b) =>
				new Date(a.songInfo.created_at).getTime() - new Date(b.songInfo.created_at).getTime()
		);

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
