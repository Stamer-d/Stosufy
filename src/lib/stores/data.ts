import { get, writable } from 'svelte/store';
import { keyStore, freshToken } from './auth';
import { fetch } from '@tauri-apps/plugin-http';
import JSZip from 'jszip';
import { findVideo, parseOsuFile } from '../osuFile';
import { splitTracks, trackGroups } from '../tracks';
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
import { getPlaylistSongs } from './playlist';
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
			removeStoryboards();
		}
		setTimeout(backfillImages, BACKFILL_START_DELAY);
		setTimeout(backfillDetails, BACKFILL_START_DELAY * 1.5);
	} catch (error) {
		console.error('Error initializing data store:', error);
	}
})();

/** Storyboards were removed: frees the space of the ones saved before, once */
async function removeStoryboards() {
	const data = get(mapDataStore);
	const withStoryboard = Object.values(data).filter(
		(set) => 'storyboard' in set || 'hasStoryboard' in set || 'storyboardChecked' in set
	);
	if (!withStoryboard.length) return;
	for (const set of withStoryboard) {
		const dir = set.storyboard?.dir;
		if (dir?.startsWith(mapSetsDir)) {
			await remove(dir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
		}
	}
	mapDataStore.update((current) => {
		const next = { ...current };
		for (const { id } of withStoryboard) {
			if (!next[id]) continue;
			const {
				storyboard: _storyboard,
				hasStoryboard: _has,
				storyboardChecked: _checked,
				...rest
			} = next[id];
			next[id] = rest as StoredMapSet;
		}
		return next;
	});
	await saveMapData();
}

export function handleImageError(event: Event) {
	const image = event.target as HTMLImageElement;
	image.src = '/logo.png';
	image.style.filter = 'grayscale(100%)';
	image.style.opacity = '0.7';
}

// The song data of a big library is many megabytes: changes made close together (playing a
// song, looking up its timing, a cover) are saved once, a moment later
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveWaiters: (() => void)[] = [];
let saving: Promise<void> = Promise.resolve();

async function writeMapData() {
	saveTimer = null;
	const waiters = saveWaiters;
	saveWaiters = [];
	saving = saving.then(() =>
		writeTextFile(mapDataFile, JSON.stringify(get(mapDataStore)), {
			baseDir: BaseDirectory.Home
		}).catch((error) => console.error('Could not save the song data:', error))
	);
	await saving;
	waiters.forEach((resolve) => resolve());
}

export function saveMapData(): Promise<void> {
	return new Promise((resolve) => {
		saveWaiters.push(resolve);
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(writeMapData, 400);
	});
}

/** Saves now what's waiting to be saved (when the app closes) */
export async function flushMapData() {
	if (!saveTimer) return saving;
	clearTimeout(saveTimer);
	await writeMapData();
}

if (typeof window !== 'undefined') {
	// Nothing waiting is lost when the app closes
	window.addEventListener('beforeunload', () => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			writeMapData();
		}
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
	const params = new URLSearchParams({ q: search });
	if (filters.status) params.set('s', filters.status);
	if (filters.sort) params.set('sort', filters.sort);
	if (cursorString) params.set('cursor_string', cursorString);
	if (filters.genre) params.set('g', filters.genre);
	if (filters.language) params.set('l', filters.language);
	try {
		const url = `https://osu.ppy.sh/api/v2/beatmapsets/search?${params}`;
		let response!: Response;
		// osu! sometimes answers with a 5xx (and a token can run out): try again a bit later
		for (let attempt = 0; attempt < 3; attempt++) {
			const token = await freshToken(attempt > 0 && response?.status === 401);
			response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
			if (response.ok || (response.status < 500 && response.status !== 401)) break;
			await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
		}
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
	const { background, thumbnail, video } = mapData[setId];
	// The hitsounds (also the .osu files fetched for songs downloaded before they were saved)
	await remove(`${mapSetsDir}/${setId}-hitsounds`, {
		baseDir: BaseDirectory.Home,
		recursive: true
	}).catch(() => {});
	// Only files in Stosufy's own folder: songs imported from osu! keep their files
	for (const filePath of [audioFilePath, background, thumbnail, video]) {
		if (!filePath?.startsWith(mapSetsDir)) continue;
		if (await exists(filePath, { baseDir: BaseDirectory.Home })) {
			await remove(filePath, { baseDir: BaseDirectory.Home });
		}
	}
	delete mapData[setId];
	mapDataStore.set(mapData);
	await saveMapData();

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
	accessToken?: string,
	{ quiet = false }: { quiet?: boolean } = {}
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
		// osu! renews the session cookie now and then: the newest one is kept, and a refused
		// download is tried once more with it
		const request = (key: string | undefined) =>
			fetch(`https://osu.ppy.sh/beatmapsets/${setId}/download`, {
				headers: {
					Cookie: `osu_session=${key}`,
					Referer: `https://osu.ppy.sh/beatmapsets/${setId}`
				},
				redirect: 'follow'
			});
		const keepCookie = (answer: Response) => {
			const renewed = answer.headers.get('set-cookie')?.match(/osu_session=([^;]+)/)?.[1];
			if (renewed && renewed !== get(keyStore).sessionKey)
				keyStore.update((keys) => ({ ...keys, sessionKey: renewed }));
		};
		let response = await request(get(keyStore).sessionKey || sessionKey);
		keepCookie(response);
		if (response.status === 401 || response.status === 403) {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			response = await request(get(keyStore).sessionKey || sessionKey);
			keepCookie(response);
		}

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
		// The download queue shows its own errors
		if (!quiet)
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
						mapSetData = {
							...mapSetData,
							hasVideo: !!video,
							timing: event.data.timing ?? [],
							hitsounds: event.data.hitsounds ?? null
						};
						if (video && isPlayableVideo(video.path)) {
							mapSetData = { ...mapSetData, video: video.path, videoOffset: video.offset };
						} else if (video) {
							queueVideoConversion(setId, video.path, video.offset);
						}
						console.log('Worker completed extraction for:', setId, 'Audio path:', audioPath);

						// Each difficulty gets its own song, background, title and timing
						const maps = event.data.maps ?? {};
						mapSetData.beatmaps.forEach((element) => {
							const info = maps[element.id];
							element.audioFile = info?.audioPath ?? audioPath ?? element.audioFile;
							if (info?.backgroundPath) element.background = info.backgroundPath;
							if (info?.title) element.title = info.title;
							if (info?.artist) element.artist = info.artist;
							if (info?.timing) element.timing = info.timing;
							if (info?.kiai) element.kiai = info.kiai;
							if (info?.osuFile) element.osuFile = info.osuFile;
							if (info?.chartFile) element.chartFile = info.chartFile;
						});

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

export interface VideoFetchState {
	state: 'idle' | 'checking' | 'downloading' | 'done' | 'error';
	/** Sets whose video was added */
	done: number;
	/** Sets that have a video on osu! but not locally */
	total: number;
	message?: string;
}

export const videoFetch = writable<VideoFetchState>({ state: 'idle', done: 0, total: 0 });

const VIDEO_CHECK_BATCH = 50;
const VIDEO_CHECK_DELAY = 1_000;
const VIDEO_DOWNLOAD_DELAY = 10_000;

function setStoredFields(setId: string, change: Partial<StoredMapSet>) {
	mapDataStore.update((data) =>
		data[setId] ? { ...data, [setId]: { ...data[setId], ...change } } : data
	);
}

/**
 * Adds the videos of downloaded songs that were saved without one: asks the osu! API which
 * sets have a video (50 per request), then downloads those sets again one at a time with a
 * pause in between and keeps only the video. Nothing else of the songs changes.
 */
export async function fetchMissingVideos() {
	if (['checking', 'downloading'].includes(get(videoFetch).state)) return;
	const { access_token: token, sessionKey } = get(keyStore);
	const fail = (message: string) => videoFetch.update((s) => ({ ...s, state: 'error', message }));
	try {
		videoFetch.set({ state: 'checking', done: 0, total: 0 });

		// 1. Which sets have a video; remembered, so this only runs once per set
		const unchecked = Object.values(get(mapDataStore)).filter(
			(set) =>
				set.hasVideo === undefined && Object.keys(set.beatmaps ?? {}).some((id) => /^\d+$/.test(id))
		);
		for (let i = 0; i < unchecked.length; i += VIDEO_CHECK_BATCH) {
			const batch = unchecked.slice(i, i + VIDEO_CHECK_BATCH);
			const ids = batch.map((set) => Object.keys(set.beatmaps).find((id) => /^\d+$/.test(id)));
			const response = await fetch(
				`https://osu.ppy.sh/api/v2/beatmaps?ids[]=${ids.join('&ids[]=')}`,
				{ headers: { Authorization: `Bearer ${token}` } }
			);
			if (!response.ok) return fail(`osu! API error (HTTP ${response.status})`);
			const { beatmaps } = await response.json();
			const setsWith = (flag: string) =>
				new Set(
					beatmaps.filter((map) => map.beatmapset?.[flag]).map((map) => String(map.beatmapset_id))
				);
			const withVideo = setsWith('video');
			for (const set of batch) {
				const id = set.id.toString();
				setStoredFields(id, { hasVideo: set.hasVideo ?? withVideo.has(id) });
			}
			await saveMapData();
			await wait(VIDEO_CHECK_DELAY);
		}

		// 2. Download the sets missing their video again, one at a time
		const needsVideo = (set: StoredMapSet) => set.hasVideo && !set.video && !set.videoSource;
		const missing = Object.values(get(mapDataStore)).filter(
			(set) => set.source !== 'osu' && needsVideo(set)
		);
		videoFetch.set({ state: 'downloading', done: 0, total: missing.length });
		for (const [index, set] of missing.entries()) {
			const setId = set.id.toString();
			const response = await fetch(`https://osu.ppy.sh/beatmapsets/${setId}/download`, {
				headers: {
					Cookie: `osu_session=${sessionKey}`,
					Referer: `https://osu.ppy.sh/beatmapsets/${setId}`
				}
			});
			if (response.status === 429) {
				return fail('osu! limits the downloads right now, try again later.');
			}
			if (!response.ok) return fail(`osu! refused the download (HTTP ${response.status}).`);
			const buffer = await response.arrayBuffer();
			const magic = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
			if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
				return fail(
					'osu! did not send a beatmap file. Your osu_session cookie has probably expired.'
				);
			}
			const zip = await JSZip.loadAsync(buffer);
			await saveVideoFromSet(setId, zip);
			videoFetch.update((s) => ({ ...s, done: s.done + 1 }));
			if (index < missing.length - 1) await wait(VIDEO_DOWNLOAD_DELAY);
		}
		videoFetch.update((s) => ({ ...s, state: 'done' }));
	} catch (error) {
		console.error('Could not fetch videos:', error);
		fail(error instanceof Error ? error.message : String(error));
	}
}

/** Saves only the video of a downloaded beatmap set (.osz) */
async function saveVideoFromSet(setId: string, zip: JSZip) {
	let video: { file: string; offset: number } | null = null;
	for (const entry of Object.values(zip.files)) {
		if (entry.dir || !entry.name.endsWith('.osu')) continue;
		video = findVideo(await entry.async('string'));
		if (video) break;
	}
	const entry =
		video &&
		Object.values(zip.files).find(
			(file) => !file.dir && file.name.toLowerCase() === video.file.toLowerCase()
		);
	if (!entry) {
		setStoredFields(setId, { hasVideo: false });
		await saveMapData();
		return;
	}
	const extension = video.file.split('.').pop().toLowerCase();
	const videoPath = await path.join(mapSetsDir, `${setId}-video.${extension}`);
	await writeFile(videoPath, await entry.async('uint8array'), { baseDir: BaseDirectory.Home });
	if (isPlayableVideo(videoPath)) {
		setStoredFields(setId, { video: videoPath, videoOffset: video.offset });
		await saveMapData();
	} else {
		queueVideoConversion(setId, videoPath, video.offset);
	}
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
function queueVideoConversion(
	setId: string,
	sourcePath: string,
	offset: number,
	removeSource = true
) {
	videoConversions = videoConversions.then(async () => {
		const targetPath = removeSource
			? sourcePath.replace(/\.[^.]+$/, '.mp4')
			: await path.join(mapSetsDir, `${setId}-video.mp4`);
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
			if (removeSource) {
				await remove(sourcePath, { baseDir: BaseDirectory.Home }).catch(() => {});
			}
		}
	});
}

const convertingVideos = new Set<string>();

/**
 * Makes the video of an imported song playable: plays it from the osu! folder when the
 * webview supports the format, else converts a copy into Stosufy's folder (once).
 */
export function ensureVideo(setId: string) {
	const set = get(mapDataStore)[setId];
	if (!set?.videoSource || set.video || convertingVideos.has(setId)) return;
	if (isPlayableVideo(set.videoSource)) {
		setStoredFields(setId, { video: set.videoSource });
		saveMapData();
		return;
	}
	convertingVideos.add(setId);
	queueVideoConversion(setId, set.videoSource, set.videoOffset ?? 0, false);
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
			hasVideo: mapsetData.hasVideo,
			timing: mapsetData.timing,
			hitsounds: mapsetData.hitsounds ?? null,
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
			videoOffset: mapsetData.videoOffset ?? updatedMapData[setId].videoOffset ?? 0,
			hasVideo: mapsetData.hasVideo ?? updatedMapData[setId].hasVideo,
			hitsounds: mapsetData.hitsounds ?? updatedMapData[setId].hitsounds,
			timing: mapsetData.timing ?? updatedMapData[setId].timing
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
				audioFile: beatmap.audioFile || existing?.audioFile || null,
				background: beatmap.background || existing?.background || null,
				title: beatmap.title || existing?.title,
				artist: beatmap.artist || existing?.artist,
				timing: beatmap.timing || existing?.timing,
				kiai: beatmap.kiai || existing?.kiai,
				osuFile: beatmap.osuFile || existing?.osuFile,
				chartFile: beatmap.chartFile || existing?.chartFile,
				loudness: existing?.loudness
			};
		});
	}

	// Where the song is from (osu!'s "source"; the stored `source` marks imported songs)
	if (typeof mapsetData.source === 'string' && mapsetData.source !== 'osu')
		updatedMapData[setId].songSource ??= mapsetData.source;
	mapDataStore.set(updatedMapData);
	await saveMapData();
	// Its genre, language and tags, soon
	if (updatedMapData[setId].genre === undefined) setTimeout(backfillDetails, 3000);
}

