// One file made into another format: which code does it (pictures, audio and video, data,
// text, archives), what comes out (one file, or the files of an unpacked archive), and with a
// size limit: bitrates from how long it is, tried again smaller when it's still too big.

import JSZip from 'jszip';
import { baseName, extensionOf, kindOf, type Format, type Target } from '../files/formats';
import { discard, probe, runFfmpeg, type Made, type Probe, type RunOptions } from '../files/ffmpeg';
import { nativeFfmpeg } from '../files/native';
import {
	audioArgs,
	audioKbps,
	gifArgs,
	GIF_QUALITY,
	LOSSY_AUDIO,
	videoArgs,
	type Quality
} from '../files/presets';
import { convertImage } from '../files/image';
import { parseData, stringifyData } from './data';
import { convertText } from './text';

export interface ConvertOptions {
	quality: Quality;
	/** Pictures: the longest side at most (0: as it is) */
	imageSize: number;
	/** Videos: at most this many lines high (0: as it is) */
	videoHeight: number;
	/** At most this many bytes per file (0: no limit) */
	maxBytes: number;
}

export interface Output {
	/** Its name, maybe in a folder (an unpacked archive's) */
	name: string;
	what: Uint8Array | Made;
}

export interface Converted {
	outputs: Output[];
	/** Something to know about it (it couldn't be made small enough, …) */
	note?: string;
}

const IMAGE_QUALITY: Record<Quality, number> = { small: 0.7, balanced: 0.86, best: 0.95 };

/** The most the WebAssembly FFmpeg can hold (the file and what it makes, in its memory) */
const WASM_LIMIT = 1.5 * 1024 ** 3;

const encoder = new TextEncoder();

/** The text in a file, as UTF-8 (or Latin-1 when it isn't) */
async function readText(file: Blob) {
	const data = new Uint8Array(await file.arrayBuffer());
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(data);
	} catch {
		return new TextDecoder('windows-1252').decode(data);
	}
}

function base64(data: Uint8Array) {
	let text = '';
	for (let i = 0; i < data.length; i += 0x8000)
		text += String.fromCharCode(...data.subarray(i, i + 0x8000));
	// (in lines of 76, as e-mails and most tools write it)
	return btoa(text).replace(/.{76}/g, '$&\n') + '\n';
}

