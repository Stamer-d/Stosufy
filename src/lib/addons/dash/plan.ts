// The level's dramaturgy: which kind of part comes where, how long, how small and how fast.
//
// Measured on levels people built by hand (four of them, cube to spider, see docs/dash.md §29):
// their parts aren't all alike. Long stretches of one kind alternate with quick play: two kinds
// taking turns phrase by phrase (cube and ship, ball and UFO), one kind turning small and big
// again, chains of short parts on a drop (a new kind every bar), and short bursts (a bar of wave
// on a fill, then back). The speed changes often (8–14 times a minute), with the music and not
// only at a new kind, and the levels are mostly at 1x–2x, faster only where the song peaks.
//
// So the song is cut into phrases (two bars), each with its own music (how busy and loud, the
// kiai, the mapper's sliders, its tempo) and its own pace (calm, usual, intense, peak) and speed.
// Between the places where the music changes (a drop, the kiai, a new tempo, a breakdown) is a
// segment, and each segment gets a set piece: a stretch, a duet, a size play, a chain or a burst,
// by the difficulty and how intense it is. The kinds follow the music (held notes fly, streams
// wave) and don't repeat themselves; the level starts and ends on the cube.

import { beatAt, type DashChart } from './chart';
import type { Mode } from './physics';
import type { Preset, Random } from './build';
import { loudness } from './audio';
import { accentAt, musicalRest } from './composition';
import {
	barEnergies,
	energyOf,
	inKiai,
	intensities,
	kickiness,
	musicalChanges,
	paces,
	songTurn,
	type MusicalChange,
	type Pace,
	type Part
} from './generate';

/** The set pieces a segment can be */
export type PieceKind = 'stretch' | 'duet' | 'sizes' | 'chain' | 'burst' | 'rest';

/** The speeds (0.5x … 4x) of the calm, usual, intense and peak phrases, by difficulty */
export const SPEED_PALETTE: [number, number, number, number][] = [
	[1, 1, 1, 1],
	[0, 1, 2, 2],
	[1, 2, 3, 3],
	[1, 2, 3, 4],
	[2, 3, 3, 4]
];

/** How likely each set piece is, by difficulty and pace (calm, usual, intense, peak) */
const PIECES: Record<Exclude<PieceKind, 'rest'>, number[][]> = {
	stretch: [
		[1, 1, 1, 1],
		[1, 1, 0.8, 0.8],
		[1, 0.8, 0.5, 0.4],
		[0.9, 0.6, 0.35, 0.25],
		[0.8, 0.45, 0.25, 0.15]
	],
	duet: [
		[0, 0, 0, 0],
		[0.3, 0.5, 0.6, 0.6],
		[0.4, 0.7, 0.8, 0.7],
		[0.4, 0.7, 0.7, 0.6],
		[0.4, 0.6, 0.6, 0.5]
	],
	sizes: [
		[0, 0, 0, 0],
		[0, 0.1, 0.15, 0.15],
		[0.1, 0.3, 0.35, 0.3],
		[0.15, 0.35, 0.4, 0.4],
		[0.2, 0.4, 0.45, 0.45]
	],
	chain: [
		[0, 0, 0, 0],
		[0, 0, 0, 0],
		[0, 0, 0.12, 0.25],
		[0, 0.05, 0.35, 0.5],
		[0, 0.1, 0.5, 0.75]
	],
	burst: [
		[0, 0, 0, 0],
		[0, 0.15, 0.25, 0.25],
		[0, 0.3, 0.5, 0.5],
		[0.1, 0.4, 0.55, 0.55],
		[0.15, 0.4, 0.55, 0.55]
	]
};

/** How long a stretch of one kind goes (ms), by difficulty; times 1.3 calm … 0.7 at the peak */
const RUNS: [number, number][] = [
	[14000, 30000],
	[8000, 18000],
	[5500, 12000],
	[4000, 9000],
	[3000, 7500]
];
const RUN_PACE = [1.3, 1, 0.85, 0.7];
/** The shortest part (ms) where nothing asks for shorter */
const SHORTEST = [8000, 4000, 2000, 1400, 1000];
/** A duet's turns at least this long (ms) */
const TURN = [Infinity, 6000, 3500, 2500, 1800];
/** The short parts of chains and bursts at least this long (ms) */
const QUICK = [Infinity, 2600, 2200, 1500, 1050];
/** A set piece goes over at most this long (ms): a long segment has several */
const BLOCK = [32000, 20000, 16000, 13000, 11000];

