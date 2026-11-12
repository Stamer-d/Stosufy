// What's done to a picture (turned, mirrored, cut to a part, made smaller), drawn on a canvas
// and saved in a format: its own or another. In ~/Stosufy/Edited.

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
}

export const freshImageEdit = (): ImageEdit => ({
	turns: 0,
	mirrorX: false,
	mirrorY: false,
	crop: { x: 0, y: 0, w: 1, h: 1 },
	width: 0
});

/** The picture turned and mirrored (the whole of it) */
export function oriented(image: HTMLImageElement, edit: ImageEdit) {
	const w = image.naturalWidth;
	const h = image.naturalHeight;
	const sideways = edit.turns % 2 === 1;
	const canvas = document.createElement('canvas');
	canvas.width = sideways ? h : w;
	canvas.height = sideways ? w : h;
	const context = canvas.getContext('2d')!;
	context.translate(canvas.width / 2, canvas.height / 2);
	context.rotate((edit.turns * Math.PI) / 2);
	context.scale(edit.mirrorX ? -1 : 1, edit.mirrorY ? -1 : 1);
	context.drawImage(image, -w / 2, -h / 2);
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
