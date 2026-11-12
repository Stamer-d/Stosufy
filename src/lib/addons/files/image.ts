// Pictures: read by the browser (PNG, JPG, WebP, GIF, BMP, ICO, SVG, AVIF; what it can't read
// goes through FFmpeg first), drawn on a canvas and written as PNG, JPG or WebP by the browser,
// as BMP, ICO and PDF here, as GIF and TIFF through FFmpeg. With a size limit: lower quality,
// then smaller, until it fits.

import { runFfmpegBytes } from './ffmpeg';
import { imageArgs } from './presets';

/** A picture to write: read from a file, or drawn (the editor's) */
export type Picture = HTMLImageElement | HTMLCanvasElement;

export interface ImageOptions {
	/** The longest side at most (0: as it is) */
	maxSize: number;
	/** 0–1, for JPG and WebP */
	quality: number;
	/** At most this many bytes (0: no limit) */
	maxBytes?: number;
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.decoding = 'async';
		image.src = url;
		await image.decode();
		return image;
	} finally {
		// (decoded: the picture stays usable without its URL)
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

/** The picture in a file, read by the browser or, if it can't, through FFmpeg */
export async function readImage(file: Blob, extension: string): Promise<HTMLImageElement> {
	try {
		const image = await loadImage(
			// (an SVG without its type isn't drawn)
			extension === 'svg' && !file.type ? new Blob([file], { type: 'image/svg+xml' }) : file
		);
		if (image.naturalWidth || image.naturalHeight) return image;
	} catch {
		// read below
	}
	const png = await runFfmpegBytes(
		new Uint8Array(await file.arrayBuffer()),
		extension,
		imageArgs('png', 1),
		'png'
	);
	return loadImage(new Blob([png as BlobPart], { type: 'image/png' }));
}

function naturalSize(picture: Picture) {
	return picture instanceof HTMLImageElement
		? { width: picture.naturalWidth || 1024, height: picture.naturalHeight || 1024 }
		: { width: picture.width, height: picture.height };
}

/** Its size, made smaller to fit `maxSize` (an SVG without one: 1024 on its longest side) */
function sizeOf(picture: Picture, maxSize: number) {
	let { width, height } = naturalSize(picture);
	const longest = Math.max(width, height);
	if (maxSize && longest > maxSize) {
		width = Math.max(1, Math.round((width * maxSize) / longest));
		height = Math.max(1, Math.round((height * maxSize) / longest));
	}
	return { width, height };
}

function draw(picture: Picture, width: number, height: number, background?: string) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d')!;
	if (background) {
		context.fillStyle = background;
		context.fillRect(0, 0, width, height);
	}
	context.imageSmoothingQuality = 'high';
	context.drawImage(picture, 0, 0, width, height);
	return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
	return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function bytes(blob: Blob | null) {
	if (!blob) throw new Error("Couldn't draw the picture");
	return new Uint8Array(await blob.arrayBuffer());
}

/** The picture in `target`'s format, `width` × `height` */
async function encode(
	picture: Picture,
	width: number,
	height: number,
	target: string,
	quality: number
): Promise<Uint8Array> {
	switch (target) {
		case 'png':
			return bytes(await toBlob(draw(picture, width, height), 'image/png'));
		case 'jpg':
			// (JPG has no transparency: white under it)
			return bytes(await toBlob(draw(picture, width, height, '#fff'), 'image/jpeg', quality));
		case 'webp': {
			const canvas = draw(picture, width, height);
			const blob = await toBlob(canvas, 'image/webp', quality);
			// (Safari can't write WebP: it gives a PNG instead)
			if (blob?.type === 'image/webp') return bytes(blob);
			return throughFfmpeg(canvas, 'webp', quality);
		}
		case 'gif':
		case 'tiff':
			return throughFfmpeg(draw(picture, width, height), target, quality);
		case 'bmp':
			return encodeBmp(draw(picture, width, height, '#fff'));
		case 'ico':
			return encodeIco(draw(picture, width, height));
		case 'pdf': {
			const canvas = draw(picture, width, height, '#fff');
			return pdfOfJpeg(await bytes(await toBlob(canvas, 'image/jpeg', quality)), width, height);
		}
	}
	throw new Error(`Can't make ${target} pictures`);
}

/** Formats a lower quality makes smaller */
const LOSSY = new Set(['jpg', 'webp', 'pdf']);

/** A picture written in `target`'s format (within `maxBytes`, if it's given and can be) */
export async function writeImage(
	picture: Picture,
	target: string,
	options: ImageOptions
): Promise<Uint8Array> {
	let { width, height } = sizeOf(picture, options.maxSize);
	const quality = target === 'pdf' ? Math.max(options.quality, 0.9) : options.quality;
	let out = await encode(picture, width, height, target, quality);
	const limit = options.maxBytes ?? 0;
	if (!limit || out.length <= limit || target === 'ico') return out;
	// Lower quality first (down to 0.4), halving the way
	if (LOSSY.has(target)) {
		let low = 0.4;
		let high = quality;
		let best: Uint8Array | null = null;
		for (let step = 0; step < 6; step++) {
			const middle = (low + high) / 2;
			const tried = await encode(picture, width, height, target, middle);
			if (tried.length <= limit) {
				best = tried;
				low = middle;
			} else high = middle;
		}
		if (best) return best;
		out = await encode(picture, width, height, target, 0.4);
	}
	// Then smaller, until it fits (or is tiny)
	for (let step = 0; step < 8 && out.length > limit && Math.max(width, height) > 64; step++) {
		const shrink = Math.min(0.9, Math.sqrt(limit / out.length) * 0.95);
		width = Math.max(1, Math.round(width * shrink));
		height = Math.max(1, Math.round(height * shrink));
		out = await encode(picture, width, height, target, LOSSY.has(target) ? 0.6 : quality);
	}
	return out;
}

/** The picture in a file in `target`'s format */
export async function convertImage(
	file: Blob,
	extension: string,
	target: string,
	options: ImageOptions
): Promise<Uint8Array> {
	return writeImage(await readImage(file, extension), target, options);
}

async function throughFfmpeg(canvas: HTMLCanvasElement, target: string, quality: number) {
	const png = await bytes(await toBlob(canvas, 'image/png'));
	return runFfmpegBytes(png, 'png', imageArgs(target, quality), target);
}

/** A 24-bit BMP (what every program opens) */
function encodeBmp(canvas: HTMLCanvasElement) {
	const { width, height } = canvas;
	const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
	const row = Math.ceil((width * 3) / 4) * 4;
	const size = 54 + row * height;
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	out[0] = 0x42;
	out[1] = 0x4d;
	view.setUint32(2, size, true);
	view.setUint32(10, 54, true);
	view.setUint32(14, 40, true);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	view.setUint16(26, 1, true);
	view.setUint16(28, 24, true);
	view.setUint32(34, row * height, true);
	view.setInt32(38, 2835, true);
	view.setInt32(42, 2835, true);
	for (let y = 0; y < height; y++) {
		// (bottom row first)
		const at = 54 + (height - 1 - y) * row;
		for (let x = 0; x < width; x++) {
			const from = (y * width + x) * 4;
			out[at + x * 3] = pixels[from + 2];
			out[at + x * 3 + 1] = pixels[from + 1];
			out[at + x * 3 + 2] = pixels[from];
		}
	}
	return out;
}

/** An icon with the picture at the usual sizes up to 256 (each a PNG, square, centred) */
async function encodeIco(image: HTMLCanvasElement) {
	const longest = Math.max(image.width, image.height);
	const sizes = [16, 24, 32, 48, 64, 128, 256].filter((size) => size <= Math.max(16, longest));
	const pngs: Uint8Array[] = [];
	for (const size of sizes) {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const context = canvas.getContext('2d')!;
		const ratio = size / longest;
		const w = image.width * ratio;
		const h = image.height * ratio;
		context.imageSmoothingQuality = 'high';
		context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
		const blob = await toBlob(canvas, 'image/png');
		if (!blob) throw new Error("Couldn't draw the picture");
		pngs.push(await bytes(blob));
	}
	const header = 6 + 16 * pngs.length;
	const out = new Uint8Array(header + pngs.reduce((sum, png) => sum + png.length, 0));
	const view = new DataView(out.buffer);
	view.setUint16(2, 1, true);
	view.setUint16(4, pngs.length, true);
	let offset = header;
	pngs.forEach((png, i) => {
		const at = 6 + 16 * i;
		const size = sizes[i];
		out[at] = size === 256 ? 0 : size;
		out[at + 1] = size === 256 ? 0 : size;
		view.setUint16(at + 4, 1, true);
		view.setUint16(at + 6, 32, true);
		view.setUint32(at + 8, png.length, true);
		view.setUint32(at + 12, offset, true);
		out.set(png, offset);
		offset += png.length;
	});
	return out;
}

/** A PDF of one page with the picture on it, as big as the picture (at 96 dpi) */
export function pdfOfJpeg(jpeg: Uint8Array, width: number, height: number) {
	const w = +((width * 72) / 96).toFixed(2);
	const h = +((height * 72) / 96).toFixed(2);
	const text = new TextEncoder();
	const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
	const parts: (string | Uint8Array)[] = [];
	const offsets: number[] = [];
	let length = 0;
	const add = (part: string | Uint8Array) => {
		const data = typeof part === 'string' ? text.encode(part) : part;
		parts.push(data);
		length += data.length;
	};
	const object = (n: number, body: string, stream?: Uint8Array) => {
		offsets[n] = length;
		add(`${n} 0 obj\n${body}\n`);
		if (stream) {
			add('stream\n');
			add(stream);
			add('\nendstream\n');
		}
		add('endobj\n');
	};
	add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
	object(1, '<< /Type /Catalog /Pages 2 0 R >>');
	object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
	object(
		3,
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
	);
	object(
		4,
		`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
		jpeg
	);
	object(5, `<< /Length ${content.length} >>`, text.encode(content));
	const xref = length;
	add(`xref\n0 6\n0000000000 65535 f \n`);
	for (let n = 1; n <= 5; n++) add(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
	add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
	const out = new Uint8Array(length);
	let at = 0;
	for (const part of parts as Uint8Array[]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
