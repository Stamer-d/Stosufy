// The hit objects of an osu!standard beatmap for drawing its gameplay: positions, times,
// combos and slider paths, plus the circle size and approach rate.

import { SliderPath, type Point } from './curves';

/** Mods (osu!'s bit flags) that change the gameplay */
export const MOD = {
	NoFail: 1,
	Easy: 2,
	Hidden: 8,
	HardRock: 16,
	SuddenDeath: 32,
	DoubleTime: 64,
	Relax: 128,
	HalfTime: 256,
	Nightcore: 512,
	Flashlight: 1024,
	SpunOut: 4096,
	Autopilot: 8192,
	Perfect: 16384
} as const;

/** Something on a slider that's scored: ticks, repeats and its (legacy) end */
export interface SliderPoint {
	kind: 'tick' | 'repeat' | 'tail';
	time: number;
	/** Where on the path (0: start, 1: end) */
	progress: number;
	/** The time osu! judges the end at (a bit before it, the legacy last tick) */
	judgeTime: number;
}

export interface HitObject {
	kind: 'circle' | 'slider' | 'spinner';
	index: number;
	time: number;
	endTime: number;
	x: number;
	y: number;
	/** Number shown on the circle */
	combo: number;
	/** Which combo colour */
	colour: number;
	/** The last object of its combo */
	comboEnd: boolean;
	slider?: { path: SliderPath; slides: number; spanDuration: number; points: SliderPoint[] };
	/** Full spins needed to clear a spinner, and how many more give a bonus */
	spinner?: { required: number; maxBonus: number };
	/** How many objects it's stacked on (osu! moves stacked objects up and left) */
	stack: number;
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
	/** Timing windows for a 300, 100 and 50 (ms either way) */
	windows: { 300: number; 100: number; 50: number };
	/** For the score: osu!'s difficulty multiplier */
	difficultyMultiplier: number;
	/** Breaks (ms) */
	breaks: { start: number; end: number }[];
	mods: number;
}

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
/** osu!'s DifficultyRange: a value at difficulty 0, 5 and 10 */
const range = (difficulty: number, min: number, mid: number, max: number) =>
	difficulty > 5
		? mid + ((max - mid) * (difficulty - 5)) / 5
		: difficulty < 5
			? mid - ((mid - min) * (5 - difficulty)) / 5
			: mid;

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

/**
 * The osu!standard objects of a beatmap, with mods (osu!'s bit flags) applied that change
 * them: Hard Rock and Easy. Null for other modes.
 */
