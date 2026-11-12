// What the file add-ons made, on the clipboard: text as text (JSON, CSV, Markdown, …), a
// picture as a picture (to paste into a chat, a document, a paint program), anything else as
// the file itself, as the file manager copies it (src-tauri/src/clipboard.rs).
//
// Called straight from the click: the clipboard takes what's read after it (a promise), as
// browsers only allow writing to it while the click is still going on.

import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { extensionOf } from './formats';
import type { SavedFile } from './save';

export type Copied = 'text' | 'picture' | 'file' | 'files';

const TEXT = new Set(['json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'xml', 'md', 'html', 'txt']);
/** Pictures the browser reads (and so can put on the clipboard, as PNG) */
const PICTURES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
const TEXT_LIMIT = 4 * 1024 * 1024;
const PICTURE_LIMIT = 60 * 1024 * 1024;

async function asText(file: SavedFile) {
	const data = await readFile(file.path);
	return new Blob([new TextDecoder().decode(data)], { type: 'text/plain' });
}

async function asPicture(file: SavedFile) {
	const data = await readFile(file.path);
	const url = URL.createObjectURL(new Blob([data as BlobPart]));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		canvas.getContext('2d')!.drawImage(image, 0, 0);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), 'image/png')
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function asFiles(files: SavedFile[]): Promise<Copied> {
	await invoke('copy_files', { paths: files.map((file) => file.path) });
	return files.length === 1 ? 'file' : 'files';
}

/** Puts them on the clipboard (call it right in the click); how */
export function copyToClipboard(files: SavedFile[]): Promise<Copied> {
	if (files.length !== 1) return asFiles(files);
	const [file] = files;
	const extension = extensionOf(file.name);
	const kind =
		TEXT.has(extension) && file.size <= TEXT_LIMIT
			? 'text'
			: PICTURES.has(extension) && file.size <= PICTURE_LIMIT
				? 'picture'
				: null;
	if (!kind || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
		return asFiles(files);
	const type = kind === 'text' ? 'text/plain' : 'image/png';
	const content = kind === 'text' ? asText(file) : asPicture(file);
	return (
		navigator.clipboard
			.write([new ClipboardItem({ [type]: content })])
			.then(() => kind as Copied)
			// (the clipboard didn't take it: the file itself, then)
			.catch(() => asFiles(files))
	);
}

export const COPIED_TEXT: Record<Copied, string> = {
	text: 'Copied as text',
	picture: 'Copied as a picture',
	file: 'Copied: paste it into a chat or a folder',
	files: 'Copied the files: paste them into a chat or a folder'
};
