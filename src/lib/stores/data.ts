import { get, writable } from 'svelte/store';
import { keyStore } from './auth';
import { fetch } from '@tauri-apps/plugin-http';
import {
	writeTextFile,
	exists,
	mkdir,
	BaseDirectory,
	create,
	readTextFile,
	writeFile,
	readFile,
	remove
} from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import JSZip from 'jszip';
import { playlists } from './playlist';
import { songQueue, stopPlayback, updateSongQueue } from './audio';

let homeDir = '';
let mapSetsDir = '';
let mapDataFile = '';
export let mapDataStore = writable({});

(async function initialize() {
	try {
		// Get required paths
		homeDir = await path.homeDir();
		mapSetsDir = await path.join(homeDir, 'Stosufy/Songs');
		mapDataFile = await path.join(mapSetsDir, 'songData.json');

		// Create directories if they don't exist
		if (!(await exists(homeDir + '/Stosufy', { baseDir: BaseDirectory.Home }))) {
			await mkdir(homeDir + '/Stosufy', { baseDir: BaseDirectory.Home });
		}

		if (!(await exists(mapSetsDir, { baseDir: BaseDirectory.Home }))) {
			await mkdir(mapSetsDir, { baseDir: BaseDirectory.Home });
		}

		// Create or load map data file
		if (!(await exists(mapDataFile, { baseDir: BaseDirectory.Home }))) {
			const file = await create(mapDataFile, { baseDir: BaseDirectory.Home });
			file.write(new TextEncoder().encode('{}'));
			file.close();
		} else {
			const mapData = JSON.parse(await readTextFile(mapDataFile, { baseDir: BaseDirectory.Home }));
			mapDataStore.set(mapData);
		}
	} catch (error) {
		console.error('Error initializing data store:', error);
	}
})();
async function saveMapData() {
	await writeTextFile(mapDataFile, JSON.stringify(get(mapDataStore)), {
		baseDir: BaseDirectory.Home
	});
}

async function getCachedAudio(setId, mapId) {
	const mapData = get(mapDataStore);
	if (!mapData[setId]) return null;

	if (
		mapData[setId].beatmaps[mapId]?.audioFile &&
		(await exists(mapData[setId].beatmaps[mapId]?.audioFile, {
			baseDir: BaseDirectory.Home
		}))
	) {
		return readFile(mapData[setId].beatmaps[mapId]?.audioFile, {
			baseDir: BaseDirectory.Home
		});
	}
	return null;
}

export async function fetchMaps(search = '', cursorString = '') {
	try {
		const response = await fetch(
			`https://osu.ppy.sh/api/v2/beatmapsets/search?e=&c=&g=&l=&m=&nsfw=&played=&r=&sort=&s=&q=${search}&cursor_string=${cursorString}`,
			{
				headers: {
					Authorization: `Bearer ${get(keyStore).access_token}`,
					Referer: 'https://osu.ppy.sh/beatmapsets',
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				}
			}
		);
		console.log('Response:', await response);
		return await response.json();
	} catch (error) {
		console.error('Error fetching maps:', error);
		throw error;
	}
}

