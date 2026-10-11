// Dedicated module worker that extracts the audio of a downloaded beatmap set.
// File system access and the opus conversion are delegated to the main thread.

import JSZip from 'jszip';
import { parseOsuFile, type OsuFileInfo } from '../osuFile.ts';
import { extractStoryboard } from '../storyboard/extract.ts';

// Message counter to track request/response pairs
let messageId = 0;
const pendingRequests = new Map<
	number,
	{ resolve: (value: any) => void; reject: (error: Error) => void }
>();

// Sends a request to the main thread and waits for its response
function sendRequestToMain<T>(type: string, data: Record<string, unknown>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const id = messageId++;
		pendingRequests.set(id, { resolve, reject });
		self.postMessage({ type: 'fs_request', requestId: id, operation: type, data });
	});
}

// Handle messages from main thread
self.onmessage = async function (event) {
	const { type, data, requestId, error, result } = event.data;

	// Handle response to our file system requests
	if (type === 'fs_response') {
		const request = pendingRequests.get(requestId);
		if (request) {
			pendingRequests.delete(requestId);
			if (error) {
				request.reject(new Error(error));
			} else {
				request.resolve(result);
			}
		}
		return;
	}

	// Handle extraction request
	if (type === 'extract') {
		try {
			const result = await extractAudioFromBeatmap(
				data.buffer,
				data.mapId,
				data.setId,
				data.homeDir,
				data.mapSetsDir
			);
			if (!result) {
				throw new Error('No audio file found in beatmap set');
			}

			self.postMessage(
				{
					type: 'extract-complete',
					audioBase64: result.audioData,
					audioPath: result.audioPath,
					backgroundPath: result.backgroundPath,
					video: result.video,
					timing: result.timing,
					maps: result.maps,
					storyboard: result.storyboard,
					hitsounds: result.hitsounds,
					beatmapId: result.mapId,
					setId: data.setId
				},
				{ transfer: [result.audioData.buffer] }
			);
		} catch (error) {
			console.error('Worker error:', error);
			self.postMessage({
				type: 'error',
				error: error.toString(),
				setId: data.setId
			});
		}
	}
};

// File system APIs that are executed by the main thread
const fs = {
	mkdir: (dir: string) => sendRequestToMain<boolean>('mkdir', { dir }),
	exists: (path: string) => sendRequestToMain<boolean>('exists', { path }),
	writeFile: (path: string, data: ArrayBuffer | Uint8Array) =>
		sendRequestToMain<boolean>('writeFile', { path, data }),
	readFile: (path: string) => sendRequestToMain<Uint8Array<ArrayBuffer>>('readFile', { path }),
	readTextFile: (path: string) => sendRequestToMain<string>('readTextFile', { path }),
	remove: (path: string) => sendRequestToMain<boolean>('remove', { path }),
	path: {
		join: (...paths: string[]) => sendRequestToMain<string>('path_join', { paths })
	}
};

// FFmpeg wrapper that sends conversion requests to main thread
const ffmpeg = {
	convertToOpus: (inputPath: string, targetPath: string) =>
		sendRequestToMain<boolean>('convertToOpus', { inputPath, targetPath })
};

