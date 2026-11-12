// An edited file put in the place of its original (the original to the system's trash), for a
// file read where it is (chosen in the system's picker, or handed over from another add-on).

import { invoke } from '@tauri-apps/api/core';
import { placeOf } from '../files/picked';
import type { SavedFile } from '../files/save';

/** Whether this file's place is known (else it can only be saved as a new one) */
export const replaceable = (file: File) => placeOf(file) !== null;

/** `saved` (in Stosufy/Edited) moved over `file`; where it is now */
export async function replaceOriginal(saved: SavedFile, file: File): Promise<SavedFile> {
	const path = placeOf(file);
	if (!path) throw new Error("Its place isn't known: export it instead");
	await invoke('files_replace', { from: saved.path, to: path });
	return { name: file.name, path, size: saved.size };
}