// TODO - Adjust to remove specific beatmap songs
export async function deleteSong(setId) {
	const mapData = get(mapDataStore);

	if (!mapData[setId]?.beatmaps) return null;

	// Get current song queue state
	const queue = get(songQueue);

	// Find the index of the song in the formatted data
	const formattedSongs = formatSongData(mapData);
	const deletedIndex = formattedSongs.findIndex((song) => song.id.toString() === setId.toString());

	const beatmapIds = Object.keys(mapData[setId].beatmaps);
	if (beatmapIds.length === 0) return null;
	const firstBeatmapId = beatmapIds[0];
	const audioFilePath = mapData[setId].beatmaps[firstBeatmapId].audioFile;
	if (audioFilePath && (await exists(audioFilePath, { baseDir: BaseDirectory.Home }))) {
		await remove(audioFilePath, {
			baseDir: BaseDirectory.Home,
			recursive: true
		});
	}
	delete mapData[setId];
	mapDataStore.set(mapData);
	await saveMapData();
	playlists.update((allPlaylists) => {
		return allPlaylists.map((playlist) => {
			if (playlist.id == -1) {
				// Decrement song_amount for the "All Songs" playlist
				return {
					...playlist,
					song_amount: playlist.song_amount - 1
				};
			}
			return playlist;
		});
	});

	if (queue && queue.type === 'playlist') {
		const playlistId = queue.playlistId;
		const currentIndex = queue.currentIndex;

		if (currentIndex !== undefined) {
			const updatedSongs = formatSongData(get(mapDataStore));

			if (deletedIndex < currentIndex) {
				await updateSongQueue(currentIndex - 1, updatedSongs, 'playlist', playlistId);
			} else if (deletedIndex === currentIndex) {
				if (updatedSongs.length > 0) {
					const newIndex = Math.min(currentIndex, updatedSongs.length - 1);
					await updateSongQueue(newIndex, updatedSongs, 'playlist', playlistId);
				}
			} else {
				await updateSongQueue(currentIndex, updatedSongs, 'playlist', playlistId);
			}
		}
	}
}

export async function downloadBeatmap(mapSetData, mapId, sessionKey, accessToken) {
	const setId = mapSetData.id.toString();
	// Store the full mapset data first
	// Check if we already have this audio cached
	const cachedAudio = await getCachedAudio(setId, mapId);
	if (cachedAudio) {
		await updateMapsetData(mapSetData);
		return await bufferToBase64(cachedAudio);
	}

	const response = await fetch(`https://osu.ppy.sh/beatmapsets/${setId}/download`, {
		headers: {
			Cookie: `osu_session=${sessionKey}`,
			Referer: `https://osu.ppy.sh/beatmapsets/${setId}`,
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		},
		redirect: 'follow'
	});
	if (!response.ok) {
		return null;
	}
	await fetch('https://api.stamer-d.de/stosufy/addsong', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify({
			setId: parseInt(mapSetData.id),
			mapId: parseInt(mapId)
		})
	});
	const buffer = await response.arrayBuffer();
	const audioBuffer = await extractAudioFromBeatmap(buffer, (mapId = null), setId, mapSetData);
	await updateMapsetData(mapSetData);
	return audioBuffer.toString('base64');
}