export function parseGameplay(content: string, mods = 0): GameplayBeatmap | null {
	const parsed = sections(content);
	if ((Number(value(parsed.General, 'Mode') ?? 0) || 0) !== 0) return null;

	const number = (key: string, fallback: number) => {
		const found = Number(value(parsed.Difficulty, key));
		return isFinite(found) && value(parsed.Difficulty, key) !== undefined ? found : fallback;
	};
	// osu! keeps these as floats: the same rounding decides stacking at the edges
	const adjust = (v: number, hardRock: number) =>
		Math.fround(mods & MOD.HardRock ? Math.min(10, v * hardRock) : mods & MOD.Easy ? v / 2 : v);
	const rawOd = number('OverallDifficulty', 5);
	const od = adjust(rawOd, 1.4);
	const ar = adjust(number('ApproachRate', rawOd), 1.4);
	const cs = adjust(number('CircleSize', 4), 1.3);
	const multiplier = number('SliderMultiplier', 1.4) || 1.4;
	const tickRate = number('SliderTickRate', 1) || 1;
	// osu!'s formulas
	// Whole milliseconds, like osu!'s DifficultyRangeInt; the fade-in is osu!'s too
	const preempt = Math.trunc(range(ar, 1800, 1200, 450));
	const fadeIn = 400 * Math.min(1, preempt / 450);
	// With osu!'s little "fudge" factor
	const radius = 64 * (((1 - (0.7 * (cs - 5)) / 5) / 2) * 1.00041);
	const windows = {
		300: Math.floor(range(od, 80, 50, 20)) - 0.5,
		100: Math.floor(range(od, 140, 100, 60)) - 0.5,
		50: Math.floor(range(od, 200, 150, 100)) - 0.5
	};
	const flip = (y: number) => (mods & MOD.HardRock ? 384 - y : y);

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

	const breaks = (parsed.Events ?? [])
		.map((line) => line.split(','))
		.filter((p) => p[0] === '2' || p[0] === 'Break')
		.map((p) => ({ start: Number(p[1]), end: Number(p[2]) }))
		.filter((b) => isFinite(b.start) && isFinite(b.end));

	const objects: HitObject[] = [];
	let combo = 0;
	let colour = 0;
	let first = true;
	let afterSpinner = false;
	for (const line of parsed.HitObjects ?? []) {
		const p = line.split(',');
		const x = Number(p[0]);
		const y = flip(Number(p[1]));
		const time = Number(p[2]);
		const type = Number(p[3]);
		if (!isFinite(time)) continue;
		const isSpinner = !!(type & 8);
		if (!isSpinner && (first || afterSpinner || type & 4)) {
			combo = 0;
			if (!first) colour += 1 + ((type >> 4) & 7);
			if (objects.length) objects[objects.length - 1].comboEnd = true;
		}
		first = false;
		afterSpinner = isSpinner;
		if (!isSpinner) combo++;
		const base = { index: objects.length, time, x, y, combo, colour, stack: 0, comboEnd: false };

		if (type & 2) {
			const [curveType, ...rest] = (p[5] ?? 'L').split('|');
			const controls: Point[] = [
				{ x, y },
				...rest.map((pt) => {
					const [px, py] = pt.split(':').map(Number);
					return { x: px, y: flip(py) };
				})
			];
			const slides = Math.max(1, Number(p[6]) || 1);
			const length = Number(p[7]) || 0;
			const path = new SliderPath(curveType, controls, length);
			const beat = at(uninherited, time)?.beatLength ?? 500;
			const point = at(points, time);
			const velocity =
				point && !point.uninherited && point.beatLength < 0
					? clamp(-100 / point.beatLength, 0.1, 10)
					: 1;
			const scoringDistance = multiplier * 100 * velocity;
			const spanDuration = (path.length / scoringDistance) * beat;
			const endTime = time + spanDuration * slides;
			{
				// The ticks, repeats and end, like osu!'s SliderEventGenerator
				const sliderPoints: SliderPoint[] = [];
				const tickDistance = clamp(scoringDistance / tickRate, 0, path.length);
				const minFromEnd = (scoringDistance / beat) * 10;
				for (let span = 0; span < slides; span++) {
					const spanStart = time + span * spanDuration;
					const reversed = span % 2 === 1;
					const ticks: SliderPoint[] = [];
					if (tickDistance > 0) {
						for (let d = tickDistance; d <= path.length; d += tickDistance) {
							if (d >= path.length - minFromEnd) break;
							const progress = d / path.length;
							const t = spanStart + (reversed ? 1 - progress : progress) * spanDuration;
							ticks.push({ kind: 'tick', time: t, progress, judgeTime: t });
						}
					}
					if (reversed) ticks.reverse();
					sliderPoints.push(...ticks);
					if (span < slides - 1) {
						const t = spanStart + spanDuration;
						sliderPoints.push({ kind: 'repeat', time: t, progress: (span + 1) % 2, judgeTime: t });
					}
				}
				sliderPoints.push({
					kind: 'tail',
					time: endTime,
					progress: slides % 2,
					judgeTime: Math.max(time + (endTime - time) / 2, endTime - 36)
				});
				objects.push({
					...base,
					kind: 'slider',
					endTime,
					slider: { path, slides, spanDuration, points: sliderPoints }
				});
			}
		} else if (isSpinner) {
			const endTime = Math.max(time, Number(p[5]) || time);
			const seconds = (endTime - time) / 1000;
			const required = Math.floor((range(od, 90, 150, 225) / 60) * seconds + 0.0001);
			const maxBonus = Math.max(
				0,
				Math.floor((range(od, 250, 380, 430) / 60) * seconds + 0.0001) - required - 2
			);
			objects.push({
				...base,
				kind: 'spinner',
				endTime,
				x: 256,
				y: 192,
				combo: 0,
				spinner: { required, maxBonus }
			});
		} else {
			objects.push({ ...base, kind: 'circle', endTime: time });
		}
	}
	if (objects.length) objects[objects.length - 1].comboEnd = true;

	const version = Number(content.match(/osu file format v(\d+)/)?.[1] ?? 14);
	const leniency = Number(value(parsed.General, 'StackLeniency') ?? 0.7);
	const threshold = Math.trunc(preempt) * (isFinite(leniency) ? leniency : 0.7);
	if (version >= 6) applyStacking(objects, threshold);
	else applyStackingOld(objects, threshold);
	// Move stacked objects like osu! does: up and left by a tenth of the radius per object
	for (const object of objects) {
		if (!object.stack || object.kind === 'spinner') continue;
		const offset = -object.stack * (radius / 10);
		object.x += offset;
		object.y += offset;
		object.slider?.path.shift(offset, offset);
	}

	// osu!'s score multiplier for the difficulty (from the map's own values, without mods)
	let difficultyMultiplier = 2;
	if (objects.length) {
		const breakTime = breaks.reduce((sum, b) => sum + (b.end - b.start), 0);
		const drain = Math.max(
			1,
			(objects[objects.length - 1].endTime - objects[0].time - breakTime) / 1000
		);
		difficultyMultiplier = Math.round(
			((number('HPDrainRate', 5) +
				number('CircleSize', 4) +
				rawOd +
				clamp((objects.length / drain) * 8, 0, 16)) /
				38) *
				5
		);
	}
	return {
		objects,
		radius,
		preempt,
		fadeIn,
		colours,
		windows,
		difficultyMultiplier,
		breaks,
		mods
	};
}