export function getImageUrl(imageUrl: string | null | undefined) {
	return imageUrl || '/logo.png';
}

/** Converts the stored map data into a list of map sets, sorted by download date */
export function formatSongData(songData: Record<string, StoredMapSet>): MapSet[] {
	// Sets with several songs show each of them
	const songs = Object.values(songData).flatMap(splitTracks);
	songs.sort(
		(a, b) =>
			Number(a.created_at || 0) - Number(b.created_at || 0) || (a.track ?? 0) - (b.track ?? 0)
	);
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
let backfillRunning = false;

export async function backfillImages() {
	if (backfillRunning) return;
	backfillRunning = true;
	try {
		await runBackfill();
	} finally {
		backfillRunning = false;
	}
}

async function runBackfill() {
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

// --- Genres, languages and tags of downloaded songs ------------------------------------

let detailsRunning = false;
let detailsAgain = false;

/**
 * Fills in what osu! knows about downloaded sets but the download doesn't tell: the genre,
 * the language, the tags and where the song is from. One set every few seconds.
 */
export async function backfillDetails() {
	if (detailsRunning) {
		detailsAgain = true;
		return;
	}
	detailsRunning = true;
	try {
		do {
			detailsAgain = false;
			await runDetails();
		} while (detailsAgain);
	} finally {
		detailsRunning = false;
	}
}

async function runDetails() {
	const missing = Object.values(get(mapDataStore))
		.filter((set) => set.genre === undefined && !set.detailsUnavailable && Number(set.id) > 0)
		.map((set) => String(set.id));
	let changed = 0;
	for (const setId of missing) {
		if (!navigator.onLine) break;
		let response: Response;
		try {
			response = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${setId}`, {
				headers: { Authorization: `Bearer ${await freshToken()}` }
			});
		} catch {
			break;
		}
		if (response.status === 429) {
			await wait(BACKFILL_RATE_LIMIT_DELAY);
			continue;
		}
		const data = response.ok ? await response.json().catch(() => null) : null;
		const set = get(mapDataStore)[setId];
		if (!set) continue;
		if (data) {
			set.genre = data.genre?.id > 1 ? data.genre.name : null;
			set.language = data.language?.id > 1 ? data.language.name : null;
			set.tags = data.tags || set.tags || '';
			set.songSource = data.source || '';
		} else if (response.status === 404) set.detailsUnavailable = true;
		else {
			await wait(BACKFILL_REQUEST_DELAY);
			continue;
		}
		// Saved now and then, not after every set
		if (++changed % 10 === 0) {
			mapDataStore.update((all) => ({ ...all }));
			await saveMapData();
		}
		await wait(BACKFILL_REQUEST_DELAY);
	}
	if (changed % 10) {
		mapDataStore.update((all) => ({ ...all }));
		await saveMapData();
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
export async function backgroundUrls(
	setId: number | string,
	mapId?: number | string
): Promise<string[]> {
	// A difficulty can have its own background (sets with several songs)
	const set = get(mapDataStore)[setId];
	const imagePath = (mapId != null && set?.beatmaps?.[mapId]?.background) || set?.background;
	const local = imagePath && (await localImageUrl(imagePath));
	if (local) return [local];
	return [
		...fullBackgroundUrls(setId),
		`https://assets.ppy.sh/beatmaps/${setId}/covers/cover@2x.jpg`
	];
}

const smallImages = new Map<string, Promise<string | null>>();

/** A small (cover sized) copy of an image in the songs folder, made once */
function smallImageUrl(imagePath: string) {
	if (!smallImages.has(imagePath)) {
		smallImages.set(
			imagePath,
			readFile(imagePath, { baseDir: BaseDirectory.Home })
				.then(async (data) => {
					const bitmap = await createImageBitmap(new Blob([data]));
					const size = 160;
					const scale = size / Math.min(bitmap.width, bitmap.height);
					const canvas = new OffscreenCanvas(size, size);
					const w = bitmap.width * scale;
					const h = bitmap.height * scale;
					canvas.getContext('2d')!.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
					bitmap.close();
					return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg' }));
				})
				.catch(() => null)
		);
	}
	return smallImages.get(imagePath)!;
}

/**
 * The small square cover of a beatmap set: saved in the songs folder or online. The songs
 * of a set with several (track > 0) show their own background when they have one.
 */
export async function thumbnailUrl(setId: number | string, track = 0): Promise<string> {
	const set = get(mapDataStore)[setId];
	if (track > 0 && set) {
		const own = trackGroups(set)[track]?.find((map) => map.background)?.background;
		if (own && own !== set.background) {
			const url = await smallImageUrl(own);
			if (url) return url;
		}
	}
	const imagePath = set?.thumbnail;
	return (
		(imagePath && (await localImageUrl(imagePath))) ||
		`https://assets.ppy.sh/beatmaps/${setId}/covers/list@2x.jpg`
	);
}
