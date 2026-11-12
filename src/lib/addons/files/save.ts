// Where the file add-ons put what they make: a folder of each in ~/Stosufy (Converted,
// Edited), a name that's free in it (" (2)" and so on), and the file shown in its folder.

import * as path from '@tauri-apps/api/path';
import { exists, mkdir, rename, writeFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Made } from './ffmpeg';

export interface SavedFile {
	/** Its name (in a folder, for an unpacked archive's) */
	name: string;
	path: string;
	size: number;
}

const folders = new Map<string, Promise<string>>();
/** Names being saved to now (two at once never take the same) */
const reserved = new Set<string>();

/** ~/Stosufy/<name>, made when it's first needed */
export function outputFolder(name: string) {
	let folder = folders.get(name);
	if (!folder) {
		folder = (async () => {
			const dir = await path.join(await path.homeDir(), 'Stosufy', name);
			await mkdir(dir, { recursive: true });
			return dir;
		})();
		folder.catch(() => folders.delete(name));
		folders.set(name, folder);
	}
	return folder;
}

/** Characters no system allows in a file's name */
const clean = (part: string) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() || 'file';

/**
 * Saved in the folder as `name` (" (2)" and so on where that's taken): bytes written, or a
 * file FFmpeg made moved there
 */
export async function saveFile(
	folderName: string,
	name: string,
	what: Uint8Array | Made
): Promise<SavedFile> {
	const parts = name.split('/').map(clean);
	const file = parts.pop()!;
	let dir = await outputFolder(folderName);
	for (const part of parts) dir = await path.join(dir, part);
	if (parts.length) await mkdir(dir, { recursive: true });
	const dot = file.lastIndexOf('.');
	const stem = dot > 0 ? file.slice(0, dot) : file;
	const ext = dot > 0 ? file.slice(dot) : '';
	// (a name taken: by a file there, or by one being saved now, at the same time)
	let target = '';
	for (let n = 1; ; n++) {
		target = await path.join(dir, n === 1 ? file : `${stem} (${n})${ext}`);
		if (reserved.has(target) || (await exists(target))) continue;
		// (checked again with nothing in between: taken while it looked, it's the next one)
		if (reserved.has(target)) continue;
		reserved.add(target);
		break;
	}
	let size: number;
	try {
		if (what instanceof Uint8Array || 'data' in what) {
			const data = what instanceof Uint8Array ? what : what.data;
			await writeFile(target, data);
			size = data.length;
		} else {
			await rename(what.path, target);
			size = what.size;
		}
	} finally {
		reserved.delete(target);
	}
	const base = await path.basename(target);
	return { name: parts.length ? `${parts.join('/')}/${base}` : base, path: target, size };
}

/** A file shown in its folder (or the folder) */
export async function reveal(target: string) {
	await revealItemInDir(target);
}
