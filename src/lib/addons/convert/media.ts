// Audio and video (and the images a browser can't write) through FFmpeg in WebAssembly: one
// FFmpeg, loaded the first time it's needed (its core comes from the network once, then from
// the cache), doing one file at a time. Ended when the converter has nothing left to do.

import { FFmpeg } from '@ffmpeg/ffmpeg';

export type Quality = 'small' | 'balanced' | 'best';

let instance: Promise<FFmpeg> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let busy = 0;
let log: string[] = [];
let onProgress: ((share: number) => void) | null = null;

function ffmpeg() {
	instance ??= (async () => {
		const made = new FFmpeg();
		made.on('log', ({ message }) => {
			log.push(message);
			if (log.length > 40) log.shift();
		});
		made.on('progress', ({ progress }) => {
			if (progress >= 0 && progress <= 1) onProgress?.(progress);
		});
		await made.load();
		return made;
	})().catch((error) => {
		instance = null;
		throw new Error(`Couldn't start the converter (${error?.message ?? error})`);
	});
	return instance;
}

/** Ends FFmpeg when nothing is being converted (it holds on to a lot of memory) */
export async function releaseMedia() {
	if (busy || !instance) return;
	const done = instance;
	instance = null;
	(await done.catch(() => null))?.terminate();
}

/**
 * Runs FFmpeg on one file: `args` between the input and the output name. Returns what it
 * wrote. `progress` gets 0–1 as it goes.
 */
export function runFfmpeg(
	input: Uint8Array,
	inputExtension: string,
	args: string[],
	outputExtension: string,
	progress?: (share: number) => void
): Promise<Uint8Array> {
	busy++;
	const run = queue.then(async () => {
		const ff = await ffmpeg();
		const id = Math.random().toString(36).slice(2, 8);
		const from = `in-${id}.${inputExtension || 'bin'}`;
		const to = `out-${id}.${outputExtension}`;
		log = [];
		onProgress = progress ?? null;
		try {
			await ff.writeFile(from, input);
			const code = await ff.exec(['-hide_banner', '-y', '-i', from, ...args, to]);
			if (code !== 0) throw new Error(explain(log));
			const data = (await ff.readFile(to)) as Uint8Array;
			if (!data.length) throw new Error('The result was empty');
			return data;
		} finally {
			onProgress = null;
			await ff.deleteFile(from).catch(() => {});
			await ff.deleteFile(to).catch(() => {});
		}
	});
	queue = run.catch(() => {}).finally(() => busy--);
	return run;
}

/** What FFmpeg said went wrong, in a line */
function explain(lines: string[]) {
	const said = lines
		.map((line) => line.trim())
		.filter((line) =>
			/invalid|error|not supported|unknown|could not|no such|does not contain|failed/i.test(line)
		)
		.at(-1);
	if (
		/does not contain any stream|matches no streams|Output file .* does not contain/i.test(
			said ?? ''
		)
	)
		return 'The file has nothing of that kind in it (no sound, no picture?)';
	if (/Invalid data found/i.test(said ?? '')) return "The file couldn't be read: is it broken?";
	return said ? `The converter said: ${said.replace(/^\[[^\]]*\]\s*/, '')}` : "Couldn't convert it";
}

const AUDIO: Record<string, (quality: Quality) => string[]> = {
	mp3: (q) => ['-c:a', 'libmp3lame', '-b:a', { small: '128k', balanced: '192k', best: '320k' }[q]],
	ogg: (q) => ['-c:a', 'libvorbis', '-q:a', { small: '3', balanced: '5', best: '8' }[q]],
	opus: (q) => ['-c:a', 'libopus', '-b:a', { small: '64k', balanced: '128k', best: '192k' }[q]],
	m4a: (q) => ['-c:a', 'aac', '-b:a', { small: '128k', balanced: '192k', best: '256k' }[q]],
	flac: () => ['-c:a', 'flac'],
	wav: () => ['-c:a', 'pcm_s16le'],
	aiff: () => ['-c:a', 'pcm_s16be']
};

/** FFmpeg's arguments for a file's sound alone, in this format */
export function audioArgs(target: string, quality: Quality) {
	return ['-map', '0:a:0', '-vn', '-sn', ...AUDIO[target](quality)];
}

/** Scaled to at most this many lines high (0: as it is), a width that divides by 2 */
function scale(height: number) {
	return height ? `scale=-2:'min(${height},ih)'` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
}

/** FFmpeg's arguments for a video in this format, at most `height` high (0: as it is) */
export function videoArgs(target: string, quality: Quality, height: number) {
	const video = ['-map', '0:v:0', '-map', '0:a:0?', '-sn'];
	const crf = { small: '30', balanced: '23', best: '18' }[quality];
	const aac = ['-c:a', 'aac', '-b:a', { small: '128k', balanced: '160k', best: '192k' }[quality]];
	const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p'];
	switch (target) {
		case 'mp4':
		case 'mov':
			return [...video, '-vf', scale(height), ...h264, ...aac, '-movflags', '+faststart'];
		case 'mkv':
			return [...video, '-vf', scale(height), ...h264, ...aac];
		case 'webm':
			return [
				...video,
				'-vf',
				scale(height),
				'-c:v',
				'libvpx',
				'-deadline',
				'realtime',
				'-cpu-used',
				'5',
				'-crf',
				{ small: '30', balanced: '16', best: '8' }[quality],
				'-b:v',
				{ small: '1M', balanced: '2500k', best: '6M' }[quality],
				'-c:a',
				'libvorbis',
				'-q:a',
				'5'
			];
		case 'avi':
			return [
				...video,
				'-vf',
				scale(height),
				'-c:v',
				'mpeg4',
				'-q:v',
				{ small: '8', balanced: '5', best: '2' }[quality],
				'-c:a',
				'libmp3lame',
				'-b:a',
				'192k'
			];
		case 'gif': {
			const fps = { small: 10, balanced: 15, best: 20 }[quality];
			const width = { small: 320, balanced: 480, best: 720 }[quality];
			return [
				'-map',
				'0:v:0',
				'-an',
				'-vf',
				`fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
				'-loop',
				'0'
			];
		}
	}
	throw new Error(`Can't make ${target} videos`);
}

/** FFmpeg's arguments for a picture in a format the browser can't write (GIF, TIFF, WebP) */
export function imageArgs(target: string, quality: number) {
	switch (target) {
		case 'gif':
			return ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-frames:v', '1'];
		case 'tiff':
			return ['-c:v', 'tiff', '-compression_algo', 'deflate', '-frames:v', '1'];
		case 'webp':
			return ['-c:v', 'libwebp', '-quality', String(Math.round(quality * 100)), '-frames:v', '1'];
		case 'png':
			return ['-frames:v', '1'];
	}
	throw new Error(`Can't make ${target} pictures`);
}
