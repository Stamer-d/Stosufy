// What the Dash mode reads from a beatmap: its notes (any mode: osu!, taiko, catch, mania),
// how the mapper made each one stand out (a jump across the playfield, a louder hitsound, faster
// sliders), the beat (BPM and measures), the kiai parts and the breaks.

import type { SongSound } from './audio';

export interface DashNote {
	time: number;
	/** Where it ends: a slider's or a hold's end (ms), else its time */
	end: number;
	kind: 'circle' | 'slider' | 'spinner' | 'hold';
	/** 0–1, high is up: where on the playfield (osu! y, catch x, mania column) */
	height: number;
	/** osu!'s hitsound bits: 2 whistle, 4 finish, 8 clap */
	sound: number;
	/** Starts a new combo */
	combo: boolean;
	/** How far it is from the note before on the playfield (0–1, a big jump there is 1) */
	jump: number;
	/** The hitsound volume there (0–1) */
	volume: number;
	/** The slider velocity there (1 normal, more where the mapper speeds up) */
	sv: number;
}

export interface TimingPoint {
	time: number;
	beatLength: number;
	meter: number;
}

export interface DashChart {
	notes: DashNote[];
	/** The uninherited timing points (BPM), sorted */
	timing: TimingPoint[];
	kiai: { start: number; end: number }[];
	breaks: { start: number; end: number }[];
	title: string;
	artist: string;
	creator: string;
	version: string;
	/** What's heard in the song itself, where it could be read */
	sound?: SongSound | null;
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

export function parseChart(content: string): DashChart | null {
	const parsed = sections(content);
	if (!parsed.HitObjects?.length) return null;
	const mode = Number(value(parsed.General, 'Mode') ?? 0) || 0;
	const multiplier = Number(value(parsed.Difficulty, 'SliderMultiplier')) || 1.4;
	const keys = Math.max(1, Math.round(Number(value(parsed.Difficulty, 'CircleSize')) || 4));

	const points = (parsed.TimingPoints ?? [])
		.map((line) => {
			const p = line.split(',');
			const beatLength = Number(p[1]);
			return {
				time: Number(p[0]),
				beatLength,
				meter: Number(p[2]) || 4,
				uninherited: p[6] === undefined ? beatLength > 0 : p[6] === '1',
				volume: Number(p[5]),
				kiai: (Number(p[7]) || 0) & 1
			};
		})
		.filter((p) => isFinite(p.time) && isFinite(p.beatLength))
		.sort((a, b) => a.time - b.time);
	const timing = points
		.filter((p) => p.uninherited && p.beatLength > 0)
		.map(({ time, beatLength, meter }) => ({ time, beatLength, meter }));
	if (!timing.length) timing.push({ time: 0, beatLength: 500, meter: 4 });

	const kiai: { start: number; end: number }[] = [];
	let kiaiStart: number | null = null;
	for (const p of points) {
		if (p.kiai && kiaiStart === null) kiaiStart = p.time;
		else if (!p.kiai && kiaiStart !== null) {
			if (p.time - kiaiStart > 500) kiai.push({ start: kiaiStart, end: p.time });
			kiaiStart = null;
		}
	}

	const at = <T extends { time: number }>(list: T[], time: number) => {
		let found = list[0];
		for (const p of list) {
			if (p.time <= time + 1) found = p;
			else break;
		}
		return found;
	};

	const notes: DashNote[] = [];
	// Where the last note ended on the playfield (for how far the next one jumps)
	let lastX: number | null = null;
	let lastY = 0;
	for (const line of parsed.HitObjects) {
		const p = line.split(',');
		const x = Number(p[0]);
		const y = Number(p[1]);
		const time = Number(p[2]);
		const type = Number(p[3]) || 0;
		if (!isFinite(time)) continue;
		const sound = Number(p[4]) || 0;
		let height =
			mode === 3
				? (Math.floor((x * keys) / 512) + 0.5) / keys
				: mode === 2
					? x / 512
					: mode === 1
						? sound & 10
							? 0.7
							: 0.3
						: 1 - y / 384;
		height = Math.max(0, Math.min(1, isFinite(height) ? height : 0.5));
		const point = at(points, time);
		const velocity =
			point && !point.uninherited && point.beatLength < 0
				? Math.max(0.1, Math.min(10, -100 / point.beatLength))
				: 1;
		// The jump: across the playfield (osu!, catch), from column to column (mania)
		let jump = 0;
		if (mode !== 1 && isFinite(x) && lastX !== null) {
			const dx = x - lastX;
			const dy = mode === 0 ? y - lastY : 0;
			jump = Math.min(1, Math.hypot(dx, dy) / (mode === 3 ? 512 : 320));
		}
		if (isFinite(x)) {
			lastX = x;
			lastY = isFinite(y) ? y : 0;
		}
		const volume = point && isFinite(point.volume) ? point.volume / 100 : 0.7;
		const note: DashNote = {
			time,
			end: time,
			kind: 'circle',
			height,
			sound,
			combo: !!(type & 4),
			jump,
			volume: Math.max(0, Math.min(1, volume)),
			sv: velocity
		};
		if (type & 2) {
			const slides = Math.max(1, Number(p[6]) || 1);
			const length = Number(p[7]) || 0;
			const beat = at(timing, time)?.beatLength ?? 500;
			note.kind = 'slider';
			note.end = time + (length / (multiplier * 100 * velocity)) * beat * slides;
		} else if (type & 8) {
			note.kind = 'spinner';
			note.end = Math.max(time, Number(p[5]) || time);
		} else if (type & 128) {
			note.kind = 'hold';
			note.end = Math.max(time, Number((p[5] ?? '').split(':')[0]) || time);
		}
		notes.push(note);
	}
	notes.sort((a, b) => a.time - b.time);
	// Mania chords and taiko doubles: one note per moment
	const merged: DashNote[] = [];
	for (const note of notes) {
		const last = merged[merged.length - 1];
		if (last && note.time - last.time < 8) {
			last.end = Math.max(last.end, note.end);
			last.sound |= note.sound;
			continue;
		}
		merged.push(note);
	}
	if (!merged.length) return null;

	if (kiaiStart !== null) kiai.push({ start: kiaiStart, end: merged[merged.length - 1].end + 1 });

	const breaks = (parsed.Events ?? [])
		.map((line) => line.split(','))
		.filter((p) => p[0] === '2' || p[0] === 'Break')
		.map((p) => ({ start: Number(p[1]), end: Number(p[2]) }))
		.filter((b) => isFinite(b.start) && isFinite(b.end));

	return {
		notes: merged,
		timing,
		kiai,
		breaks,
		title: value(parsed.Metadata, 'Title') ?? '',
		artist: value(parsed.Metadata, 'Artist') ?? '',
		creator: value(parsed.Metadata, 'Creator') ?? '',
		version: value(parsed.Metadata, 'Version') ?? ''
	};
}

/** Where a time is in the beat: the timing point, which beat it is and how far into it */
export function beatAt(timing: TimingPoint[], time: number) {
	let point = timing[0];
	for (const p of timing) {
		if (p.time <= time + 2) point = p;
		else break;
	}
	const beats = (time - point.time) / point.beatLength;
	const index = Math.floor(beats + 1e-6);
	return {
		point,
		index,
		/** 0–1 into the beat */
		phase: beats - index,
		/** The first beat of a measure */
		downbeat: ((index % point.meter) + point.meter) % point.meter === 0
	};
}

/** How strong a moment is in the beat: 1 on a measure's first beat, down to 0 off the grid */
export function beatStrength(timing: TimingPoint[], time: number) {
	const { point } = beatAt(timing, time);
	const beats = (time - point.time) / point.beatLength;
	const near = (division: number) => {
		const scaled = beats * division;
		const rounded = Math.round(scaled);
		return { on: (Math.abs(scaled - rounded) / division) * point.beatLength < 22, rounded };
	};
	const whole = near(1);
	if (whole.on) return ((whole.rounded % point.meter) + point.meter) % point.meter === 0 ? 1 : 0.65;
	if (near(2).on) return 0.35;
	if (near(4).on) return 0.15;
	return 0.05;
}
