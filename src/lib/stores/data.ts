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
import { addSong } from '../api';
import { showToast } from './toast';
import type { Beatmap, DownloadState, MapSet, SearchFilters, StoredMapSet } from '../types';

let homeDir = '';
let mapSetsDir = '';
let mapDataFile = '';
const BACKFILL_START_DELAY = 10_000;
const BACKFILL_REQUEST_DELAY = 2_000;
const BACKFILL_RATE_LIMIT_DELAY = 60_000;

export const mapDataStore = writable<Record<string, StoredMapSet>>({});
export const downloads = writable<Record<string, DownloadState>>({});

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
		setTimeout(backfillImages, BACKFILL_START_DELAY);
	} catch (error) {
		console.error('Error initializing data store:', error);
	}
})();

export function handleImageError(event: Event) {
	const image = event.target as HTMLImageElement;
	image.src = '/logo.png';
	image.style.filter = 'grayscale(100%)';
	image.style.opacity = '0.7';
}

async function saveMapData() {
	await writeTextFile(mapDataFile, JSON.stringify(get(mapDataStore)), {
		baseDir: BaseDirectory.Home
	});
}

async function getCachedAudio(setId: string, mapId: number | string) {
	const audioFile = get(mapDataStore)[setId]?.beatmaps[mapId]?.audioFile;
	if (audioFile && (await exists(audioFile, { baseDir: BaseDirectory.Home }))) {
		return readFile(audioFile, { baseDir: BaseDirectory.Home });
	}
	return null;
}

export function isSongDownloaded(songId: number | string) {
	return Object.prototype.hasOwnProperty.call(get(mapDataStore), songId.toString());
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = { status: 'any', sort: '' };

export async function fetchMaps(
	search = '',
	cursorString = '',
	filters: SearchFilters = DEFAULT_SEARCH_FILTERS
) {
	const params = new URLSearchParams({
		q: search,
		s: filters.status,
		sort: filters.sort,
		cursor_string: cursorString ?? ''
	});
	try {
		const response = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/search?${params}`, {
			headers: {
				Authorization: `Bearer ${get(keyStore).access_token}`
			}
		});
		if (!response.ok) {
			// Include the start of the body to tell an osu! API error from a Cloudflare block
			const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 120);
			throw new Error(`osu! API error (HTTP ${response.status}): ${body}`);
		}
		return await response.json();
	} catch (error) {
		console.error('Error fetching maps:', error);
		throw error;
	}
}

// TODO - Adjust to remove specific beatmap songs
export async function deleteSong(setId: number | string) {
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
	const { background, thumbnail, video } = mapData[setId];
	for (const imagePath of [background, thumbnail, video]) {
		if (imagePath && (await exists(imagePath, { baseDir: BaseDirectory.Home }))) {
			await remove(imagePath, { baseDir: BaseDirectory.Home });
		}
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

const downloadWorkers: Record<string, Worker> = {};

export async function downloadBeatmap(
	mapSetData: MapSet,
	mapId: number | string,
	sessionKey?: string,
	accessToken?: string
): Promise<string> {
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
				Referer: `https://osu.ppy.sh/beatmapsets/${setId}`
			},
			redirect: 'follow'
		});

		if (!response.ok) {
			throw new Error(
				response.status === 401 || response.status === 403
					? `osu! refused the download (HTTP ${response.status}). Your osu_session cookie may have expired, log in again.`
					: `osu! answered with HTTP ${response.status}`
			);
		}
		downloads.update((d) => ({ ...d, [setId]: { isDownloading: true, progress: 20 } }));
		console.log(setId, mapId, 'Downloading beatmap...');
		// Only statistics: a failing backend must not break the download
		addSong(accessToken, parseInt(setId), parseInt(mapId.toString())).catch((error) =>
			console.warn('Could not register the download:', error)
		);
		const buffer = await response.arrayBuffer();
		// .osz files are zip archives; anything else is usually the osu! login page
		const magic = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
		if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
			throw new Error(
				'osu! did not send a beatmap file. Your osu_session cookie has probably expired, log in again.'
			);
		}
		downloads.update((d) => ({ ...d, [setId]: { isDownloading: true, progress: 25 } }));

		const audio = await processWithWorker(buffer, mapSetData, mapId, setId);
		saveLocalImage(setId, 'thumbnail').catch((error) =>
			console.warn('Could not save the cover of', setId, error)
		);
		return audio;
	} catch (error) {
		console.error('Error downloading beatmap:', error);
		showToast(
			`Download failed: ${error instanceof Error ? error.message : error}`,
			'icon-[mingcute--warning-line]',
			7000
		);
		delete downloadWorkers[setId];
		downloads.update((state) => {
			const newState = { ...state };
			delete newState[setId];
			return newState;
		});
		throw error;
	}
}