async function extractAudioFromBeatmap(mapsetBuffer, mapId, setId, mapsetData) {
	try {
		// Get current data from store
		const mapData = get(mapDataStore);
		const updatedMapData = { ...mapData };

		// Create and set up temporary extraction directory
		const extractDir = await path.join(home + '/Stosufy/extract', `osu-extract-${Date.now()}`);
		await mkdir(extractDir, { recursive: true });
		const zipPath = await path.join(extractDir, 'beatmap.osz');
		await writeFile(zipPath, new Uint8Array(mapsetBuffer));
		const zip = await JSZip.loadAsync(await readFile(zipPath));
		// Extract all files
		const extractPromises = [];
		const osuFiles = [];

		zip.forEach((relativePath, zipEntry) => {
			if (!zipEntry.dir) {
				// Use async path join with await inside the promise

				const isOsuFile = relativePath.endsWith('.osu');
				const isPotentialAudioFile = /\.(mp3|ogg|wav)$/i.test(relativePath);

				// Skip files we don't need
				if (!isOsuFile && !isPotentialAudioFile) {
					return;
				}

				extractPromises.push(
					(async () => {
						const extractPath = await path.join(extractDir, relativePath);

						// Keep track of .osu files
						if (isOsuFile) {
							osuFiles.push(extractPath);
						}

						// Create directories if needed
						const lastSlashIndex = extractPath.lastIndexOf('/');
						if (lastSlashIndex > 0) {
							await mkdir(extractPath.substring(0, lastSlashIndex), {
								recursive: true
							});
						}
						// Get file content and write it
						await writeFile(extractPath, await zipEntry.async('uint8array'));
					})()
				);
			}
		});

		// Wait for all extractions to complete
		await Promise.all(extractPromises);

		// Process .osu files to find audio files
		const audioFileMap = new Map();
		let foundMapId = 0;

		for (const osuFile of osuFiles) {
			const content = await readTextFile(osuFile);

			// Extract beatmap ID and audio filename
			const beatmapIdMatch = content.match(/BeatmapID:(\d+)/);
			const audioFileMatch = content.match(/AudioFilename:(.+)/);

			if (beatmapIdMatch && audioFileMatch) {
				const beatmapId = beatmapIdMatch[1].trim();
				foundMapId = beatmapId;
				const audioFileName = audioFileMatch[1].trim();
				audioFileMap.set(beatmapId, audioFileName);
			}
		}

		// Convert all unique audio files to .opus
		const convertedAudioFiles = new Set();
		const uniqueAudioFiles = new Set(audioFileMap.values());

		for (const audioFileName of uniqueAudioFiles) {
			// Use async path join
			const audioFilePath = await path.join(extractDir, audioFileName);

			if (await exists(audioFilePath)) {
				const targetPath = await path.join(mapSetsDir, `${setId}-${foundMapId}.opus`);
				await convertToOpus(audioFilePath, targetPath);
				convertedAudioFiles.add(targetPath);
			}
		}

		// Initialize mapset entry if needed
		if (!updatedMapData[setId]) {
			updatedMapData[setId] = {
				id: setId,
				title: mapsetData.title || '',
				artist: mapsetData.artist || '',
				creator: mapsetData.creator || '',
				covers: mapsetData.covers || {},
				bpm: mapsetData.bpm || 0,
				status: mapsetData.status || '',
				tags: mapsetData.tags || '',
				beatmaps: {},
				created_at: Date.now()
			};
		}
		if (!updatedMapData[setId].beatmaps) {
			updatedMapData[setId].beatmaps = {};
		}
		// Process beatmaps from the API data
		if (mapsetData.beatmaps?.length) {
			for (const beatmap of mapsetData.beatmaps) {
				const currentMapId = beatmap.id.toString();
				const audioFilePath = audioFileMap.get(currentMapId)
					? await path.join(mapSetsDir, `${setId}-${foundMapId}.opus`)
					: null;

				updatedMapData[setId].beatmaps[currentMapId] = {
					...updatedMapData[setId].beatmaps[currentMapId],
					id: currentMapId,
					version: beatmap.version || '',
					difficulty_rating: beatmap.difficulty_rating || 0,
					mode: beatmap.mode || '',
					total_length: beatmap.total_length || 0,
					downloaded: true,
					audioFile: audioFilePath
				};
			}
		}

		// Mark if multiple audio files exist
		updatedMapData[setId].multipleAudios = convertedAudioFiles.size > 1;

		// Update the store with the new data
		mapDataStore.set(updatedMapData);

		await saveMapData();
		await remove(extractDir, { recursive: true });

		// Return the first converted audio file as base64 (or null if none)
		if (convertedAudioFiles.size > 0) {
			const firstAudioPath = [...convertedAudioFiles][0];
			const audioData = await readFile(firstAudioPath, {
				baseDir: BaseDirectory.Home
			});
			return await bufferToBase64(audioData);
		}

		return null;
	} catch (error) {
		console.error('Error extracting audio from beatmap:', error);
		return null;
	}
}

async function bufferToBase64(buffer) {
	const base64url = await new Promise((r) => {
		const reader = new FileReader();
		reader.onload = () => r(reader.result);
		reader.readAsDataURL(new Blob([buffer]));
	});
	return base64url.slice(base64url.indexOf(',') + 1);
}

