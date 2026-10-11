// The hit objects of an osu!standard beatmap for drawing its gameplay: positions, times,
// combos and slider paths, plus the circle size and approach rate.

import { SliderPath, type Point } from './curves';

export interface HitObject {
	kind: 'circle' | 'slider' | 'spinner';
	time: number;
	endTime: number;
	x: number;
	y: number;
	/** Number shown on the circle */
	combo: number;
	/** Which combo colour */
	colour: number;
	slider?: { path: SliderPath; slides: number; spanDuration: number };
}

export interface GameplayBeatmap {
	objects: HitObject[];
	/** Circle radius in osu! pixels */
	radius: number;
	/** How long before its time an object appears (ms) */
	preempt: number;
	/** How long it takes to fade in (ms) */
	fadeIn: number;
	/** Combo colours of the beatmap, if it has its own */
	colours: [number, number, number][];
}

function sections(content: string) {
	const result: Record<string, string[]> = {};
	let current = '';
	for (const raw of content.replace(/^﻿/, '').split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('//')) continue;
		const header = line.match(/^\[(.+)\]$/);
		if (header) {
			current = header[1];
			result[current] ??= [];
		} else if (current) result[current].push(line);
	}
	return result;
}

function value(lines: string[] | undefined, key: string) {
	const line = lines?.find((l) => l.toLowerCase().startsWith(key.toLowerCase() + ':'));
	return line?.slice(line.indexOf(':') + 1).trim();
}

/** The osu!standard objects of a beatmap; null for other modes */
export function parseGameplay(content: string): GameplayBeatmap | null {
	const parsed = sections(content);
	if ((Number(value(parsed.General, 'Mode') ?? 0) || 0) !== 0) return null;

	const od = Number(value(parsed.Difficulty, 'OverallDifficulty') ?? 5);
	const ar = Number(value(parsed.Difficulty, 'ApproachRate') ?? od);
	const cs = Number(value(parsed.Difficulty, 'CircleSize') ?? 4);
	const multiplier = Number(value(parsed.Difficulty, 'SliderMultiplier') ?? 1.4) || 1.4;
	// osu!'s formulas
	const preempt =
		ar < 5 ? 1200 + (600 * (5 - ar)) / 5 : ar > 5 ? 1200 - (750 * (ar - 5)) / 5 : 1200;
	const fadeIn = ar < 5 ? 800 + (400 * (5 - ar)) / 5 : ar > 5 ? 800 - (500 * (ar - 5)) / 5 : 800;
	const radius = 54.4 - 4.48 * cs;

	const points = (parsed.TimingPoints ?? [])
		.map((line) => {
			const p = line.split(',');
			const beatLength = Number(p[1]);
			return {
				time: Number(p[0]),
				beatLength,
				uninherited: p[6] === undefined ? beatLength > 0 : p[6] === '1'
			};
		})
		.filter((p) => isFinite(p.time) && isFinite(p.beatLength))
		.sort((a, b) => a.time - b.time);
	const at = <T extends { time: number }>(list: T[], time: number) => {
		let found = list[0];
		for (const p of list) {
			if (p.time <= time) found = p;
			else break;
		}
		return found;
	};
	const uninherited = points.filter((p) => p.uninherited);

	const colours = (parsed.Colours ?? [])
		.map((line) => line.match(/^Combo(\d+)\s*:\s*(.+)$/i))
		.filter((match): match is RegExpMatchArray => !!match)
		.sort((a, b) => Number(a[1]) - Number(b[1]))
		.map((match) => match[2].split(',').map(Number).slice(0, 3) as [number, number, number]);

	const objects: HitObject[] = [];
	let combo = 0;
	let colour = 0;
	let first = true;
	let afterSpinner = false;
	for (const line of parsed.HitObjects ?? []) {
		const p = line.split(',');
		const x = Number(p[0]);
		const y = Number(p[1]);
		const time = Number(p[2]);
		const type = Number(p[3]);
		if (!isFinite(time)) continue;
		const isSpinner = !!(type & 8);
		if (!isSpinner && (first || afterSpinner || type & 4)) {
			combo = 0;
			if (!first) colour += 1 + ((type >> 4) & 7);
		}
		first = false;
		afterSpinner = isSpinner;
		if (!isSpinner) combo++;

		if (type & 2) {
			const [curveType, ...rest] = (p[5] ?? 'L').split('|');
			const controls: Point[] = [
				{ x, y },
				...rest.map((pt) => {
					const [px, py] = pt.split(':').map(Number);
					return { x: px, y: py };
				})
			];
			const slides = Math.max(1, Number(p[6]) || 1);
			const length = Number(p[7]) || 0;
			const path = new SliderPath(curveType, controls, length);
			const beat = at(uninherited, time)?.beatLength ?? 500;
			const point = at(points, time);
			const velocity =
				point && !point.uninherited && point.beatLength < 0
					? Math.min(10, Math.max(0.1, -100 / point.beatLength))
					: 1;
			const spanDuration = (path.length / (multiplier * 100 * velocity)) * beat;
			objects.push({
				kind: 'slider',
				time,
				endTime: time + spanDuration * slides,
				x,
				y,
				combo,
				colour,
				slider: { path, slides, spanDuration }
			});
		} else if (isSpinner) {
			objects.push({
				kind: 'spinner',
				time,
				endTime: Number(p[5]) || time,
				x: 256,
				y: 192,
				combo: 0,
				colour
			});
		} else {
			objects.push({ kind: 'circle', time, endTime: time, x, y, combo, colour });
		}
	}
	return { objects, radius, preempt, fadeIn, colours };
}

/** Where a slider's ball is at a time */
export function sliderBall(object: HitObject, time: number) {
	const slider = object.slider!;
	const elapsed = Math.max(0, Math.min(object.endTime - object.time, time - object.time));
	const span = Math.min(slider.slides - 1, Math.floor(elapsed / (slider.spanDuration || 1)));
	let progress = (elapsed - span * slider.spanDuration) / (slider.spanDuration || 1);
	if (span % 2) progress = 1 - progress;
	return { ...slider.path.at(progress), progress, span };
}
