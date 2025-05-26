import { fetch } from '@tauri-apps/plugin-http';
import { get, writable } from 'svelte/store';
import { keyStore } from './auth';
import { formatSongData, mapDataStore } from './data';
export const playlists = writable([]);
export const playlistSongsCache = writable({});
export const playlistLoadingStatus = writable({});

export async function getPlaylists(code) {
	const response = await fetch('https://api.stamer-d.de/stosufy/playlist/', {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${code}`
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	return data;
}

export async function createPlaylist(title) {
	const response = await fetch('https://api.stamer-d.de/stosufy/playlist/create', {
		method: 'POST',
		body: JSON.stringify({
			title: title
		}),
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${get(keyStore).access_token}`
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	return data;
}

export async function deletePlaylist(id) {
	const response = await fetch('https://api.stamer-d.de/stosufy/playlist/delete', {
		method: 'POST',
		body: JSON.stringify({
			id: id
		}),
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${get(keyStore).access_token}`
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	return data;
}

export async function editPlaylist(id, title, description, isPublic, imageFile = null) {
	const formData = new FormData();

	formData.append('id', id.toString());
	formData.append('title', title);
	formData.append('description', description);
	formData.append('public', isPublic.toString());

	if (imageFile) {
		formData.append('image', imageFile);
	}

	const response = await fetch('https://api.stamer-d.de/stosufy/playlist/edit', {
		method: 'POST',
		body: formData,
		headers: {
			Authorization: `Bearer ${get(keyStore).access_token}`
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	return data;
}

export async function addSongToPlaylist(playlistId, mapSetData) {
	const setId = mapSetData.id;
	const mapId = mapSetData.beatmaps[0].id;
	const response = await fetch(`https://api.stamer-d.de/stosufy/playlist/${playlistId}/addsong`, {
		method: 'POST',
		body: JSON.stringify({
			set_id: setId,
			map_id: mapId
		}),
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${get(keyStore).access_token}`
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}
		const newSong = {
			...mapSetData,
			songInfo: data.song_data,
			created_at: new Date().toISOString()
		};
		const updatedSongs = [newSong, ...cache[playlistId].songs];
		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});
	return data;
}

export async function removeSongFromPlaylist(playlistId, songId) {
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
	const response = await fetch(
		`https://api.stamer-d.de/stosufy/playlist/${playlistId}/removesong`,
		{
			method: 'POST',
			body: JSON.stringify({
				song_id: songId
			}),
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${get(keyStore).access_token}`
			}
		}
	);

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	return data;
}

export async function getPlaylistSongs(playlistId, forceRefresh = false) {
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

		const response = await fetch(`https://api.stamer-d.de/stosufy/playlist/${playlistId}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${get(keyStore).access_token}`
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const playlistSongs = await response.json();

		if (!playlistSongs || playlistSongs.length === 0 || playlistSongs[0].id === null) {
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

		let allBeatmaps = [];
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

		const beatmapsetGroups = {};

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

		structuredSongs.sort((a, b) => {
			return new Date(b.songInfo.created_at) - new Date(a.songInfo.created_at);
		});

		playlistSongsCache.update((cache) => ({
			...cache,
			[playlistId]: { songs: structuredSongs }
		}));
		return { songs: structuredSongs };
	} catch (error) {
		console.error(`Error loading playlist ${playlistId}:`, error);
		return { songs: [], error: error.message };
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

export function clearPlaylistCache(playlistId) {
	playlistSongsCache.update((cache) => {
		const newCache = { ...cache };
		delete newCache[playlistId];
		return newCache;
	});
}