// TODO - ADD FILE NAMES
async function convertToOpus(inputPath, targetPath) {
	const ffmpeg = new FFmpeg();
	await ffmpeg.load();
	const ext = inputPath.split('.').pop().toLowerCase();
	const now = Date.now();
	const inputFileName = `${now}.${ext}`;

	const audioData = await readFile(inputPath);

	await ffmpeg.writeFile(inputFileName, new Uint8Array(audioData));
	await ffmpeg.exec([
		'-i',
		inputFileName,
		'-c:a',
		'libvorbis',
		'-b:a',
		'128k',
		'-threads',
		'4',
		'-application',
		'audio',
		'-vn',
		`${now}.opus`
	]);
	let data = await ffmpeg.readFile(`${now}.opus`);
	// Write the output file to the actual filesystem
	await writeFile(targetPath, new Uint8Array(data), {
		baseDir: BaseDirectory.Home
	});
	await ffmpeg.deleteFile(inputFileName);
	await ffmpeg.deleteFile(`${now}.opus`);

	return true;
}

async function updateMapsetData(mapsetData) {
	const setId = mapsetData.id.toString();
	// Get current data from store
	const currentMapData = get(mapDataStore);
	const updatedMapData = { ...currentMapData };

	// Initialize or update set metadata
	if (!updatedMapData[setId]) {
		updatedMapData[setId] = {
			id: setId,
			title: mapsetData.title || '',
			artist: mapsetData.artist || '',
			creator: mapsetData.creator || '',
			covers: mapsetData.covers || {},
			bpm: mapsetData.bpm || 0,
			status: mapsetData.status || '',
			tags: mapsetData.tags || '',
			beatmaps: {},
			created_at: mapsetData.createdAt || Date.now()
		};
	} else {
		// Update existing metadata
		Object.assign(updatedMapData[setId], {
			title: mapsetData.title || updatedMapData[setId].title,
			artist: mapsetData.artist || updatedMapData[setId].artist,
			creator: mapsetData.creator || updatedMapData[setId].creator,
			status: mapsetData.status || updatedMapData[setId].status,
			covers: mapsetData.covers || updatedMapData[setId].covers,
			bpm: mapsetData.bpm || updatedMapData[setId].bpm,
			tags: mapsetData.tags || updatedMapData[setId].tags
		});
	}

	if (!updatedMapData[setId].beatmaps) {
		updatedMapData[setId].beatmaps = {};
	}

	if (mapsetData.beatmaps && Array.isArray(mapsetData.beatmaps)) {
		mapsetData.beatmaps.forEach((beatmap) => {
			const currentMapId = beatmap.id.toString();
			if (!updatedMapData[setId].beatmaps[currentMapId]) {
				updatedMapData[setId].beatmaps[currentMapId] = {};
			}
			const isDownloaded = updatedMapData[setId].beatmaps[currentMapId]?.downloaded || false;

			updatedMapData[setId].beatmaps[currentMapId] = {
				...updatedMapData[setId].beatmaps[currentMapId],
				id: currentMapId,
				version: beatmap.version || '',
				difficulty_rating: beatmap.difficulty_rating || 0,
				mode: beatmap.mode || '',
				total_length: beatmap.total_length || 0,
				downloaded: isDownloaded
			};
		});
	}

	// Update the store with the modified data
	mapDataStore.set(updatedMapData);
	await saveMapData();
}

export function getImageUrl(imagePath) {
	if (!imagePath) return '/logo.png';
	return `https://api.stamer-d.de/${imagePath}`;
}

export function formatSongData(songData) {
	let songs = Object.entries(songData).map(([id, song]) => {
		// Ensure beatmaps is always an array for consistent handling
		const songCopy = { ...song };

		// If beatmaps is an object with keys, convert it to an array
		if (
			songCopy.beatmaps &&
			typeof songCopy.beatmaps === 'object' &&
			!Array.isArray(songCopy.beatmaps)
		) {
			songCopy.beatmaps = Object.values(songCopy.beatmaps);
		} else if (!songCopy.beatmaps) {
			songCopy.beatmaps = [];
		}

		return songCopy;
	});
	songs.sort((a, b) => {
		return (b.created_at || 0) - (a.created_at || 0);
	});
	return songs;
}