async function processWithWorker(
	buffer: ArrayBuffer,
	mapSetData: MapSet,
	mapId: number | string,
	setId: string
): Promise<string> {
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
							error: err instanceof Error ? err.message : String(err)
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
						if (event.data.backgroundPath) {
							mapSetData = { ...mapSetData, background: event.data.backgroundPath };
						}
						const video = event.data.video;
						if (video && isPlayableVideo(video.path)) {
							mapSetData = { ...mapSetData, video: video.path, videoOffset: video.offset };
						} else if (video) {
							queueVideoConversion(setId, video.path, video.offset);
						}
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

async function bufferToBase64(buffer: Uint8Array<ArrayBuffer>) {
	const base64url = await new Promise<string>((r) => {
		const reader = new FileReader();
		reader.onload = () => r(reader.result as string);
		reader.readAsDataURL(new Blob([buffer]));
	});
	return base64url.slice(base64url.indexOf(',') + 1);
}

/** Video formats the webview plays directly; others (mostly .avi and .flv) are converted */
function isPlayableVideo(videoPath: string) {
	return /\.(mp4|m4v|webm|mov)$/i.test(videoPath);
}

let videoConversions = Promise.resolve();

/**
 * Converts a video to mp4 in the background, one at a time: it takes a while and the song
 * can be played without it in the meantime.
 */
function queueVideoConversion(setId: string, sourcePath: string, offset: number) {
	videoConversions = videoConversions.then(async () => {
		const targetPath = sourcePath.replace(/\.[^.]+$/, '.mp4');
		try {
			const ffmpeg = new FFmpeg();
			await ffmpeg.load();
			const input = `input.${sourcePath.split('.').pop()}`;
			await ffmpeg.writeFile(input, await readFile(sourcePath, { baseDir: BaseDirectory.Home }));
			// Muted 720p H.264; quick to encode and plays everywhere
			await ffmpeg.exec([
				'-i',
				input,
				'-an',
				'-vf',
				"scale=-2:'min(720,ih)'",
				'-c:v',
				'libx264',
				'-preset',
				'ultrafast',
				'-crf',
				'26',
				'-pix_fmt',
				'yuv420p',
				'-movflags',
				'+faststart',
				'output.mp4'
			]);
			const data = (await ffmpeg.readFile('output.mp4')) as Uint8Array;
			ffmpeg.terminate();
			if (!data.length) throw new Error('empty output');
			await writeFile(targetPath, data, { baseDir: BaseDirectory.Home });
			mapDataStore.update((all) =>
				all[setId]
					? { ...all, [setId]: { ...all[setId], video: targetPath, videoOffset: offset } }
					: all
			);
			await saveMapData();
		} catch (error) {
			console.warn('Could not convert the video of', setId, error);
		} finally {
			await remove(sourcePath, { baseDir: BaseDirectory.Home }).catch(() => {});
		}
	});
}

async function convertToOpus(inputPath: string, targetPath: string) {
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
	const data = (await ffmpeg.readFile(`${now}.opus`)) as Uint8Array;
	await writeFile(targetPath, data, {
		baseDir: BaseDirectory.Home
	});
	await ffmpeg.deleteFile(inputFileName);
	await ffmpeg.deleteFile(`${now}.opus`);

	return true;
}

async function updateMapsetData(mapsetData: MapSet) {
	const setId = mapsetData.id.toString();
	const updatedMapData = { ...get(mapDataStore) };

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
			background: mapsetData.background || null,
			video: mapsetData.video || null,
			videoOffset: mapsetData.videoOffset || 0,
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
			tags: mapsetData.tags || updatedMapData[setId].tags,
			background: mapsetData.background || updatedMapData[setId].background || null,
			video: mapsetData.video || updatedMapData[setId].video || null,
			videoOffset: mapsetData.videoOffset ?? updatedMapData[setId].videoOffset ?? 0
		});
	}

	if (!updatedMapData[setId].beatmaps) {
		updatedMapData[setId].beatmaps = {};
	}

	if (mapsetData.beatmaps && Array.isArray(mapsetData.beatmaps)) {
		mapsetData.beatmaps.forEach((beatmap) => {
			const currentMapId = beatmap.id.toString();
			const existing = updatedMapData[setId].beatmaps[currentMapId];

			updatedMapData[setId].beatmaps[currentMapId] = {
				...existing,
				id: currentMapId,
				version: beatmap.version || '',
				difficulty_rating: beatmap.difficulty_rating || 0,
				mode: beatmap.mode || '',
				total_length: beatmap.total_length || 0,
				downloaded: existing?.downloaded || false,
				audioFile: beatmap.audioFile || existing?.audioFile || null
			};
		});
	}

	mapDataStore.set(updatedMapData);
	await saveMapData();
}

