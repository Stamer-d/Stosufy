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
import { getPlaylistSongs, playlists } from './playlist';
import { songQueue, updateSongQueue } from './audio';

let homeDir = '';
let mapSetsDir = '';
let mapDataFile = '';
export let mapDataStore = writable({});
export const downloads = writable({});

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

export function handleImageError(event) {
	event.target.src = '/logo.png';
	event.target.style.filter = 'grayscale(100%)';
	event.target.style.opacity = '0.7';
}

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

export function isSongDownloaded(songId) {
	// Check if the song exists in mapDataStore
	const mapData = get(mapDataStore);
	// Convert songId to string for consistent comparison
	const songIdStr = songId.toString();
	return Object.prototype.hasOwnProperty.call(mapData, songIdStr);
}

export async function fetchMaps(search = '', cursorString = '') {
	try {
		const response = await fetch(
			`https://osu.ppy.sh/api/v2/beatmapsets/search?e=&c=&g=&l=&m=&nsfw=&played=&r=&sort=&s=any&q=${search}&cursor_string=${cursorString}`,
			{
				headers: {
					Authorization: `Bearer ${get(keyStore).access_token}`,
					Referer: 'https://osu.ppy.sh/beatmapsets',
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				}
			}
		);
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
	await getPlaylistSongs(-1, true);
}

const downloadWorkers = {};

export async function downloadBeatmap(mapSetData, mapId, sessionKey, accessToken) {
	const setId = mapSetData.id.toString();
	if (downloadWorkers[setId]) return;
	try {
		const cachedAudio = await getCachedAudio(setId, mapId);
		if (cachedAudio) {
			await updateMapsetData(mapSetData);
			return await bufferToBase64(cachedAudio);
		}
		downloads.update((d) => ({ ...d, [setId]: { isDownloading: true, progress: 0 } }));
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
			throw new Error(`Failed to download beatmap: ${response.status}`);
		}
		downloads.update((d) => ({ ...d, [setId]: { isDownloading: true, progress: 20 } }));
		console.log(setId, mapId, 'Downloading beatmap...');
		await fetch('https://api.stamer-d.de/v1/stosufy/addsong', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({
				setId: parseInt(setId),
				mapId: parseInt(mapId)
			})
		});
		const buffer = await response.arrayBuffer();
		downloads.update((d) => ({ ...d, [setId]: { isDownloading: true, progress: 25 } }));

		return await processWithWorker(buffer, mapSetData, mapId, setId);
	} catch (error) {
		console.error('Error downloading beatmap:', error);
		delete downloadWorkers[setId];
		downloads.update((state) => {
			const newState = { ...state };
			delete newState[setId];
			return newState;
		});
		throw error;
	}
}

