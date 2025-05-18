import { fetch } from '@tauri-apps/plugin-http';
import { get, writable } from 'svelte/store';
import { keyStore } from './auth';
export const playlists = writable([]);

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
	// Create FormData object
	console.log(imageFile);
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

export async function addSongToPlaylist(playlistId, setId, mapId) {
	console.log('Adding song to playlist:', playlistId, setId, mapId);
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
	return data;
}

export async function removeSongFromPlaylist(playlistId, songId) {
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

export async function getPlaylistSongs(playlistId) {
	// First, get the playlist songs from your API
	const response = await fetch(`https://api.stamer-d.de/stosufy/playlist/${playlistId}`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${get(keyStore).access_token}`
		}
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	// The response is the array of songs directly
	const playlistSongs = await response.json();

	// If there are no songs, return early
	if (!playlistSongs || playlistSongs.length === 0 || playlistSongs[0].id === null) {
		return { songs: [] };
	}
	// Extract map IDs from the playlist songs
	const mapIds = playlistSongs.map((song) => song.map_id);
	// Fetch detailed beatmap information from osu API
	const osuResponse = await fetch(
		`https://osu.ppy.sh/api/v2/beatmaps?ids[]=${mapIds.join('&ids[]=')}`,
		{
			method: 'GET',
			headers: {
				Authorization: `Bearer ${get(keyStore).access_token}`,
				'Content-Type': 'application/json'
			}
		}
	);

	if (!osuResponse.ok) {
		throw new Error(`OSU API error! status: ${osuResponse.status}`);
	}

	const beatmapsResponse = await osuResponse.json();
	console.log('Beatmaps response:', beatmapsResponse);
	// The beatmaps API returns an object with a "beatmaps" property containing the array
	const beatmapsData = beatmapsResponse.beatmaps || [];

	// Combine playlist data with OSU beatmap data
	const enhancedSongs = playlistSongs.map((song) => {
		// Find corresponding beatmap data
		const beatmap = beatmapsData.find((bm) => bm.id?.toString() === song.map_id?.toString());

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

	// Return structured playlist data
	return {
		songs: enhancedSongs
	};
}
