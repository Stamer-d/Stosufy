// One file made into another format: which code does it (pictures, audio and video, data,
// text, archives), what comes out (one file, or the files of an unpacked archive), and with a
// size limit: bitrates from how long it is (never more than the file has), tried again
// smaller when it's still too big, and never made bigger than it was.

import JSZip from 'jszip';
import { baseName, extensionOf, kindOf, type Format, type Target } from '../files/formats';
import {
	discard,
	probe,
	runFfmpeg,
	stopIfCancelled,
	type Made,
	type Probe,
	type RunOptions
} from '../files/ffmpeg';
import { nativeFfmpeg } from '../files/native';
import {
	audioArgs,
	audioKbps,
	gifArgs,
	GIF_QUALITY,
	LOSSY_AUDIO,
	canRepack,
	repackArgs,
	videoArgs,
	type Quality
} from '../files/presets';
import { convertImage } from '../files/image';
import { parseData, stringifyData } from './data';
import { convertText } from './text';
import { sizeText } from '../files/size';

export { sizeText };

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
	/** Its bytes, what FFmpeg made, or (an unpacked archive's) a way to get its bytes */
	what: Uint8Array | Made | (() => Promise<Uint8Array>);
}

export interface Converted {
	outputs: Output[];
	/** Something to know about it (it couldn't be made small enough, …) */
	note?: string;
}

const IMAGE_QUALITY: Record<Quality, number> = { small: 0.7, balanced: 0.86, best: 0.95 };
/** Said of a video put into another format as it was */
export const REPACKED = 'Repacked as it was: nothing re-encoded, nothing lost';

const MB = 1024 * 1024;
/** The most the WebAssembly FFmpeg can hold (the file and what it makes, in its memory) */
const WASM_LIMIT = 1.5 * 1024 * MB;
/** The most made into Base64 (four times as big, as text, in memory) and into a ZIP */
const BASE64_LIMIT = 100 * MB;
const ZIP_LIMIT = 1024 * MB;

const encoder = new TextEncoder();

