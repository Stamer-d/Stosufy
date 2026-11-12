// What's done to a picture (turned, mirrored, cut to a part, lighter or darker, more or less
// contrast and colour, made smaller), drawn on a canvas and saved in a format: its own or
// another. In ~/Stosufy/Edited.

import { baseName, type Target } from '../files/formats';
import { writeImage } from '../files/image';
import { saveFile, type SavedFile } from '../files/save';
import { FOLDER } from './media';

export interface ImageEdit {
	/** Quarter turns clockwise */
	turns: 0 | 1 | 2 | 3;
	mirrorX: boolean;
	mirrorY: boolean;
	/** The part kept, of the turned picture (0–1) */
	crop: { x: number; y: number; w: number; h: number };
	/** Its width when saved (px, 0: as the part is) */
	width: number;
	/** Lighter or darker, more or less contrast, more or less colour (-100–100, 0: as it is) */
	brightness: number;
	contrast: number;
	saturation: number;
}

export const freshImageEdit = (): ImageEdit => ({
	turns: 0,
	mirrorX: false,
	mirrorY: false,
	crop: { x: 0, y: 0, w: 1, h: 1 },
	width: 0,
	brightness: 0,
	contrast: 0,
	saturation: 0
});

const factor = (value: number) => 1 + value / 100;

/** The adjustments as CSS's filter (for the picture shown: the same as what's saved) */
export function cssFilter(edit: ImageEdit) {
	if (!edit.brightness && !edit.contrast && !edit.saturation) return 'none';
	return `brightness(${factor(edit.brightness)}) contrast(${factor(edit.contrast)}) saturate(${factor(edit.saturation)})`;
}

/**
 * The adjustments on the pixels, as CSS's filters do them (brightness, then contrast, then
 * saturation), so what's saved looks like what was shown
 */
export function adjust(canvas: HTMLCanvasElement, edit: ImageEdit) {
	if (!edit.brightness && !edit.contrast && !edit.saturation) return;
	const context = canvas.getContext('2d')!;
	const image = context.getImageData(0, 0, canvas.width, canvas.height);
	const px = image.data;
	const b = factor(edit.brightness);
	const c = factor(edit.contrast);
	const s = factor(edit.saturation);
	// (the saturation's matrix, as in the filter effects spec)
	const m = [
		0.213 + 0.787 * s,
		0.715 - 0.715 * s,
		0.072 - 0.072 * s,
		0.213 - 0.213 * s,
		0.715 + 0.285 * s,
		0.072 - 0.072 * s,
		0.213 - 0.213 * s,
		0.715 - 0.715 * s,
		0.072 + 0.928 * s
	];
	const tone = (value: number) => {
		const lit = Math.min(255, value * b);
		return Math.min(255, Math.max(0, (lit - 127.5) * c + 127.5));
	};
	for (let i = 0; i < px.length; i += 4) {
		const r = tone(px[i]);
		const g = tone(px[i + 1]);
		const bl = tone(px[i + 2]);
		px[i] = m[0] * r + m[1] * g + m[2] * bl;
		px[i + 1] = m[3] * r + m[4] * g + m[5] * bl;
		px[i + 2] = m[6] * r + m[7] * g + m[8] * bl;
	}
	context.putImageData(image, 0, 0);
}

/**
 * The picture turned and mirrored (the whole of it; at most `maxSide` px on its longest side,
 * for showing it). Mirrored as it's seen: after it's turned.
 */
export function oriented(image: HTMLImageElement, edit: ImageEdit, maxSide = 0) {
	const k = maxSide ? Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
	const w = Math.max(1, Math.round(image.naturalWidth * k));
	const h = Math.max(1, Math.round(image.naturalHeight * k));
	const sideways = edit.turns % 2 === 1;
	const canvas = document.createElement('canvas');
	canvas.width = sideways ? h : w;
	canvas.height = sideways ? w : h;
	const context = canvas.getContext('2d')!;
	context.imageSmoothingQuality = 'high';
	context.translate(canvas.width / 2, canvas.height / 2);
	// (the last applied first: turned, then mirrored)
	context.scale(edit.mirrorX ? -1 : 1, edit.mirrorY ? -1 : 1);
	context.rotate((edit.turns * Math.PI) / 2);
	context.drawImage(image, -w / 2, -h / 2, w, h);
	return canvas;
}

/** The size of what's saved (px) */
export function outputSize(image: HTMLImageElement, edit: ImageEdit) {
	const sideways = edit.turns % 2 === 1;
	const w = (sideways ? image.naturalHeight : image.naturalWidth) * edit.crop.w;
	const h = (sideways ? image.naturalWidth : image.naturalHeight) * edit.crop.h;
	const width = Math.max(1, Math.round(edit.width && edit.width < w ? edit.width : w));
	return { width, height: Math.max(1, Math.round((h * width) / w)) };
}

/** The edited picture, drawn */
export function render(image: HTMLImageElement, edit: ImageEdit) {
	const whole = oriented(image, edit);
	const { width, height } = outputSize(image, edit);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d')!;
	context.imageSmoothingQuality = 'high';
	context.drawImage(
		whole,
		edit.crop.x * whole.width,
		edit.crop.y * whole.height,
		edit.crop.w * whole.width,
		edit.crop.h * whole.height,
		0,
		0,
		width,
		height
	);
	adjust(canvas, edit);
	return canvas;
}

export async function saveImage(
	file: File,
	image: HTMLImageElement,
	edit: ImageEdit,
	target: Target
): Promise<SavedFile> {
	const data = await writeImage(render(image, edit), target.id, { maxSize: 0, quality: 0.92 });
	return saveFile(FOLDER, `${baseName(file.name)} (edited).${target.extension}`, data);
}
