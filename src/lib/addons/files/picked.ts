// Files chosen in the system's file picker (src-tauri: files_pick): a song or a video stays
// where it is (FFmpeg reads it there, the player plays it from there: no copy of a big
// video first); a picture, a text, an archive is read right away, as the page works on it.
// Dropped or pasted files have no place on disk the page can see: those are copied.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { detectFormat, kindOf } from './formats';

/** A song or video on disk, read only when its bytes are wanted */
export class PickedFile extends File {
	readonly path: string;

	constructor(path: string, name: string, size: number, type = '') {
		super([], name, { type });
		this.path = path;
		// (its size on disk, not of the empty File it is to the page)
		Object.defineProperty(this, 'size', { value: size });
	}

	override async arrayBuffer(): Promise<ArrayBuffer> {
		const data = await invoke<ArrayBuffer | number[]>('files_read', { path: this.path });
		return data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
	}

	/** For the player (the asset protocol: allowed for what was picked) */
	get url() {
		return convertFileSrc(this.path);
	}
}

interface Picked {
	path: string;
	name: string;
	size: number;
}

const ON_DISK = new Set(['audio', 'video']);

/**
 * Files chosen in the system's file picker, or null where there's none (the browser: the
 * page's own file input then)
 */
export async function pickFiles(multiple = true): Promise<File[] | null> {
	let picked: Picked[] | null;
	try {
		picked = await invoke<Picked[] | null>('files_pick', { multiple });
	} catch {
		return null;
	}
	if (!Array.isArray(picked)) return null;
	const files: File[] = [];
	for (const { path, name, size } of picked) {
		const file = new PickedFile(path, name, size);
		if (ON_DISK.has(kindOf(detectFormat(file)))) files.push(file);
		// (what the page reads itself: read now, where it is kept, to save it there again)
		else {
			const read = new File([await file.arrayBuffer()], name);
			places.set(read, path);
			files.push(read);
		}
	}
	return files;
}

/** Where the files read at once (pictures, …) were on the computer */
const places = new WeakMap<File, string>();

/** Where a file is on the computer (null: dropped or pasted, its place not known) */
export function placeOf(file: File): string | null {
	return file instanceof PickedFile ? file.path : (places.get(file) ?? null);
}

/** Where the player plays a file from */
export function playable(file: File) {
	return file instanceof PickedFile ? file.url : URL.createObjectURL(file);
}
