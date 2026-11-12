// A file handed from one file add-on to another: the converter's "Edit" opens it in the
// editor, the editor's "Convert" in the converter. Its page takes it when it opens.

import { goto } from '$app/navigation';

const waiting = new Map<string, File[]>();

/** Opens the add-on's page with these files (its page offers to install it if it isn't) */
export function handOver(addon: 'edit' | 'convert', files: File[]) {
	waiting.set(addon, [...(waiting.get(addon) ?? []), ...files]);
	return goto(`/addons/${addon}`);
}

/** The files handed to this add-on, taken (none: an empty list) */
export function takeHandedOver(addon: 'edit' | 'convert'): File[] {
	const files = waiting.get(addon) ?? [];
	waiting.delete(addon);
	return files;
}