/** Kinds that go well after each other (a duet's partner) */
const PARTNERS: Record<Mode, Mode[]> = {
	cube: ['ship', 'ball', 'ufo', 'wave', 'robot', 'spider'],
	ship: ['cube', 'wave', 'robot', 'ufo', 'ball'],
	ball: ['ufo', 'cube', 'spider', 'wave', 'ship'],
	ufo: ['ball', 'wave', 'ship', 'cube', 'robot'],
	wave: ['ship', 'ufo', 'cube', 'ball', 'swing'],
	robot: ['ship', 'spider', 'cube', 'wave'],
	spider: ['robot', 'ball', 'wave', 'ufo', 'cube'],
	swing: ['wave', 'ship', 'ufo', 'cube']
};

interface Phrase {
	from: number;
	to: number;
	segment: number;
	/** The first of its segment, and that segment starts where the music changes */
	first: boolean;
	change: MusicalChange | null;
	kiai: boolean;
	energy: number;
	drive: number;
	streamy: number;
	held: number;
	tempo: number;
	rest: number;
	/** How much the song turns at its start (see songTurn), how hard it's hit there */
	turn: number;
	accent: number;
	/** How much busier its last bar is than the rest of it (a fill) */
	fill: number;
	bar: number;
	beat: number;
	pace: Pace;
	peak: boolean;
	speedIndex: number;
	intensity: number;
}

interface Chunk {
	from: number;
	to: number;
	mode: Mode;
	mini: boolean;
	phrase: Phrase;
	piece: PieceKind;
	/** The first of a segment where the music changes */
	change: boolean;
	/** Its own speed, where it's not its phrase's (a fill faster, the run-up to a drop slower) */
	speed?: number;
}