// --- Stacking, as osu! does it (OsuBeatmapProcessor in ppy/osu) ------------------------

/** Objects closer than this count as on the same spot */
const STACK_DISTANCE = 3;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const start = (object: HitObject): Point => ({ x: object.x, y: object.y });
/** Where an object ends (the end of a slider's path, for an odd number of slides) */
function end(object: HitObject): Point {
	if (!object.slider) return start(object);
	return object.slider.slides % 2 ? object.slider.path.at(1) : start(object);
}

function applyStacking(objects: HitObject[], threshold: number) {
	for (let i = objects.length - 1; i > 0; i--) {
		let n = i;
		let objectI = objects[i];
		if (objectI.stack !== 0 || objectI.kind === 'spinner') continue;

		if (objectI.kind === 'circle') {
			while (--n >= 0) {
				const objectN = objects[n];
				if (objectN.kind === 'spinner') continue;
				if (Math.trunc(objectI.time) - Math.trunc(objectN.endTime) > threshold) break;

				// Circles under the end of the last slider of a stack go down and right
				if (objectN.kind === 'slider' && distance(end(objectN), start(objectI)) < STACK_DISTANCE) {
					const offset = objectI.stack - objectN.stack + 1;
					for (let j = n + 1; j <= i; j++) {
						if (distance(end(objectN), start(objects[j])) < STACK_DISTANCE)
							objects[j].stack -= offset;
					}
					break;
				}
				if (distance(start(objectN), start(objectI)) < STACK_DISTANCE) {
					objectN.stack = objectI.stack + 1;
					objectI = objectN;
				}
			}
		} else if (objectI.kind === 'slider') {
			while (--n >= 0) {
				const objectN = objects[n];
				if (objectN.kind === 'spinner') continue;
				if (objectI.time - objectN.time > threshold) break;
				if (distance(end(objectN), start(objectI)) < STACK_DISTANCE) {
					objectN.stack = objectI.stack + 1;
					objectI = objectN;
				}
			}
		}
	}
}

/** Stacking of beatmaps older than file format v6 */
function applyStackingOld(objects: HitObject[], threshold: number) {
	for (let i = 0; i < objects.length; i++) {
		const current = objects[i];
		if (current.stack !== 0 && current.kind !== 'slider') continue;
		let startTime = current.endTime;
		let sliderStack = 0;
		const sliderEnd = current.slider ? current.slider.path.at(1) : start(current);
		for (let j = i + 1; j < objects.length; j++) {
			if (objects[j].time - threshold > startTime) break;
			if (distance(start(objects[j]), start(current)) < STACK_DISTANCE) {
				current.stack++;
				startTime = objects[j].time;
			} else if (distance(start(objects[j]), sliderEnd) < STACK_DISTANCE) {
				sliderStack++;
				objects[j].stack -= sliderStack;
				startTime = objects[j].time;
			}
		}
	}
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
