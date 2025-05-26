// This is a dedicated worker for processing beatmaps using ES modules

import JSZip from 'jszip';

// Message counter to track request/response pairs
let messageId = 0;
const pendingRequests = new Map();

// Helper function to send a request to the main thread and wait for response
async function sendRequestToMain(type, data) {
	return new Promise((resolve, reject) => {
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
			// Extract the beatmap
			const result = await extractAudioFromBeatmap(
				data.buffer,
				data.mapId,
				data.setId,
				data.mapsetData,
				data.homeDir,
				data.mapSetsDir
			);

			self.postMessage(
				{
					type: 'extract-complete',
					audioBase64: result.audioData,
					audioPath: result.audioPath,
					beatmapId: result.mapId,
					setId: data.setId
				},
				[result.audioData.buffer]
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

// Mock file system APIs that communicate with main thread
const fs = {
	mkdir: async (dir) => sendRequestToMain('mkdir', { dir }),
	exists: async (path) => sendRequestToMain('exists', { path }),
	writeFile: async (path, data) => sendRequestToMain('writeFile', { path, data }),
	readFile: async (path) => sendRequestToMain('readFile', { path }),
	readTextFile: async (path) => sendRequestToMain('readTextFile', { path }),
	remove: async (path) => sendRequestToMain('remove', { path }),
	path: {
		join: async (...paths) => sendRequestToMain('path_join', { paths })
	}
};

// FFmpeg wrapper that sends conversion requests to main thread
const ffmpeg = {
	convertToOpus: async (inputPath, targetPath) =>
		sendRequestToMain('convertToOpus', { inputPath, targetPath })
};

// Now implement the full extraction logic
async function extractAudioFromBeatmap(
	mapsetBuffer,
	mapId,
	setId,
	mapsetData,
	homeDir,
	mapSetsDir
) {
	try {
		// Report progress
		self.postMessage({ type: 'progress', progress: 30, setId });

		// Create extraction directory
		const extractDir = await fs.path.join(
			homeDir + '/Stosufy/extract',
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
		const extractPromises = [];
		const osuFiles = [];
		const filenameMap = new Map();

		// Sanitize function
		const sanitizeFilename = (filename) => {
			// Your sanitization logic from data.ts
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
			sanitized = sanitized.replace('', '');
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

		// Process .osu files to find audio files
		const audioFileMap = new Map();
		let foundMapId = 0;

		for (const osuFile of osuFiles) {
			const content = await fs.readTextFile(osuFile);

			// Extract beatmap ID and audio filename
			const beatmapIdMatch = content.match(/BeatmapID:(\d+)/);
			const audioFileMatch = content.match(/AudioFilename:(.+)/);

			if (beatmapIdMatch && audioFileMatch) {
				const beatmapId = beatmapIdMatch[1].trim();
				foundMapId = beatmapId;
				let audioFileName = audioFileMatch[1].trim();

				// Check if filename needed sanitization
				for (const [original, sanitized] of filenameMap.entries()) {
					if (original.endsWith(audioFileName)) {
						audioFileName = sanitized.substring(sanitized.lastIndexOf('/') + 1);
						break;
					}
				}

				audioFileMap.set(beatmapId, audioFileName);
			}
		}

		self.postMessage({ type: 'progress', progress: 70, setId });

		// Convert audio files
		const convertedAudioFiles = new Set();
		const uniqueAudioFiles = new Set(audioFileMap.values());

		for (const audioFileName of uniqueAudioFiles) {
			const audioFilePath = await fs.path.join(extractDir, audioFileName);

			if (await fs.exists(audioFilePath)) {
				const targetPath = await fs.path.join(mapSetsDir, `${setId}-${foundMapId}.opus`);
				await ffmpeg.convertToOpus(audioFilePath, targetPath);
				convertedAudioFiles.add(targetPath);
			}
		}

		// Clean up
		await fs.remove(extractDir);

		// Return first converted audio file
		if (convertedAudioFiles.size > 0) {
			const firstAudioPath = [...convertedAudioFiles][0];
			const audioData = await fs.readFile(firstAudioPath);
			return {
				audioData,
				audioPath: firstAudioPath, // Add the path
				mapId: foundMapId // Add the map ID that this audio belongs to
			};
		}

		return null;
	} catch (error) {
		console.error('Error in worker extractAudioFromBeatmap:', error);
		throw error;
	}
}

// Explicitly mark as module worker
export {};