export function planLevel(
	chart: DashChart,
	start: number,
	end: number,
	preset: Preset,
	rng: Random
): Part[] {
	const level = preset.level;
	const timing = chart.timing;
	const modes = preset.modes as Mode[];
	const has = (m: Mode) => modes.includes(m);

	// --- Where the music changes: the segments ------------------------------------------------
	const barAt = (t: number) => {
		const { point } = beatAt(timing, t + 1);
		return point.beatLength * point.meter;
	};
	const changes: MusicalChange[] = [];
	for (const c of musicalChanges(chart, start, end)) {
		if (c.time <= start + 2500 || c.time >= end - 4000) continue;
		const last = changes[changes.length - 1];
		const closest = Math.max(level >= 2 ? 2600 : 4000, 2 * barAt(c.time) - 50);
		if (last && c.time - last.time < closest) {
			if (c.strength > last.strength) changes[changes.length - 1] = { ...c, up: c.up || last.up };
			else last.up ||= c.up;
			continue;
		}
		changes.push(c);
	}

	// --- The phrases: two bars each (four in very fast songs, one in very slow ones) ----------
	const marks = [start, ...changes.map((c) => c.time), end];
	const cuts: { time: number; segment: number; first: boolean; change: MusicalChange | null }[] =
		[];
	for (let m = 0; m + 1 < marks.length; m++) {
		const a = marks[m];
		const b = marks[m + 1];
		const { point } = beatAt(timing, a + 1);
		const bar = point.beatLength * point.meter;
		let bars = 2;
		if (bars * bar < 2400) bars = 4;
		if (bars * bar > 6500) bars = 1;
		const unit = bars * bar;
		cuts.push({ time: a, segment: m, first: true, change: m > 0 ? changes[m - 1] : null });
		const origin = m === 0 ? point.time : a;
		for (
			let t = origin + Math.max(1, Math.ceil((a + unit * 0.5 - origin) / unit)) * unit;
			t < b - unit * 0.5;
			t += unit
		)
			cuts.push({ time: Math.round(t), segment: m, first: false, change: null });
	}

	// What each phrase's music is like (as the old planner: next to the whole song's)
	const meanDensity = chart.notes.length / Math.max(1, (end - start) / 1000);
	const sound = chart.sound;
	const meanLoud = sound ? Math.max(0.05, loudness(sound, start, end)) : 1;
	const meanKick = Math.max(1e-4, kickiness(sound, start, end));
	const svs = chart.notes.map((n) => n.sv).sort((a, b) => a - b);
	const usualSv = svs[svs.length >> 1] || 1;
	const tempoAt = (time: number) => 60000 / beatAt(timing, time).point.beatLength;
	const usualTempo = (() => {
		const spans = new Map<number, number>();
		for (let i = 0; i < timing.length; i++) {
			const from = Math.max(start, timing[i].time);
			const to = Math.min(end, timing[i + 1]?.time ?? end);
			if (to <= from) continue;
			const bpm = Math.round(60000 / timing[i].beatLength);
			spans.set(bpm, (spans.get(bpm) ?? 0) + to - from);
		}
		let best = tempoAt(start);
		let most = -1;
		for (const [bpm, ms] of spans)
			if (ms > most) {
				most = ms;
				best = bpm;
			}
		return best;
	})();
	const notesIn = (from: number, to: number) =>
		chart.notes.filter((n) => n.time >= from && n.time < to);
	const featureOf = (from: number, to: number) => {
		const notes = notesIn(from, to);
		const seconds = Math.max(0.05, (to - from) / 1000);
		const density = notes.length / seconds / Math.max(0.1, meanDensity);
		const energy = energyOf(
			density,
			sound ? loudness(sound, from, to) / meanLoud : 0,
			kickiness(sound, from, to) / meanKick,
			sound
		);
		const partSv = notes.map((n) => n.sv).sort((a, b) => a - b);
		const drive = (partSv[partSv.length >> 1] ?? usualSv) / usualSv;
		let stream = 0;
		for (let k = 1; k < notes.length; k++) {
			const beat = beatAt(timing, notes[k].time).point.beatLength;
			if (notes[k].time - notes[k - 1].time <= Math.max(130, beat / 4 + 12)) stream++;
		}
		const streamy = notes.length > 1 ? stream / (notes.length - 1) : 0;
		const held =
			notes.reduce((sum, n) => sum + (n.kind === 'circle' ? 0 : Math.min(n.end, to) - n.time), 0) /
			Math.max(1, to - from);
		let resting = 0;
		let samples = 0;
		for (let t = from + 125; t < to; t += 250, samples++) if (musicalRest(chart, t)) resting++;
		return {
			energy,
			drive,
			streamy,
			held,
			rest: resting / Math.max(1, samples),
			tempo: tempoAt((from + to) / 2) / usualTempo,
			kiai: inKiai(chart, (from + to) / 2)
		};
	};
	const phrases: Phrase[] = cuts.map((c, i) => {
		const from = c.time;
		const to = cuts[i + 1]?.time ?? end;
		const { point } = beatAt(timing, from + 1);
		const bar = point.beatLength * point.meter;
		const f = featureOf(from, to);
		const lastBar = Math.max(from, to - bar);
		const inLast = notesIn(lastBar, to).length / Math.max(0.2, (to - lastBar) / 1000);
		const inAll = notesIn(from, to).length / Math.max(0.2, (to - from) / 1000);
		return {
			from,
			to,
			segment: c.segment,
			first: c.first,
			change: c.change,
			...f,
			turn: c.first ? 1 : songTurn(chart, from, Math.min(to - from, 2 * bar)),
			accent: accentAt(chart, from),
			fill: inAll > 0 ? inLast / inAll : 0,
			bar,
			beat: point.beatLength,
			pace: 1,
			peak: false,
			speedIndex: 1,
			intensity: 0.5
		};
	});

	// --- How fast: each phrase its own pace, changing where the music does ---------------------
	const bars = barEnergies(chart, start, end).filter(
		(b) => !musicalRest(chart, (b.start + b.end) / 2)
	);
	const sorted = bars.map((b) => b.energy).sort((a, b) => a - b);
	const song =
		sorted.length >= 8
			? {
					low: sorted[Math.floor(sorted.length * 0.2)],
					high: sorted[Math.floor(sorted.length * 0.9)]
				}
			: undefined;
	const pace = paces(
		phrases.map((p) => ({
			energy: p.energy,
			kiai: p.kiai,
			tempo: p.tempo,
			drive: p.drive,
			change: (p.first && !!p.change) || p.turn >= 0.55,
			drop: p.first && !!p.change?.up && p.change.kind !== 'tempo'
		})),
		level,
		song
	);
	// (from hard on the phrases of a segment whose song is busier and louder than the rest of
	// the intense ones are its peak: a drop's first phrases, the kiai's loudest)
	const intense = phrases.filter((_, i) => pace[i] === 2).map((p) => p.energy);
	intense.sort((a, b) => a - b);
	const peakFrom = intense.length ? intense[Math.floor(intense.length * 0.45)] : Infinity;
	const dropSegments = new Set(
		phrases
			.filter((p) => p.first && p.change?.up && p.change.kind !== 'tempo')
			.map((p) => p.segment)
	);
	const palette = SPEED_PALETTE[level] ?? SPEED_PALETTE[4];
	const firstOf = (segment: number) => phrases.findIndex((q) => q.segment === segment);
	phrases.forEach((p, i) => {
		p.pace = pace[i];
		p.peak =
			level >= 2 &&
			pace[i] === 2 &&
			(p.energy >= peakFrom || (dropSegments.has(p.segment) && i - firstOf(p.segment) < 2));
		let index = palette[p.peak ? 3 : p.pace];
		if (p.rest >= 0.5) index = Math.min(index, palette[0]);
		// (a slow song not at the top speed: its beats are far apart already)
		if (tempoAt((p.from + p.to) / 2) < 100) index = Math.min(index, 3);
		p.speedIndex = index;
	});
	// How demanding each phrase is built: its rank in the song, the kiai high, a warm-up first
	const rank = intensities(
		phrases.map((p) => ({
			energy: p.energy,
			kiai: p.kiai,
			drop: p.first && !!p.change?.up
		}))
	);
	phrases.forEach((p, i) => {
		let v = rank[i];
		if (p.pace === 2) v = Math.max(v, 0.72);
		if (p.peak) v = Math.max(v, 0.85);
		if (p.pace === 0) v = Math.min(v, 0.4);
		p.intensity = Math.round(v * 1000) / 1000;
	});

	// --- Which kinds ----------------------------------------------------------------------------
	const quick = Math.max(0, (level - 1) / 3);
	const fits = (p: Phrase): Record<Mode, number> => {
		const hot = p.intensity * quick;
		return {
			cube: 1.1 + (p.energy < 0.8 ? 0.3 : 0) - hot * 0.35,
			robot: 0.6 + (p.held > 0.2 ? 0.9 : 0) + (p.energy > 1 ? 0.3 : 0) + hot * 0.15,
			ship: 0.5 + (p.held > 0.45 ? 1.3 : 0) + (p.energy < 0.6 ? 0.6 : 0) - hot * 0.1,
			wave: preset.wave > 0 ? 0.15 + (p.streamy > 0.4 ? 1.8 : 0) + hot * (0.5 + p.streamy) : 0,
			ball: 0.6 + (p.streamy < 0.25 && p.energy > 0.7 ? 0.3 : 0) + hot * 0.3,
			ufo: 0.55 + (p.streamy < 0.3 ? 0.2 : 0) + hot * 0.35,
			swing: 0.45 + (p.kiai ? 0.4 : 0) + hot * 0.3,
			spider: 0.4 + (p.streamy < 0.25 ? 0.15 : 0) + hot * 0.45
		};
	};
	const history: Mode[] = [];
	/** A kind for a phrase: what fits its music, not what just was, one not had yet welcome */
	const pick = (
		p: Phrase,
		options: {
			not?: Mode[];
			among?: Mode[];
			length?: number;
			bias?: Partial<Record<Mode, number>>;
		} = {}
	): Mode => {
		const fit = fits(p);
		const length = options.length ?? p.to - p.from;
		const kinds = (options.among ?? modes).filter((m) => has(m) && !options.not?.includes(m));
		if (!kinds.length) return options.not?.includes('cube') && modes.length > 1 ? modes[1] : 'cube';
		const weights = kinds.map((m) => {
			let w = Math.max(0.05, fit[m]) * (options.bias?.[m] ?? 1);
			const back = history.lastIndexOf(m);
			if (back >= 0) {
				const ago = history.length - back;
				w *= ago === 1 ? 0.3 : ago === 2 ? 0.6 : ago <= 4 ? 0.85 : 1;
			}
			if (!history.includes(m)) w *= 1.7;
			const share = history.filter((h) => h === m).length / Math.max(1, history.length);
			if (m === 'cube' && share < 0.3 - quick * 0.1) w *= 1.6;
			if (m !== 'cube' && share > 0.28) w *= 0.45;
			// (the ship and swing fly; a part of a second is too short to get anywhere)
			if ((m === 'ship' || m === 'swing') && length < 1500) w *= 0.25;
			// (the wave is quick play: a few seconds, not a long stretch of it)
			if (m === 'wave' && length > 4000) w *= 4000 / length;
			return { m, w };
		});
		const total = weights.reduce((s, o) => s + o.w, 0);
		let r = rng() * total;
		for (const o of weights) {
			r -= o.w;
			if (r <= 0) return o.m;
		}
		return weights[weights.length - 1].m;
	};
	/** Whether a kind may be small there */
	const smallOk = (m: Mode, p: Phrase) =>
		preset.mini > 0 &&
		m !== 'ball' &&
		p.rest < 0.5 &&
		((m !== 'cube' && m !== 'robot') || level >= 2) &&
		(m !== 'wave' || p.speedIndex <= (level >= 4 ? 3 : 2));
	const smallChance = (p: Phrase) => preset.mini * (0.55 + p.intensity * 0.9);

	// --- The set pieces, segment by segment ----------------------------------------------------
	const chunks: Chunk[] = [];
	const push = (
		from: number,
		to: number,
		mode: Mode,
		mini: boolean,
		p: Phrase,
		piece: PieceKind
	) => {
		if (to - from < 1) return;
		chunks.push({ from, to, mode, mini, phrase: p, piece, change: false });
		history.push(mode);
	};
	const prev = () => chunks[chunks.length - 1];
	const segments: Phrase[][] = [];
	for (const p of phrases) (segments[p.segment] ??= []).push(p);
	const paceClass = (p: Phrase) => (p.peak ? 3 : p.pace);
	const lastPhrase = phrases[phrases.length - 1];

	// (a long segment in blocks of a few phrases, each its own set piece: a long intro isn't one
	// chain)
	const blocks: { list: Phrase[]; s: number; opens: boolean }[] = [];
	segments.forEach((list, s) => {
		if (!list?.length) return;
		let current: Phrase[] = [];
		for (const p of list) {
			if (current.length && p.to - current[0].from > BLOCK[level] + 1) {
				blocks.push({ list: current, s, opens: !blocks.some((b) => b.s === s) });
				current = [];
			}
			current.push(p);
		}
		blocks.push({ list: current, s, opens: !blocks.some((b) => b.s === s) });
	});
	blocks.forEach(({ list, s, opens }, blockIndex) => {
		const head = list[0];
		const segChange = opens && !!head.change;
		const startAt = chunks.length;
		// Where the music mostly rests, the big cube: a place to rest
		const live = list.filter((p) => p.rest < 0.5);
		const cls = Math.max(...list.map(paceClass));
		const n = list.length;
		const options: { item: PieceKind; weight: number }[] = (
			['stretch', 'duet', 'sizes', 'chain', 'burst'] as const
		).map((k) => {
			let w = PIECES[k][level]?.[cls] ?? 0;
			if (k === 'duet' && (n < 2 || modes.length < 2)) w = 0;
			if (k === 'sizes' && (n < 2 || preset.mini <= 0)) w = 0;
			if ((k === 'chain' || k === 'burst') && modes.length < 2) w = 0;
			if (k === 'burst' && n < 2) w *= 0.3;
			return { item: k, weight: w };
		});
		let kind: PieceKind = 'stretch';
		{
			const total = options.reduce((a, o) => a + o.weight, 0);
			let r = rng() * total;
			for (const o of options) {
				r -= o.weight;
				if (r <= 0) {
					kind = o.item;
					break;
				}
			}
		}
		// (the level's first block a warm-up, one kind)
		if (blockIndex === 0) kind = 'stretch';
		if (!live.length) kind = 'rest';

		/** The first kind of the segment: something new where the music changes */
		const opening = (p: Phrase, extra: Parameters<typeof pick>[1] = {}) => {
			const before = prev();
			const not = [...(extra.not ?? [])];
			if (before && (segChange || level >= 3)) not.push(before.mode);
			return pick(p, { ...extra, not });
		};
		/** One phrase cut into short parts, each a new kind */
		const quickParts = (p: Phrase, piece: PieceKind) => {
			const unit = QUICK[level];
			const beats = Math.round((p.to - p.from) / p.beat);
			let size = 2;
			while (size * p.beat < unit && size < beats) size *= 2;
			if (size >= beats) return false;
			for (let t = p.from; t < p.to - 1; t += size * p.beat) {
				const to = Math.min(p.to, Math.round(t + size * p.beat));
				const length = to - t;
				const before = prev();
				const mode = pick(p, {
					not: before ? [before.mode] : [],
					length,
					bias: { wave: 1.4, ufo: 1.2, ball: 1.2, spider: 1.2, robot: 0.9 }
				});
				const mini = smallOk(mode, p) && rng() < smallChance(p) * 1.2;
				push(Math.round(t), p.to - to < size * p.beat * 0.5 ? p.to : to, mode, mini, p, piece);
				if (p.to - to < size * p.beat * 0.5) break;
			}
			return true;
		};

		if (kind === 'rest' || kind === 'stretch') {
			let run = 0;
			let target = 0;
			for (const p of list) {
				const before = prev();
				if (p.rest >= 0.5) {
					push(p.from, p.to, 'cube', false, p, 'rest');
					run = 0;
					continue;
				}
				if (!before || before.piece === 'rest' || run >= target || chunks.length === startAt) {
					const [lo, hi] = RUNS[level] ?? RUNS[4];
					target = (lo + rng() * (hi - lo)) * RUN_PACE[paceClass(p)];
					run = 0;
					const mode = chunks.length === startAt ? opening(p) : pick(p, { not: [before.mode] });
					// (the wave is quick play: not long)
					if (mode === 'wave') target = Math.min(target, level >= 2 ? 5000 : 7000);
					const mini = smallOk(mode, p) && rng() < smallChance(p);
					push(p.from, p.to, mode, mini, p, 'stretch');
				} else push(p.from, p.to, before.mode, before.mini, p, 'stretch');
				run += p.to - p.from;
			}
		} else if (kind === 'duet') {
			const a = opening(head);
			const partners = PARTNERS[a].filter((m) => has(m));
			const b = partners.length
				? pick(head, { among: partners, not: [a] })
				: pick(head, { not: [a] });
			const aMini = smallOk(a, head) && rng() < smallChance(head) * 0.7;
			const bMini = smallOk(b, head) && rng() < smallChance(head) * 0.7;
			const per = Math.max(1, Math.ceil(TURN[level] / Math.max(1, head.to - head.from) - 0.05));
			list.forEach((p, j) => {
				if (p.rest >= 0.5) return push(p.from, p.to, 'cube', false, p, 'rest');
				const second = Math.floor(j / per) % 2 === 1;
				push(p.from, p.to, second ? b : a, second ? bMini : aMini, p, 'duet');
			});
		} else if (kind === 'sizes') {
			let mode = opening(head, { not: ['ball'] });
			if (!smallOk(mode, head))
				mode = opening(head, {
					among: ['cube', 'ufo', 'ship', 'robot', 'spider', 'wave'].filter((m) =>
						smallOk(m as Mode, head)
					) as Mode[]
				});
			let mini = rng() < 0.5;
			list.forEach((p) => {
				if (p.rest >= 0.5) return push(p.from, p.to, 'cube', false, p, 'rest');
				const ok = smallOk(mode, p);
				// (at the peak of the hardest, by the bar)
				if (ok && level >= 4 && p.peak && p.to - p.from >= 2 * Math.max(QUICK[level], p.bar) - 1) {
					const mid = Math.round(p.from + Math.round((p.to - p.from) / p.bar / 2) * p.bar);
					mini = !mini;
					push(p.from, mid, mode, mini, p, 'sizes');
					mini = !mini;
					push(mid, p.to, mode, mini, p, 'sizes');
					return;
				}
				mini = ok ? !mini : false;
				push(p.from, p.to, mode, mini, p, 'sizes');
			});
		} else if (kind === 'chain') {
			list.forEach((p, j) => {
				if (p.rest >= 0.5) return push(p.from, p.to, 'cube', false, p, 'rest');
				if (!quickParts(p, 'chain')) {
					const before = prev();
					const mode = j === 0 ? opening(p) : pick(p, { not: before ? [before.mode] : [] });
					push(p.from, p.to, mode, smallOk(mode, p) && rng() < smallChance(p), p, 'chain');
				}
			});
		} else if (kind === 'burst') {
			const base = opening(head, { among: ['cube', 'robot', 'ship', 'ufo', 'ball'] });
			const baseMini = smallOk(base, head) && rng() < smallChance(head) * 0.6;
			// (on the phrases with the most to it at their end: a fill, or a turn right after)
			const every = level >= 4 ? 3 : level >= 3 ? 3.5 : 4;
			const count = Math.max(1, Math.round(list.length / every));
			const score = (p: Phrase, j: number) =>
				p.rest >= 0.5 ? -1 : p.fill + (list[j + 1]?.turn ?? 0.3) + rng() * 0.3;
			const chosen = new Set(
				list
					.map((p, j) => ({ j, v: score(p, j) }))
					.filter((o) => o.v >= 0)
					.sort((x, y) => y.v - x.v)
					.slice(0, count)
					.map((o) => o.j)
			);
			list.forEach((p, j) => {
				if (p.rest >= 0.5) return push(p.from, p.to, 'cube', false, p, 'rest');
				if (!chosen.has(j)) return push(p.from, p.to, base, baseMini, p, 'burst');
				// (its last beats: two, four, a bar or two, as short as the difficulty has them; where
				// the phrase is that short itself, the whole phrase)
				let beats = 2;
				while (beats * p.beat < Math.min(QUICK[level], 2000)) beats *= 2;
				let at = Math.round(p.to - beats * p.beat);
				if (at - p.from < Math.min(SHORTEST[level], (p.to - p.from) / 2)) at = p.from;
				else push(p.from, at, base, baseMini, p, 'burst');
				const mode = pick(p, {
					not: [base],
					length: p.to - at,
					bias: {
						wave: 1.5 + p.streamy * 2,
						ufo: 1.2,
						ball: 1.1,
						spider: 1.1,
						ship: 0.6,
						swing: 0.6,
						robot: 0.7
					}
				});
				push(at, p.to, mode, smallOk(mode, p) && rng() < smallChance(p), p, 'burst');
			});
		}
		if (chunks.length > startAt) chunks[startAt].change = segChange || (s === 0 && opens);
	});

	// --- The start and the end on the cube ---------------------------------------------------
	if (chunks.length) {
		const first = chunks[0];
		first.mode = 'cube';
		first.mini = false;
		if (chunks.length > 2) {
			const last = chunks[chunks.length - 1];
			if (last.mode !== 'cube' || last.mini) {
				// (the last phrase, or its last bars where the last part is short)
				const from =
					last.to - last.from > 2 * SHORTEST[level]
						? Math.max(last.from, lastPhrase.from)
						: last.from;
				if (from > last.from + SHORTEST[level]) {
					chunks.push({
						...last,
						from,
						mode: 'cube',
						mini: false,
						change: false,
						piece: 'stretch'
					});
					last.to = from;
				} else {
					last.mode = 'cube';
					last.mini = false;
				}
			}
		}
	}

	// --- No kind on and on: a streak longer than the longest stretch gets a new kind -----------
	{
		const [lo, hi] = RUNS[level] ?? RUNS[4];
		for (let i = 0; i < chunks.length;) {
			let j = i;
			let total = 0;
			while (j < chunks.length && chunks[j].mode === chunks[i].mode && chunks[j].piece !== 'rest')
				total += chunks[j].to - chunks[j++].from;
			if (j === i) {
				i++;
				continue;
			}
			if (total <= hi * 1.25) {
				i = j;
				continue;
			}
			// (at a phrase's start, about a stretch's length in)
			const aim = (lo + hi) / 2;
			let k = -1;
			for (let at = i + 1, sum = chunks[i].to - chunks[i].from; at < j; at++) {
				if (sum >= aim && chunks[at].from === chunks[at].phrase.from) {
					k = at;
					break;
				}
				sum += chunks[at].to - chunks[at].from;
			}
			if (k < 0) {
				i = j;
				continue;
			}
			const p = chunks[k].phrase;
			const mode = pick(p, { not: [chunks[i].mode, ...(chunks[j] ? [chunks[j].mode] : [])] });
			const mini = smallOk(mode, p) && rng() < smallChance(p);
			for (let at = k; at < j; at++) {
				chunks[at].mode = mode;
				chunks[at].mini = mini && smallOk(mode, chunks[at].phrase);
			}
			i = k;
		}
	}

	// --- Parts: what stays the same (kind, size, speed) is one part -------------------------
	// (a run of one kind and size too short for its difficulty goes to the one before; its speed
	// stays its own)
	for (let i = 0; i < chunks.length;) {
		let j = i + 1;
		while (
			j < chunks.length &&
			chunks[j].mode === chunks[i].mode &&
			chunks[j].mini === chunks[i].mini &&
			!chunks[j].change
		)
			j++;
		const length = chunks[j - 1].to - chunks[i].from;
		const quickOne = chunks[i].piece === 'chain' || chunks[i].piece === 'burst';
		const least = quickOne ? Math.min(QUICK[level], 2000) * 0.9 : SHORTEST[level];
		if (i > 0 && length < least && chunks[i].piece !== 'rest' && !chunks[i].change)
			for (let k = i; k < j; k++) {
				chunks[k].mode = chunks[i - 1].mode;
				chunks[k].mini = chunks[i - 1].mini;
			}
		i = j;
	}
	// --- The speed on the song's moments (from hard on): as hand-built levels change theirs far
	// more often than at a new kind (8 to 14 times a minute, docs/dash.md §29), on what the music
	// does there
	if (level >= 2) {
		const fastest = (p: Phrase) =>
			tempoAt((p.from + p.to) / 2) < 100 ? Math.min(palette[3], 3) : palette[3];
		/** A speed set: the small wave isn't at the top speeds (see generate.ts) */
		const setSpeed = (c: Chunk, speed: number) => {
			c.speed = speed;
			if (c.mode === 'wave' && c.mini && speed > (level >= 4 ? 3 : 2)) c.mini = false;
		};
		// (a fill: the burst at a phrase's end a step faster, where it isn't calm and the song has
		// one there: its last bar clearly busier, or it turns right after)
		chunks.forEach((c) => {
			if (c.piece !== 'burst' || c.from <= c.phrase.from || c.phrase.pace < 1) return;
			const next = phrases[phrases.indexOf(c.phrase) + 1];
			if (c.phrase.fill < 1.3 && (next?.turn ?? 0) < 0.55) return;
			setSpeed(c, Math.min(fastest(c.phrase), c.phrase.speedIndex + 1));
		});
		// (the run-up to a drop: its last bar a step slower, and the drop hits at its own speed)
		for (let i = 1; i < chunks.length; i++) {
			const c = chunks[i];
			const change = c.phrase.change;
			if (!c.change || !change?.up || change.kind === 'tempo' || c.phrase.rest >= 0.5) continue;
			const before = chunks[i - 1];
			if (before.piece === 'rest') continue;
			// (only where the song draws back before it: its last bar clearly thinner, or resting)
			const lastBar = Math.max(before.from, c.from - before.phrase.bar);
			if (before.phrase.fill > 0.6 && !musicalRest(chart, (lastBar + c.from) / 2)) continue;
			const running = before.speed ?? before.phrase.speedIndex;
			const brake = Math.max(palette[0], running - 1);
			if (brake >= running || brake >= c.phrase.speedIndex) continue;
			const bar = before.phrase.bar;
			// (a bar of a slow song is a long stretch to hold back: there it stays as it was)
			if (bar > 2000) continue;
			if (before.to - before.from < 2 * bar - 1) {
				setSpeed(before, brake);
				continue;
			}
			const last: Chunk = { ...before, from: Math.round(before.to - bar), change: false };
			before.to = last.from;
			setSpeed(last, brake);
			chunks.splice(i, 0, last);
			i++;
		}
	}
	const merged = chunks;
	// (two neighbours that ended up alike, after the merging: one part)
	const parts: Part[] = [];
	for (const c of merged) {
		const last = parts[parts.length - 1];
		const speedIndex = c.speed ?? c.phrase.speedIndex;
		if (
			last &&
			last.mode === c.mode &&
			last.mini === c.mini &&
			last.speedIndex === speedIndex &&
			!c.change
		) {
			last.end = c.to;
			continue;
		}
		const f = featureOf(c.from, c.to);
		parts.push({
			start: c.from,
			end: c.to,
			mode: c.mode,
			mini: c.mini,
			kiai: f.kiai,
			energy: f.energy,
			drive: f.drive,
			intensity: c.phrase.intensity,
			pace: c.phrase.pace,
			change:
				c.change || (parts.length > 0 && f.kiai !== (parts[parts.length - 1]?.kiai ?? f.kiai)),
			rest: f.rest,
			speedIndex,
			piece: c.piece
		});
	}

	// --- Mirrored stretches: from hard on, on an intense change (a drop), for a few parts -------
	// (as hand-built levels have them: one or two in a level, seen right to left a while)
	const mirrors = level >= 4 ? 2 : level >= 3 ? 1 : level >= 2 && rng() < 0.5 ? 1 : 0;
	const starts = parts
		.map((p, i) => ({ p, i }))
		.filter(({ p, i }) => i > 0 && i < parts.length - 2 && p.change && p.intensity >= 0.6)
		.map((o) => ({ ...o, order: rng() }))
		.sort((a, b) => a.order - b.order);
	let made = 0;
	for (const { i } of starts) {
		if (made >= mirrors) break;
		// (not next to another mirrored stretch)
		if (parts.slice(Math.max(0, i - 2), i + 6).some((p) => p.mirror)) continue;
		const target = 6000 + rng() * 8000;
		let total = 0;
		for (let j = i; j < parts.length - 1 && total < target; j++) {
			parts[j].mirror = true;
			total += parts[j].end - parts[j].start;
		}
		made++;
	}
	return parts;
}