export function sizeText(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? +value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const sizeOf = (made: Made) => ('data' in made ? made.data.length : made.size);
const tooBig = (limit: number) => `Couldn't get it under ${sizeText(limit)}`;

export async function convertFile(
	file: File,
	format: Format | null,
	target: Target,
	options: ConvertOptions,
	progress: (share: number) => void,
	/** To stop it (see `cancel` in files/ffmpeg) */
	id?: string
): Promise<Converted> {
	const name = baseName(file.name);
	const extension = extensionOf(file.name);
	const one = (what: Uint8Array | Made | string, note?: string): Converted => ({
		outputs: [
			{
				name: `${name}.${target.extension}`,
				what: typeof what === 'string' ? encoder.encode(what) : what
			}
		],
		note
	});

	if (target.id === 'base64') return one(base64(new Uint8Array(await file.arrayBuffer())));
	if (target.id === 'zip') {
		const zip = new JSZip();
		zip.file(file.name, await file.arrayBuffer());
		return one(
			await zip.generateAsync(
				{ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } },
				(meta) => progress(meta.percent / 100)
			)
		);
	}
	if (target.id === 'unzip') {
		const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => {
			throw new Error('Not a ZIP that can be read (broken, or with a password?)');
		});
		const entries = Object.values(zip.files).filter((entry) => !entry.dir);
		if (!entries.length) throw new Error('The archive is empty');
		const outputs: Output[] = [];
		for (const [i, entry] of entries.entries()) {
			// (no way out of the archive's folder)
			const path = entry.name
				.split(/[\\/]/)
				.filter((part) => part && part !== '.' && part !== '..')
				.join('/');
			if (path) outputs.push({ name: `${name}/${path}`, what: await entry.async('uint8array') });
			progress((i + 1) / entries.length);
		}
		return { outputs };
	}

	const kind = kindOf(format);
	const limit = options.maxBytes;
	switch (kind) {
		case 'image': {
			const data = await convertImage(file, extension, target.id, {
				maxSize: options.imageSize,
				quality: IMAGE_QUALITY[options.quality],
				maxBytes: limit
			});
			return one(data, limit && data.length > limit ? tooBig(limit) : undefined);
		}
		case 'audio':
		case 'video': {
			const native = await nativeFfmpeg();
			if (!native && file.size > WASM_LIMIT)
				throw new Error('Too big to convert here (at most 1.5 GB)');
			// (how long it is: for the progress of the native one, and for a size limit)
			const info = native || limit ? await probe(file, extension) : null;
			const run: RunOptions = { progress, duration: info?.duration, id };
			const audioOnly = kind === 'audio' || target.group === 'Only the sound';
			if (audioOnly) return media(file, extension, target, options, info, run, kind === 'audio');
			if (target.id === 'gif') return gif(file, extension, options, run);
			return video(file, extension, target, options, info, run);
		}
		case 'data':
			return one(stringifyData(parseData(await readText(file), format!.id), target.id));
		case 'text':
			return one(convertText(await readText(file), format!.id, target.id, name));
	}
	throw new Error(`Can't make ${target.label} of this file`);

	// --- Sound, videos and GIFs (in a size limit, when there's one) --------------------------

	async function media(
		file: File,
		extension: string,
		target: Target,
		options: ConvertOptions,
		info: Probe | null,
		run: RunOptions,
		fromAudio: boolean
	): Promise<Converted> {
		let kbps: number | undefined;
		if (limit && info?.duration && LOSSY_AUDIO.has(target.id)) {
			const fits = (limit * 8) / 1000 / info.duration;
			// (a little under it: the container and the cover take some too)
			const wanted = Math.floor(fits * 0.93);
			if (wanted < audioKbps(target.id, options.quality)) kbps = Math.max(24, wanted);
		}
		// Its cover kept where the format holds one (without it, if that doesn't work)
		const cover = fromAudio && (info?.cover ?? true);
		let made: Made;
		try {
			made = await runFfmpeg(
				file,
				extension,
				audioArgs(target.id, options.quality, { cover, kbps }),
				target.extension,
				run
			);
		} catch (error) {
			if (!cover || (error as Error).name === 'Cancelled') throw error;
			made = await runFfmpeg(
				file,
				extension,
				audioArgs(target.id, options.quality, { kbps }),
				target.extension,
				run
			);
		}
		const size = sizeOf(made);
		const note =
			!limit || size <= limit
				? undefined
				: LOSSY_AUDIO.has(target.id)
					? tooBig(limit)
					: `${target.label} can't be made smaller: MP3 can`;
		return one(made, note);
	}

	async function video(
		file: File,
		extension: string,
		target: Target,
		options: ConvertOptions,
		info: Probe | null,
		run: RunOptions
	): Promise<Converted> {
		if (!limit || !info?.duration)
			return one(
				await runFfmpeg(
					file,
					extension,
					videoArgs(target.id, options.quality, { height: options.videoHeight }),
					target.extension,
					run
				)
			);
		// The bitrate that fits: a little under it, the sound's share first
		const total = ((limit * 8) / 1000 / info.duration) * 0.92;
		const audio = info.audio ? Math.min(128, Math.max(48, Math.round(total * 0.12))) : 0;
		let videoKbps = Math.max(60, total - audio);
		let made: Made | null = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			// (fewer lines where there are few bits for them)
			const fit = videoKbps < 350 ? 360 : videoKbps < 800 ? 480 : videoKbps < 1800 ? 720 : 1080;
			const height = options.videoHeight ? Math.min(options.videoHeight, fit) : fit;
			if (made) await discard(made);
			made = await runFfmpeg(
				file,
				extension,
				videoArgs(target.id, options.quality, { height, videoKbps, audioKbps: audio || undefined }),
				target.extension,
				run
			);
			const size = sizeOf(made);
			if (size <= limit) return one(made);
			videoKbps = Math.max(40, videoKbps * (limit / size) * 0.9);
		}
		return one(made!, tooBig(limit));
	}

	async function gif(
		file: File,
		extension: string,
		options: ConvertOptions,
		run: RunOptions
	): Promise<Converted> {
		let { fps, width } = GIF_QUALITY[options.quality];
		let made: Made | null = null;
		for (let attempt = 0; attempt < (limit ? 5 : 1); attempt++) {
			if (made) await discard(made);
			made = await runFfmpeg(file, extension, gifArgs(fps, width), 'gif', run);
			const size = sizeOf(made);
			if (!limit || size <= limit) return one(made);
			const shrink = Math.sqrt(limit / size);
			width = Math.max(120, Math.round(width * Math.min(0.85, shrink)));
			fps = Math.max(6, Math.round(fps * Math.min(0.9, shrink + 0.2)));
		}
		return one(made!, tooBig(limit));
	}
}
