// One file made into another format: which code does it (pictures, audio and video, data,
// text, archives), and what comes out (one file, or the files of an unpacked archive).

import JSZip from 'jszip';
import { baseName, extensionOf, kindOf, type Format, type Target } from './formats';
import { audioArgs, runFfmpeg, videoArgs, type Quality } from './media';
import { convertImage } from './image';
import { parseData, stringifyData } from './data';
import { convertText } from './text';

export interface ConvertOptions {
	quality: Quality;
	/** Pictures: the longest side at most (0: as it is) */
	imageSize: number;
	/** Videos: at most this many lines high (0: as it is) */
	videoHeight: number;
}

export interface Output {
	/** Its name, maybe in a folder (an unpacked archive's) */
	name: string;
	data: Uint8Array;
}

const IMAGE_QUALITY: Record<Quality, number> = { small: 0.7, balanced: 0.86, best: 0.95 };

/** The most FFmpeg can hold (it keeps the file and what it makes in its memory) */
const MEDIA_LIMIT = 1.5 * 1024 ** 3;

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

export async function convertFile(
	file: File,
	format: Format | null,
	target: Target,
	options: ConvertOptions,
	progress: (share: number) => void
): Promise<Output[]> {
	const name = baseName(file.name);
	const extension = extensionOf(file.name);
	const out = (data: Uint8Array | string, ext = target.extension) => [
		{ name: `${name}.${ext}`, data: typeof data === 'string' ? encoder.encode(data) : data }
	];

	if (target.id === 'base64') return out(base64(new Uint8Array(await file.arrayBuffer())));
	if (target.id === 'zip') {
		const zip = new JSZip();
		zip.file(file.name, await file.arrayBuffer());
		return out(
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
		const files: Output[] = [];
		for (const [i, entry] of entries.entries()) {
			// (no way out of the archive's folder)
			const path = entry.name
				.split(/[\\/]/)
				.filter((part) => part && part !== '.' && part !== '..')
				.join('/');
			if (path) files.push({ name: `${name}/${path}`, data: await entry.async('uint8array') });
			progress((i + 1) / entries.length);
		}
		return files;
	}

	const kind = kindOf(format);
	switch (kind) {
		case 'image':
			return out(
				await convertImage(file, extension, target.id, {
					maxSize: options.imageSize,
					quality: IMAGE_QUALITY[options.quality]
				})
			);
		case 'audio':
		case 'video': {
			if (file.size > MEDIA_LIMIT) throw new Error('Too big to convert here (at most 1.5 GB)');
			const audioOnly = kind === 'audio' || target.group === 'Only the sound';
			const args = audioOnly
				? audioArgs(target.id, options.quality)
				: videoArgs(target.id, options.quality, options.videoHeight);
			return out(
				await runFfmpeg(
					new Uint8Array(await file.arrayBuffer()),
					extension,
					args,
					target.extension,
					progress
				)
			);
		}
		case 'data':
			return out(stringifyData(parseData(await readText(file), format!.id), target.id));
		case 'text':
			return out(convertText(await readText(file), format!.id, target.id, name));
	}
	throw new Error(`Can't make ${target.label} of this file`);
}
