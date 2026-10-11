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
	'spinner-circle',
	'spinner-background',
	'spinner-metre',
	'spinner-bottom',
	'spinner-top',
	'spinner-middle',
	'spinner-middle2',
	'spinner-glow',
	'spinner-clear',
	'spinner-spin',
	'spinner-rpm',
	'hit0',
	'hit50',
	'hit100',
	'hit100k',
	'hit300',
	'hit300g',
	'hit300k',
	'followpoint',
	'sliderscorepoint',
	'cursormiddle',
	'inputoverlay-key',
	'inputoverlay-background',
	'ranking-XH',
	'ranking-X',
	'ranking-SH',
	'ranking-S',
	'ranking-A',
	'ranking-B',
	'ranking-C',
	'ranking-D'
] as const;

/** Animated elements: the first frame ("hit300-0") if there's no still one */
const ANIMATED = new Set<string>([
	'hit0',
	'hit50',
	'hit100',
	'hit100k',
	'hit300',
	'hit300g',
	'hit300k',
	'followpoint',
	'sliderb'
]);

/** Characters of the score and combo fonts besides the digits */
const SCORE_EXTRAS = { x: 'x', percent: '%', dot: '.', comma: ',' } as const;

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
	/** The score font: digits and "x", "%", ".", "," */
	score: Record<string, SkinImage | null>;
	scoreOverlap: number;
	/** The combo counter's font */
	combo: Record<string, SkinImage | null>;
	comboOverlap: number;
	/** Whether the spinner's sound rises in pitch */
	spinnerFrequencyModulate: boolean;
	/** The images taken from the osu! default skin (the skin doesn't have them) */
	fallbackImages?: Set<string>;
	colours: [number, number, number][];
	sliderBorder: [number, number, number] | null;
	sliderTrack: [number, number, number] | null;
	/** How far the digits of combo numbers overlap */
	numberOverlap: number;
}

export const EMPTY_SKIN: GameplaySkin = {
	images: {},
	numbers: [],
	score: {},
	scoreOverlap: 0,
	combo: {},
	comboOverlap: 0,
	spinnerFrequencyModulate: true,
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

	const element = async (name: string) =>
		(await image(dir, byName, name)) ??
		(ANIMATED.has(name) ? await image(dir, byName, `${name}-0`) : null);

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
			const found = await element(name);
			if (found) images[name] = found;
		})
	);

	// Fonts: "default-0.png" for the circles, "score-0.png" for the score and combo, or the
	// prefixes from skin.ini (which can be in a folder)
	const font = async (prefixSetting: string | undefined, fallback: string) => {
		const prefix = (prefixSetting || fallback).replace(/\\/g, '/');
		let folder = dir;
		let files = byName;
		if (prefix.includes('/')) {
			folder = await path.join(dir, ...prefix.split('/').slice(0, -1));
			try {
				const inner = await readDir(folder);
				files = new Map(inner.filter((e) => e.isFile).map((e) => [e.name.toLowerCase(), e.name]));
			} catch {
				files = new Map();
			}
		}
		const name = prefix.split('/').pop()!;
		const glyphs: Record<string, SkinImage | null> = {};
		await Promise.all([
			...Array.from({ length: 10 }, async (_, digit) => {
				glyphs[digit] = await image(folder, files, `${name}-${digit}`);
			}),
			...Object.entries(SCORE_EXTRAS).map(async ([file, char]) => {
				glyphs[char] = await image(folder, files, `${name}-${file}`);
			})
		]);
		return glyphs;
	};
	const [circleFont, scoreFont, comboFont] = await Promise.all([
		font(settings.HitCirclePrefix, 'default'),
		font(settings.ScorePrefix, 'score'),
		font(settings.ComboPrefix ?? settings.ScorePrefix, 'score')
	]);
	const numbers = Array.from({ length: 10 }, (_, digit) => circleFont[digit] ?? null);

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
		numberOverlap: Number(settings.HitCircleOverlap ?? -2) || -2,
		score: scoreFont,
		scoreOverlap: Number(settings.ScoreOverlap ?? 0) || 0,
		combo: comboFont,
		comboOverlap: Number(settings.ComboOverlap ?? 0) || 0,
		spinnerFrequencyModulate: settings.SpinnerFrequencyModulate !== '0'
	};
}

/**
 * A skin with what it lacks taken from another (the osu! default skin), like osu! does.
 * Only images: the colours stay the skin's own.
 */
export function withFallback(skin: GameplaySkin, fallback: GameplaySkin): GameplaySkin {
	// The osu! default skin itself: all its images are the default ones
	if (skin === fallback) return { ...skin, fallbackImages: new Set(Object.keys(skin.images)) };
	const fill = <T>(own: Record<string, T | null>, other: Record<string, T | null>) => {
		const result = { ...own };
		for (const [key, value] of Object.entries(other)) result[key] ??= value;
		return result;
	};
	// A font is used whole: from the skin if it has its digits, else the fallback's
	const font = (own: Record<string, SkinImage | null>, other: Record<string, SkinImage | null>) =>
		Array.from({ length: 10 }).every((_, d) => own[d]) ? own : other;
	const ownNumbers = skin.numbers.length === 10 && skin.numbers.every(Boolean);
	const fallbackImages = new Set(
		Object.keys(fallback.images).filter((name) => !skin.images[name as ElementName])
	);
	return {
		...skin,
		fallbackImages,
		images: fill(skin.images, fallback.images),
		numbers: ownNumbers ? skin.numbers : fallback.numbers,
		numberOverlap: ownNumbers ? skin.numberOverlap : fallback.numberOverlap,
		score: font(skin.score, fallback.score),
		combo: font(skin.combo, fallback.combo)
	};
}

export function forgetGameplaySkins() {
	cache.clear();
}