async function processWithWorker(buffer, mapSetData, mapId, setId) {
	return new Promise((resolve, reject) => {
		try {
			let worker = new Worker(new URL('../workers/song.ts', import.meta.url), { type: 'module' });
			downloadWorkers[setId] = worker;
			worker.onmessage = async (event) => {
				const {
					type,
					requestId,
					operation,
					data,
					progress,
					audioBase64,
					error,
					setId: eventSetId
				} = event.data;

				if (type === 'fs_request') {
					try {
						let result;
						switch (operation) {
							case 'mkdir':
								await mkdir(data.dir, { recursive: true });
								result = true;
								break;

							case 'exists':
								result = await exists(data.path, { baseDir: BaseDirectory.Home });
								break;

							case 'writeFile':
								await writeFile(data.path, data.data, { baseDir: BaseDirectory.Home });
								result = true;
								break;

							case 'readFile':
								result = await readFile(data.path, { baseDir: BaseDirectory.Home });
								break;

							case 'readTextFile':
								result = await readTextFile(data.path, { baseDir: BaseDirectory.Home });
								break;

							case 'remove':
								await remove(data.path, { baseDir: BaseDirectory.Home, recursive: true });
								result = true;
								break;

							case 'path_join':
								result = await path.join(...data.paths);
								break;

							case 'convertToOpus':
								result = await convertToOpus(data.inputPath, data.targetPath);
								break;
						}

						worker.postMessage({
							type: 'fs_response',
							requestId,
							result
						});
					} catch (err) {
						worker.postMessage({
							type: 'fs_response',
							requestId,
							error: err.message
						});
					}
					return;
				}
				if (type === 'progress' && eventSetId === setId) {
					downloads.update((d) => ({ ...d, [setId]: { isDownloading: true, progress: progress } }));
					return;
				}
				if (type === 'extract-complete' && eventSetId === setId) {
					try {
						const audioPath = event.data.audioPath;
						console.log('Worker completed extraction for:', setId, 'Audio path:', audioPath);

						if (audioPath) {
							mapSetData.beatmaps.forEach((element) => {
								element.audioFile = audioPath;
							});
						}

						await updateMapsetData(mapSetData);
						await getPlaylistSongs(-1, true);
						downloads.update((state) => ({
							...state,
							[setId]: { isDownloading: true, progress: 100 }
						}));

						setTimeout(() => {
							downloads.update((state) => {
								const newState = { ...state, [setId]: { isDownloading: false, progress: 100 } };
								return newState;
							});
						}, 500);
						downloads.update((state) => {
							const newState = { ...state };
							delete newState[setId];
							return newState;
						});
						worker.terminate();
						delete downloadWorkers[setId];
						resolve(await bufferToBase64(audioBase64));
					} catch (err) {
						console.error('Error processing extracted audio:', err);

						if (worker) {
							worker.terminate();
							worker = null;
						}
						reject(err);
					}
				}

				if (type === 'error' && eventSetId === setId) {
					console.error('Worker reported error:', error);

					if (worker) {
						worker.terminate();
						worker = null;
					}
					reject(new Error(error));
				}
			};

			worker.onerror = (err) => {
				console.error('Worker error:', err);
				if (worker) {
					worker.terminate();
					worker = null;
				}
				reject(err);
			};

			worker.postMessage({
				type: 'extract',
				data: {
					buffer,
					mapId,
					setId,
					mapSetData: {
						id: mapSetData.id,
						title: mapSetData.title || '',
						artist: mapSetData.artist || '',
						creator: mapSetData.creator || '',
						covers: JSON.parse(JSON.stringify(mapSetData.covers || {})),
						bpm: mapSetData.bpm || 0,
						status: mapSetData.status || '',
						tags: mapSetData.tags || '',
						beatmaps: mapSetData.beatmaps
							? mapSetData.beatmaps.map((beatmap) => ({
									id: beatmap.id,
									version: beatmap.version || '',
									difficulty_rating: beatmap.difficulty_rating || 0,
									mode: beatmap.mode || '',
									total_length: beatmap.total_length || 0
								}))
							: []
					},
					homeDir,
					mapSetsDir
				}
			});
		} catch (err) {
			console.error('Error setting up worker:', err);
			reject(err);
		}
	});
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
	await writeFile(targetPath, new Uint8Array(data), {
		baseDir: BaseDirectory.Home
	});
	await ffmpeg.deleteFile(inputFileName);
	await ffmpeg.deleteFile(`${now}.opus`);

	return true;
}

async function updateMapsetData(mapsetData) {
	const setId = mapsetData.id.toString();
	const currentMapData = get(mapDataStore);
	const updatedMapData = { ...currentMapData };

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

			const audioFile =
				beatmap.audioFile || updatedMapData[setId].beatmaps[currentMapId]?.audioFile || null;

			updatedMapData[setId].beatmaps[currentMapId] = {
				...updatedMapData[setId].beatmaps[currentMapId],
				id: currentMapId,
				version: beatmap.version || '',
				difficulty_rating: beatmap.difficulty_rating || 0,
				mode: beatmap.mode || '',
				total_length: beatmap.total_length || 0,
				downloaded: isDownloaded,
				audioFile: audioFile
			};
		});
	}

	mapDataStore.set(updatedMapData);
	await saveMapData();
}

export function getImageUrl(imagePath) {
	if (!imagePath) return '/logo.png';
	return `https://api.stamer-d.de/v1/${imagePath}`;
}

export function formatSongData(songData) {
	let songs = Object.entries(songData).map(([id, song]) => {
		const songCopy = { ...song };

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
		return (a.created_at || 0) - (b.created_at || 0);
	});
	return songs;
}
