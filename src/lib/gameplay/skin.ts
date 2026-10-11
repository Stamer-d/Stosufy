// The skin's gameplay images (hit circles, approach circles, cursor, slider ball, numbers)
// and colours from its skin.ini. Missing elements are drawn by the renderer itself.

import { readDir, readFile } from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';

export const ELEMENTS = [
	'hitcircle',
	'hitcircleoverlay',
	'approachcircle',
	'sliderb0',
	'sliderb',
	'sliderfollowcircle',
	'reversearrow',
	'cursor',
	'cursortrail',
	'spinner-approachcircle',
	'spinner-circle'
] as const;

export type ElementName = (typeof ELEMENTS)[number];

export interface SkinImage {
	image: ImageBitmap;
	/** 0.5 for @2x images */
	scale: number;
}

export interface GameplaySkin {
	images: Partial<Record<ElementName, SkinImage>>;
	/** The combo number images, 0–9 */
	numbers: (SkinImage | null)[];
	colours: [number, number, number][];
	sliderBorder: [number, number, number] | null;
	sliderTrack: [number, number, number] | null;
	/** How far the digits of combo numbers overlap */
	numberOverlap: number;
}

export const EMPTY_SKIN: GameplaySkin = {
	images: {},
	numbers: [],
	colours: [],
	sliderBorder: null,
	sliderTrack: null,
	numberOverlap: -2
};

function ini(text: string) {
	const values: Record<string, string> = {};
	for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.*?)\s*$/);
		if (match && !(match[1] in values)) values[match[1]] = match[2];
	}
	return values;
}

const rgb = (text: string | undefined) => {
	const parts = text?.split(',').map((n) => Number(n.trim()));
	return parts && parts.length >= 3 && parts.every((n) => isFinite(n))
		? (parts.slice(0, 3) as [number, number, number])
		: null;
};

const cache = new Map<string, Promise<GameplaySkin>>();

/** The gameplay elements of a skin folder (null: none, everything drawn) */
export function loadGameplaySkin(dir: string | null): Promise<GameplaySkin> {
	if (!dir) return Promise.resolve(EMPTY_SKIN);
	if (!cache.has(dir)) cache.set(dir, load(dir));
	return cache.get(dir)!;
}

async function load(dir: string): Promise<GameplaySkin> {
	let entries: { name: string; isFile: boolean }[] = [];
	try {
		entries = await readDir(dir);
	} catch (error) {
		console.warn('Could not read the skin for the gameplay', dir, error);
		return EMPTY_SKIN;
	}
	const byName = new Map(
		entries.filter((e) => e.isFile).map((e) => [e.name.toLowerCase(), e.name])
	);

	const image = async (folder: string, files: Map<string, string>, name: string) => {
		for (const [suffix, scale] of [
			['@2x.png', 0.5],
			['.png', 1]
		] as const) {
			const file = files.get((name + suffix).toLowerCase());
			if (!file) continue;
			try {
				const data = await readFile(await path.join(folder, file));
				// Skins use 1×1 transparent pictures to hide an element
				const bitmap = await createImageBitmap(new Blob([data]));
				return { image: bitmap, scale };
			} catch {
				// Try the next one
			}
		}
		return null;
	};

	const iniFile = byName.get('skin.ini');
	const settings = iniFile
		? ini(
				new TextDecoder().decode(
					await readFile(await path.join(dir, iniFile)).catch(() => new Uint8Array())
				)
			)
		: {};

	const images: GameplaySkin['images'] = {};
	await Promise.all(
		ELEMENTS.map(async (name) => {
			const found = await image(dir, byName, name);
			if (found) images[name] = found;
		})
	);

	// Combo numbers: "default-0.png" or the skin.ini's HitCirclePrefix (may be in a folder)
	const prefix = (settings.HitCirclePrefix || 'default').replace(/\\/g, '/');
	let numberDir = dir;
	let numberFiles = byName;
	if (prefix.includes('/')) {
		numberDir = await path.join(dir, ...prefix.split('/').slice(0, -1));
		try {
			const inner = await readDir(numberDir);
			numberFiles = new Map(
				inner.filter((e) => e.isFile).map((e) => [e.name.toLowerCase(), e.name])
			);
		} catch {
			numberFiles = new Map();
		}
	}
	const numberName = prefix.split('/').pop()!;
	const numbers = await Promise.all(
		Array.from({ length: 10 }, (_, digit) =>
			image(numberDir, numberFiles, `${numberName}-${digit}`)
		)
	);

	const colours = Object.entries(settings)
		.filter(([key]) => /^Combo\d$/.test(key))
		.sort(([a], [b]) => Number(a.slice(5)) - Number(b.slice(5)))
		.map(([, v]) => rgb(v))
		.filter(Boolean) as [number, number, number][];

	return {
		images,
		numbers,
		colours,
		sliderBorder: rgb(settings.SliderBorder),
		sliderTrack: rgb(settings.SliderTrackOverride),
		numberOverlap: Number(settings.HitCircleOverlap ?? -2) || -2
	};
}

export function forgetGameplaySkins() {
	cache.clear();
}
