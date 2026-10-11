// Saves the storyboard of a beatmap set (.osz): its scripts and the images they use

import type JSZip from 'jszip';
import { hasStoryboard, parseStoryboard } from './parse';

/** File access, so this runs in the download worker as well as in the app */
export interface StoryboardFiles {
	join(...paths: string[]): Promise<string>;
	mkdir(dir: string): Promise<unknown>;
	writeFile(path: string, data: Uint8Array): Promise<unknown>;
}

export interface SavedStoryboard {
	/** Folder the image paths of the storyboard are relative to */
	dir: string;
	/** The .osb file, if the set has one */
	osb: string | null;
	/** Saved .osu file per difficulty that has its own storyboard */
	osuFiles: Record<string, string>;
}

/** Saves the storyboard into "<setId>-storyboard"; null if the set has none */
export async function extractStoryboard(
	zip: JSZip,
	setId: string,
	diffs: { beatmapId: number | string; content: string }[],
	mapSetsDir: string,
	files: StoryboardFiles
): Promise<SavedStoryboard | null> {
	const entries = Object.values(zip.files).filter((file) => !file.dir);
	const osbEntry = entries.find((file) => file.name.toLowerCase().endsWith('.osb'));
	const osb = osbEntry ? await osbEntry.async('string') : '';
	const withStoryboard = diffs.filter((diff) => hasStoryboard(diff.content));
	if (!hasStoryboard(osb) && !withStoryboard.length) return null;

	const dir = await files.join(mapSetsDir, `${setId}-storyboard`);
	await files.mkdir(dir);

	// Only the images the storyboard uses; saved under the name the script uses
	const needed = new Set<string>();
	const scripts = [
		parseStoryboard(osb, ''),
		...withStoryboard.map((d) => parseStoryboard('', d.content))
	];
	for (const script of scripts) for (const image of script.images) needed.add(image);
	const byName = new Map(entries.map((file) => [file.name.toLowerCase(), file]));
	for (const image of needed) {
		const entry = byName.get(image.toLowerCase());
		if (!entry) continue;
		const parts = image.split('/').filter(Boolean);
		if (parts.some((part) => part === '..')) continue;
		const target = await files.join(dir, ...parts);
		if (parts.length > 1) await files.mkdir(await files.join(dir, ...parts.slice(0, -1)));
		await files.writeFile(target, await entry.async('uint8array'));
	}

	let osbPath: string | null = null;
	if (hasStoryboard(osb)) {
		osbPath = await files.join(dir, 'storyboard.osb');
		await files.writeFile(osbPath, new TextEncoder().encode(osb));
	}
	const osuFiles: Record<string, string> = {};
	for (const diff of withStoryboard) {
		const path = await files.join(dir, `${diff.beatmapId}.osu`);
		await files.writeFile(path, new TextEncoder().encode(diff.content));
		osuFiles[diff.beatmapId] = path;
	}
	return { dir, osb: osbPath, osuFiles };
}