export function getImageUrl(imageUrl: string | null | undefined) {
	return imageUrl || '/logo.png';
}

/** Converts the stored map data into a list of map sets, sorted by download date */
export function formatSongData(songData: Record<string, StoredMapSet>): MapSet[] {
	const songs = Object.values(songData).map((song) => ({
		...song,
		beatmaps: song.beatmaps ? Object.values<Beatmap>(song.beatmaps) : []
	}));
	songs.sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
	return songs;
}

/** A stable, muted color for something without an image, derived from its name */
export function colorFromString(text = '') {
	let hash = 0;
	for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return `oklch(0.42 0.12 ${Math.abs(hash) % 360})`;
}

const imageColorCache = new Map<string, Promise<string | null>>();

/**
 * Average color of an image, toned for use as a background wash. The image is loaded
 * through the HTTP plugin, so cross-origin images don't taint the canvas.
 */
export function colorFromImage(url: string): Promise<string | null> {
	if (!imageColorCache.has(url)) {
		imageColorCache.set(
			url,
			(async () => {
				try {
					const response = await fetch(url);
					if (!response.ok) return null;
					const bitmap = await createImageBitmap(await response.blob());
					const canvas = new OffscreenCanvas(16, 16);
					const context = canvas.getContext('2d');
					context.drawImage(bitmap, 0, 0, 16, 16);
					const pixels = context.getImageData(0, 0, 16, 16).data;
					let r = 0;
					let g = 0;
					let b = 0;
					for (let i = 0; i < pixels.length; i += 4) {
						r += pixels[i];
						g += pixels[i + 1];
						b += pixels[i + 2];
					}
					const count = pixels.length / 4;
					return `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`;
				} catch {
					return null;
				}
			})()
		);
	}
	return imageColorCache.get(url);
}