async function extractAudioFromBeatmap(
	mapsetBuffer: ArrayBuffer,
	mapId: number | string,
	setId: string,
	homeDir: string,
	mapSetsDir: string
) {
	try {
		// Report progress
		self.postMessage({ type: 'progress', progress: 30, setId });

		const extractDir = await fs.path.join(
			homeDir,
			'Stosufy',
			'extract',
			`osu-extract-${Date.now()}`
		);
		await fs.mkdir(extractDir);

		// Write zip to file
		const zipPath = await fs.path.join(extractDir, 'beatmap.osz');
		await fs.writeFile(zipPath, mapsetBuffer);

		// Read and extract zip
		const zipData = await fs.readFile(zipPath);
		const zip = await JSZip.loadAsync(zipData);

		self.postMessage({ type: 'progress', progress: 50, setId });

		// Extract all files
		const extractPromises: Promise<void>[] = [];
		const osuFiles: string[] = [];
		const filenameMap = new Map<string, string>();

		const sanitizeFilename = (filename: string) => {
			let sanitized = filename.replace(/[\\/:*?"<>|[\]]/g, '_');
			sanitized = sanitized.replace(/[\u2013\u2014\u2015\u2017\u2020\u2021]/g, '-');
			sanitized = sanitized.replace(/[^\x00-\x7F]/g, '_');

			if (sanitized.length > 150) {
				const extension = sanitized.includes('.')
					? sanitized.substring(sanitized.lastIndexOf('.'))
					: '';
				const basename = sanitized.includes('.')
					? sanitized.substring(0, sanitized.lastIndexOf('.'))
					: sanitized;
				sanitized = basename.substring(0, 150 - extension.length) + extension;
			}

			sanitized = sanitized.replace(/[_\-]{2,}/g, '_');
			return sanitized;
		};

		// Extract files
		for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
			if (zipEntry.dir) continue;

			const isOsuFile = relativePath.endsWith('.osu');
			const isPotentialAudioFile = /\.(mp3|ogg|wav)$/i.test(relativePath);

			if (!isOsuFile && !isPotentialAudioFile) continue;

			// Process each file
			extractPromises.push(
				(async () => {
					const sanitizedPath = sanitizeFilename(relativePath);
					const extractPath = await fs.path.join(extractDir, sanitizedPath);

					filenameMap.set(relativePath, sanitizedPath);

					if (isOsuFile) {
						osuFiles.push(extractPath);
					}

					// Create directories if needed
					const lastSlashIndex = extractPath.lastIndexOf('/');
					if (lastSlashIndex > 0) {
						await fs.mkdir(extractPath.substring(0, lastSlashIndex));
					}

					// Write the file
					const fileData = await zipEntry.async('uint8array');
					await fs.writeFile(extractPath, fileData);
				})()
			);
		}

		// Wait for all extractions
		await Promise.all(extractPromises);

		self.postMessage({ type: 'progress', progress: 60, setId });

		// Read every difficulty: a set can have a different song and background per difficulty
		const diffs: (Omit<OsuFileInfo, 'beatmapId'> & {
			beatmapId: number | string;
			content: string;
		})[] = [];
		for (const osuFile of osuFiles) {
			const content = await fs.readTextFile(osuFile);
			const info = parseOsuFile(content);
			if (info.audioFile) diffs.push({ ...info, beatmapId: info.beatmapId ?? mapId, content });
		}

		self.postMessage({ type: 'progress', progress: 70, setId });

		// The extracted file of an audio or image name from a .osu file (names were sanitized)
		const extractedName = (name: string) => {
			for (const [original, sanitized] of filenameMap.entries()) {
				if (original.toLowerCase().endsWith(name.toLowerCase())) {
					return sanitized.substring(sanitized.lastIndexOf('/') + 1);
				}
			}
			return name;
		};

		// Convert each song once, named after the first difficulty that uses it
		const audioPaths = new Map<string, string>();
		for (const diff of diffs) {
			const name = diff.audioFile.toLowerCase();
			if (audioPaths.has(name)) continue;
			const sourcePath = await fs.path.join(extractDir, extractedName(diff.audioFile));
			if (!(await fs.exists(sourcePath))) continue;
			const targetPath = await fs.path.join(mapSetsDir, `${setId}-${diff.beatmapId}.opus`);
			await ffmpeg.convertToOpus(sourcePath, targetPath);
			audioPaths.set(name, targetPath);
		}

		// Save each background once, next to the audio
		const backgroundPaths = new Map<string, string>();
		for (const diff of diffs) {
			const name = diff.background?.toLowerCase();
			if (!name || backgroundPaths.has(name)) continue;
			const entry = Object.values(zip.files).find(
				(file) => !file.dir && file.name.toLowerCase() === name
			);
			const extension = name.split('.').pop();
			if (!entry || !['jpg', 'jpeg', 'png'].includes(extension)) continue;
			// The first background keeps the old name, so older code and data still match
			const suffix = backgroundPaths.size ? `-${diff.beatmapId}` : '';
			const backgroundPath = await fs.path.join(mapSetsDir, `${setId}-bg${suffix}.${extension}`);
			await fs.writeFile(backgroundPath, await entry.async('uint8array'));
			backgroundPaths.set(name, backgroundPath);
		}

		// What each difficulty uses
		const maps: Record<string, Record<string, unknown>> = {};
		for (const diff of diffs) {
			maps[diff.beatmapId] = {
				audioPath: audioPaths.get(diff.audioFile.toLowerCase()) ?? null,
				backgroundPath: backgroundPaths.get(diff.background?.toLowerCase()) ?? null,
				title: diff.title,
				artist: diff.artist,
				timing: diff.timingPoints,
				kiai: diff.kiai
			};
		}
		const first = diffs[0];
		const backgroundPath = first
			? (backgroundPaths.get(first.background?.toLowerCase()) ?? null)
			: null;
		const video = diffs.find((diff) => diff.video)?.video ?? null;
		const timing = first?.timingPoints ?? null;

		// Save the video as it is; formats the webview can't play are converted afterwards
		let savedVideo: { path: string; offset: number } | null = null;
		if (video) {
			const entry = Object.values(zip.files).find(
				(file) => !file.dir && file.name.toLowerCase() === video.file.toLowerCase()
			);
			const extension = video.file.split('.').pop().toLowerCase();
			if (entry && /^[a-z0-9]{2,4}$/.test(extension)) {
				const videoPath = await fs.path.join(mapSetsDir, `${setId}-video.${extension}`);
				await fs.writeFile(videoPath, await entry.async('uint8array'));
				savedVideo = { path: videoPath, offset: video.offset };
			}
		}

		// The storyboard: its scripts and the images it uses
		const storyboard = await extractStoryboard(zip, setId, diffs, mapSetsDir, {
			join: (...paths) => fs.path.join(...paths),
			mkdir: (dir) => fs.mkdir(dir),
			writeFile: (path, data) => fs.writeFile(path, data)
		});
		for (const [beatmapId, osuFile] of Object.entries(storyboard?.osuFiles ?? {})) {
			if (maps[beatmapId]) maps[beatmapId].osuFile = osuFile;
		}

		// The hitsounds: each difficulty's .osu file and the beatmap's own samples (small audio
		// files next to the .osu files that aren't a song)
		const hitsoundDir = await fs.path.join(mapSetsDir, `${setId}-hitsounds`);
		await fs.mkdir(hitsoundDir);
		for (const diff of diffs) {
			const chartFile = await fs.path.join(hitsoundDir, `${diff.beatmapId}.osu`);
			await fs.writeFile(chartFile, new TextEncoder().encode(diff.content));
			if (maps[diff.beatmapId]) maps[diff.beatmapId].chartFile = chartFile;
		}
		const songFiles = new Set(diffs.map((diff) => diff.audioFile.toLowerCase()));
		for (const entry of Object.values(zip.files)) {
			const name = entry.name;
			if (entry.dir || name.includes('/') || !/\.(wav|ogg|mp3)$/i.test(name)) continue;
			if (songFiles.has(name.toLowerCase())) continue;
			const data = await entry.async('uint8array');
			if (data.byteLength > 2 * 1024 * 1024) continue;
			await fs.writeFile(await fs.path.join(hitsoundDir, sanitizeFilename(name)), data);
		}

		// Clean up
		await fs.remove(extractDir);

		// Return the audio of the requested difficulty (or the first one) to play it right away
		const audioPath =
			(maps[mapId] as { audioPath?: string } | undefined)?.audioPath ?? [...audioPaths.values()][0];
		if (audioPath) {
			const audioData = await fs.readFile(audioPath);
			return {
				audioData,
				audioPath,
				backgroundPath,
				video: savedVideo,
				timing,
				maps,
				storyboard: storyboard && { dir: storyboard.dir, osb: storyboard.osb },
				hitsounds: { dir: hitsoundDir },
				mapId: first.beatmapId
			};
		}

		return null;
	} catch (error) {
		console.error('Error in worker extractAudioFromBeatmap:', error);
		throw error;
	}
}

export {};