/** The text in a file: UTF-16 by its first bytes, else UTF-8, else Latin-1 */
async function readText(file: Blob) {
	const data = new Uint8Array(await file.arrayBuffer());
	// (UTF-16, as Excel's "Unicode text" and Notepad write it)
	if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
	if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
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
	const kind = kindOf(format);
	const limit = options.maxBytes;
	const smaller = target.group === 'Smaller';
	const one = (what: Uint8Array | Made | string, note?: string): Converted => ({
		outputs: [
			{
				name: target.id === 'base64' ? `${file.name}.txt` : `${name}.${target.extension}`,
				what: typeof what === 'string' ? encoder.encode(what) : what
			}
		],
		note
	});
	const original = async (note: string) => one(new Uint8Array(await file.arrayBuffer()), note);

	// Already small enough: kept as it is (made again, it could only be worse, or bigger)
	if (smaller && limit && file.size <= limit)
		return original(`Already under ${sizeText(limit)}: kept as it was`);

	const converted = await make();
	stopIfCancelled(id);
	// Made smaller, but it isn't: the original's better
	if (smaller && converted.outputs.length === 1) {
		const what = converted.outputs[0].what;
		if (typeof what !== 'function') {
			const size = what instanceof Uint8Array ? what.length : sizeOf(what);
			if (size >= file.size) {
				if (!(what instanceof Uint8Array)) await discard(what);
				return original(tooBig(limit));
			}
		}
	}
	return converted;

	async function make(): Promise<Converted> {
		if (target.id === 'base64') {
			if (file.size > BASE64_LIMIT) throw new Error('Too big for Base64 (at most 100 MB)');
			return one(base64(new Uint8Array(await file.arrayBuffer())));
		}
		if (target.id === 'zip') {
			if (file.size > ZIP_LIMIT) throw new Error('Too big to zip here (at most 1 GB)');
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
			for (const entry of entries) {
				// (no way out of the archive's folder)
				const path = entry.name
					.split(/[\\/]/)
					.filter((part) => part && part !== '.' && part !== '..')
					.join('/');
				// (unpacked when it's saved: one at a time, not all of them in memory)
				if (path) outputs.push({ name: `${name}/${path}`, what: () => entry.async('uint8array') });
			}
			return { outputs };
		}

		switch (kind) {
			case 'image': {
				// (an animated GIF made smaller, or into a video: through FFmpeg, every frame kept)
				if (format?.id === 'gif' && (target.id === 'gif' || target.group === 'Video')) {
					const info = await probe(file, extension, id);
					const run: RunOptions = { progress, duration: info.duration, id };
					return target.id === 'gif' ? gif(run, info.width) : video(info, run);
				}
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
				// (how long it is: for the progress of the native one, and for a size limit; what's
				// in a video: whether it can be repacked as it is)
				const info = native || limit || kind === 'video' ? await probe(file, extension, id) : null;
				const run: RunOptions = { progress, duration: info?.duration, id };
				const audioOnly = kind === 'audio' || target.group === 'Only the sound';
				if (audioOnly) return sound(info, run, kind === 'audio');
				if (target.id === 'gif') return gif(run);
				return video(info, run);
			}
			case 'data': {
				// (from table to table, every cell stays as it's written)
				const typed = !['csv', 'tsv'].includes(target.id);
				return one(stringifyData(parseData(await readText(file), format!.id, typed), target.id));
			}
			case 'text':
				return one(convertText(await readText(file), format!.id, target.id, name));
		}
		throw new Error(`Can't make ${target.label} of this file`);
	}

	// --- Sound, videos and GIFs (in a size limit, when there's one) --------------------------

	async function sound(info: Probe | null, run: RunOptions, fromAudio: boolean) {
		let kbps: number | undefined;
		if (limit && info?.duration && LOSSY_AUDIO.has(target.id)) {
			const fits = (limit * 8) / 1000 / info.duration;
			// (a little under it: the container and the cover take some too; and not more than
			// the file has, which would only make it bigger)
			const own = (file.size * 8) / 1000 / info.duration;
			const wanted = Math.floor(Math.min(fits * 0.93, own));
			if (wanted < audioKbps(target.id, options.quality)) kbps = Math.max(24, wanted);
		}
		// Its cover kept where the format holds one (without it, if that doesn't work)
		const cover = fromAudio && (info?.cover ?? true);
		const make = (cover: boolean) =>
			runFfmpeg(
				file,
				extension,
				audioArgs(target.id, options.quality, { cover, kbps }),
				target.extension,
				run
			);
		const made = await make(cover).catch((error) => {
			if (!cover || error?.name === 'Cancelled') throw error;
			return make(false);
		});
		const size = sizeOf(made);
		const note =
			!limit || size <= limit
				? undefined
				: LOSSY_AUDIO.has(target.id)
					? tooBig(limit)
					: `${target.label} can't be made smaller: MP3 can`;
		return one(made, note);
	}

	async function video(info: Probe | null, run: RunOptions) {
		// Its picture and sound fit as they are: repacked, in seconds, nothing lost (made again
		// if FFmpeg can't)
		if (!limit && info && canRepack(target.id, info, options.videoHeight)) {
			try {
				const made = await runFfmpeg(
					file,
					extension,
					repackArgs(target.id, info),
					target.extension,
					run
				);
				return one(made, REPACKED);
			} catch (error) {
				if (error instanceof Error && error.name === 'Cancelled') throw error;
				stopIfCancelled(id);
			}
		}
		if (!limit || !info?.duration) {
			const made = await runFfmpeg(
				file,
				extension,
				videoArgs(target.id, options.quality, { height: options.videoHeight, fps: info?.fps }),
				target.extension,
				run
			);
			// (a limit, but no length to aim with: said if it's over)
			return one(made, limit && sizeOf(made) > limit ? tooBig(limit) : undefined);
		}
		// The bitrate that fits: a little under it, the sound's share first, and not more than
		// the file has (that would only make it bigger)
		const own = (file.size * 8) / 1000 / info.duration;
		const total = Math.min(((limit * 8) / 1000 / info.duration) * 0.92, own);
		const audio = info.audio ? Math.min(128, Math.max(48, Math.round(total * 0.12))) : 0;
		let videoKbps = Math.max(60, total - audio);
		let made: Made | null = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			// (fewer lines where there are few bits for them)
			const fit = videoKbps < 350 ? 360 : videoKbps < 800 ? 480 : videoKbps < 1800 ? 720 : 1080;
			const height = options.videoHeight ? Math.min(options.videoHeight, fit) : fit;
			if (made) await discard(made);
			stopIfCancelled(id);
			made = await runFfmpeg(
				file,
				extension,
				videoArgs(target.id, options.quality, {
					height,
					videoKbps,
					audioKbps: audio || undefined,
					fps: info.fps
				}),
				target.extension,
				run
			);
			const size = sizeOf(made);
			if (size <= limit) return one(made);
			videoKbps = Math.max(40, videoKbps * (limit / size) * 0.9);
		}
		return one(made!, tooBig(limit));
	}

	/** A GIF (`ownWidth`: of a GIF made smaller, its width to start from) */
	async function gif(run: RunOptions, ownWidth = 0) {
		let { fps, width } = GIF_QUALITY[options.quality];
		if (ownWidth) width = ownWidth;
		let made: Made | null = null;
		for (let attempt = 0; attempt < (limit ? 5 : 1); attempt++) {
			if (made) await discard(made);
			stopIfCancelled(id);
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