/** The images saved next to the audio of a downloaded set */
const LOCAL_IMAGES = {
	// Full size background, used for wallpapers
	background: { urls: (setId: string) => fullBackgroundUrls(setId) },
	// Small square cover, used in lists and the song bar
	thumbnail: {
		urls: (setId: string) => [`https://assets.ppy.sh/beatmaps/${setId}/covers/list@2x.jpg`]
	}
} as const;
type LocalImage = keyof typeof LOCAL_IMAGES;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Saves an image of a set from the osu! servers. Returns the HTTP status. */
async function saveLocalImage(setId: string, kind: LocalImage): Promise<number> {
	let response: Response;
	for (const url of LOCAL_IMAGES[kind].urls(setId)) {
		response = await fetch(url);
		if (response.ok || response.status === 429) break;
	}
	if (response.status === 429) return 429;
	let change: Partial<StoredMapSet> = { [`${kind}Unavailable`]: true };
	if (response.ok) {
		const name = `${setId}-${kind === 'background' ? 'bg' : 'thumb'}.jpg`;
		const imagePath = await path.join(mapSetsDir, name);
		await writeFile(imagePath, new Uint8Array(await response.arrayBuffer()), {
			baseDir: BaseDirectory.Home
		});
		change = { [kind]: imagePath };
	}
	mapDataStore.update((data) =>
		data[setId] ? { ...data, [setId]: { ...data[setId], ...change } } : data
	);
	await saveMapData();
	return response.status;
}

/**
 * Songs downloaded before images were saved only have them online. Loads them one request at
 * a time with a pause in between, so the osu! servers are not hammered. Backs off when rate
 * limited and never retries an image that does not exist.
 */
async function backfillImages() {
	const jobs = Object.values(get(mapDataStore)).flatMap((set) =>
		(Object.keys(LOCAL_IMAGES) as LocalImage[])
			.filter((kind) => !set[kind] && !set[`${kind}Unavailable`])
			.map((kind) => [set.id.toString(), kind] as const)
	);
	for (const [setId, kind] of jobs) {
		try {
			if ((await saveLocalImage(setId, kind)) === 429) {
				await wait(BACKFILL_RATE_LIMIT_DELAY);
				continue;
			}
		} catch (error) {
			// Offline or similar: try again on the next start
			console.warn(`Could not load the ${kind} of`, setId, error);
			return;
		}
		await wait(BACKFILL_REQUEST_DELAY);
	}
}

const localImages = new Map<string, Promise<string | null>>();

/** A blob URL for an image saved in the songs folder, or null if it can't be read */
function localImageUrl(imagePath: string) {
	if (!localImages.has(imagePath)) {
		localImages.set(
			imagePath,
			readFile(imagePath, { baseDir: BaseDirectory.Home })
				.then((data) => URL.createObjectURL(new Blob([data])))
				.catch(() => null)
		);
	}
	return localImages.get(imagePath);
}

/**
 * The background of a beatmap set in full size on the osu! servers, best first: the original
 * upload and the optimized full size copy.
 */
function fullBackgroundUrls(setId: number | string) {
	const base = `https://assets.ppy.sh/beatmaps/${setId}/covers`;
	return [`${base}/raw.jpg`, `${base}/fullsize.jpg`];
}

/**
 * Candidate URLs for the background of a beatmap set, to try in order: the original saved in
 * the songs folder (works offline), else the full size image online and, as a last resort,
 * the 1800x500 banner.
 */
export async function backgroundUrls(setId: number | string): Promise<string[]> {
	const imagePath = get(mapDataStore)[setId]?.background;
	const local = imagePath && (await localImageUrl(imagePath));
	if (local) return [local];
	return [
		...fullBackgroundUrls(setId),
		`https://assets.ppy.sh/beatmaps/${setId}/covers/cover@2x.jpg`
	];
}

/** The small square cover of a beatmap set: saved in the songs folder or online */
export async function thumbnailUrl(setId: number | string): Promise<string> {
	const imagePath = get(mapDataStore)[setId]?.thumbnail;
	return (
		(imagePath && (await localImageUrl(imagePath))) ||
		`https://assets.ppy.sh/beatmaps/${setId}/covers/list@2x.jpg`
	);
}
