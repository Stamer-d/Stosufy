// How a DJ mixes two songs, worked out from what's in them (see analysis.ts). The mix is
// built around its swap: the one where the new song takes over, a phrase of the old song
// (where its outro ends, its last hit, where it stops) and of the new one (where its intro
// ends, it gets going). Before the swap the new song's intro plays under the old song (its
// bass held back), on the swap the basslines change places, after it the old song fades.
// - The tempos are matched with key lock (no chipmunk voices): the new song plays at the old
//   one's tempo and glides back to its own after the mix. Tempos further apart meet: the old
//   song moves part of the way over its last bars. Too far apart, the songs don't play
//   together: the old one echoes out or ends, the new one comes in on the one.
// - Keys that clash: only the new song's drums and highs before the swap, a short overlap.
// - Two full songs never play together for long: an intro under an outro or a breakdown.
// - Mixes build up over 16 or 32 bars: a short intro is looped to fill them (a DJ's intro
//   loop). A song without an intro comes in from its start with only its highs (hats,
//   cymbals) under the old song, its mids and bass on the swap. Tempos too far apart: the old
//   song builds up (thinning out into reverb and echo) and the new one drops in on the one.
// - Auto DJ leaves a longer song after one of its peaks, in the part before the next one: the
//   new song's drop comes where the old one's next drop would have, or where the old one
//   would go quiet.
// - The floor keeps going: every mix is weighed by what's heard bar by bar (see sag), so the
//   music doesn't sag into a hole without bass (a quiet intro under a breakdown).

import { bpmOf, sectionAt, type Grid } from './grid';
import {
	barCeil,
	barIndex,
	barsBetween,
	barsLater,
	busyness,
	keyFit,
	kickIn,
	phraseCeil,
	phraseFloor,
	type SongAnalysis
} from './analysis';

export type MixStyle =
	'blend' | 'filter' | 'crossfade' | 'build' | 'echo' | 'wash' | 'brake' | 'cut' | 'segue';

/** What the user picks: Smart (the planner decides) or a style */
export type TransitionType = 'smart' | Exclude<MixStyle, 'segue'>;

/** What the planner needs to know about a deck */
export interface DeckView {
	analysis: SongAnalysis;
	grid: Grid;
	/** Where the song is now (s) */
	position: number;
	/** How fast it plays now (1: its own tempo) */
	rate: number;
	playing: boolean;
	/** Where it starts from (its cue, a hot cue, the first bar), and whether the user put it there */
	start: number;
	placed: boolean;
	songId: string;
}

export interface Fit {
	/** perfect / good: blends as it is; tricky: the tempos meet; far: too far apart to blend
	 * (the new song comes in on the one) */
	rating: 'perfect' | 'good' | 'tricky' | 'far' | 'clash';
	/** The new song's tempo change to match the playing one (null: no beat to match) */
	change: number | null;
	/** The new song's beats per beat of the playing one (1, or 2 / 0.5 for double / half time) */
	factor: number;
}

export interface MixPlan {
	style: MixStyle;
	/** The old song's time when the new one starts, and the new one's time it starts from */
	startA: number;
	startB: number;
	/** The swap: the old song's time and the new one's */
	swapA: number;
	swapB: number;
	/** The old song's time when it's gone */
	endA: number;
	/** Bars (of the old song) the new one plays before the swap, and the old one after it */
	pre: number;
	post: number;
	/** The two play on the same beat */
	beatmatch: boolean;
	factor: number;
	/** The old song's rate through the mix, and from where (its time) it moves there */
	rateA: number;
	rampFrom: number | null;
	/** The new song's rate when it starts (locked to the old one's beat while they play) */
	rateB: number;
	/** Keys that clash: only the new song's drums and highs before the swap */
	drums: boolean;
	/** The new song's first bars looped to make its intro longer: from its time, bars long,
	 * played this many times in all */
	loopB: { start: number; bars: number; times: number } | null;
	/** The old song's last beat thrown into its echo */
	throwEcho: boolean;
	keys: number | null;
	fit: Fit;
	why: string;
	/** What else it weighed (for a look under the hood) */
	options: string;
}

export interface PlanOptions {
	type: TransitionType;
	/** Mix length the user picked (for the styles picked by hand) */
	bars: number;
	/** Auto DJ: over the end of the song; by hand: as soon as it fits */
	auto: boolean;
	keyLock: boolean;
	/** Styles of the last mixes, newest first */
	history: string[];
}

/** The song's own tempo at a time (BPM) */
const tempoAt = (grid: Grid, at: number) => bpmOf(sectionAt(grid, at));

/** How the new song's tempo fits the playing one's */
export function tempoFit(A: DeckView, B: DeckView, at = B.start): Fit & { need: number } {
	const heard = tempoAt(A.grid, A.position) * A.rate;
	const own = tempoAt(B.grid, at);
	if (!heard || !own) return { rating: 'clash', change: null, factor: 1, need: 1 };
	let factor = 1;
	for (const f of [2, 0.5])
		if (Math.abs(Math.log((heard * f) / own)) < Math.abs(Math.log((heard * factor) / own)))
			factor = f;
	const need = (heard * factor) / own;
	const size = Math.abs(need - 1);
	const rating = size <= 0.03 ? 'perfect' : size <= 0.08 ? 'good' : size <= 0.25 ? 'tricky' : 'far';
	return { rating, change: need - 1, factor, need };
}

/** The beat changes by less than a few percent in a stretch of a song */
function steady(grid: Grid, from: number, to: number) {
	const first = sectionAt(grid, from);
	if (!first) return false;
	return grid.every(
		(p) => p.time <= from || p.time >= to || Math.abs(p.beat / first.beat - 1) <= 0.04
	);
}

/** A number that's the same for the same two songs (a DJ's taste, not a dice roll) */
function chance(seed: string) {
	let h = 2166136261;
	for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	return ((h >>> 0) % 1000) / 1000;
}

/** The longest musical length (bars) that fits */
const musical = (bars: number) => [32, 16, 8, 4, 2].find((n) => n <= bars + 1e-6) ?? 0;

type Bands = { low: number; mid: number; high: number };
const SILENT: Bands = { low: 0, mid: 0, high: 0 };

/** A moment of a song as power in the EQ's three bands, against its peaks (1: as loud) */
function bandPower(s: SongAnalysis, time: number): Bands {
	const bar = s.bars[barIndex(s, time)];
	if (!bar || time >= s.lastBar) return SILENT;
	const total = (bar.energy / (s.peakLevel || 1)) ** 2;
	const l = s.bandsLoudest;
	const low = (bar.bass * l.bass) ** 2;
	const mid = (bar.mid * l.mid) ** 2;
	const high = (bar.high * l.high) ** 2;
	const sum = low + mid + high || 1;
	return { low: (total * low) / sum, mid: (total * mid) / sum, high: (total * high) / sum };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const all = (v: number): Bands => ({ low: v, mid: v, high: v });

/**
 * What a mix lets through of each song's bands at a moment (the old song's time), like its
 * moves on the mixer (automation.ts), roughly: [old song, new song]
 */
function gainsAt(p: MixPlan, a: SongAnalysis, t: number): [Bands, Bands] {
	const pre = p.swapA - p.startA;
	const u = pre > 0 ? clamp01((t - p.startA) / pre) : 1;
	const x = p.endA > p.swapA ? clamp01((t - p.swapA) / (p.endA - p.swapA)) : 1;
	if (t < p.startA) return [all(1), all(0)];
	const blendLike = p.style === 'blend' || p.style === 'filter' || p.style === 'crossfade';
	if (!blendLike) {
		// On the one: the old song until then (a segue's tail fading), the new one after
		if (t < p.swapA) return [all(1), all(0)];
		const tail = p.style === 'segue' && t < p.endA ? 0.01 ** x : 0;
		return [all(tail), all(1)];
	}
	if (p.style === 'crossfade') {
		const k = clamp01((t - p.startA) / Math.max(1e-3, p.endA - p.startA));
		const before = t < p.swapA;
		return [
			{
				low: before ? Math.cos((k * Math.PI) / 2) : 0,
				mid: Math.cos((k * Math.PI) / 2),
				high: Math.cos((k * Math.PI) / 2)
			},
			{
				low: before ? 0 : Math.sin((k * Math.PI) / 2),
				mid: Math.sin((k * Math.PI) / 2),
				high: Math.sin((k * Math.PI) / 2)
			}
		];
	}
	if (t >= p.swapA) {
		const fade = t < p.endA ? (p.style === 'filter' ? 1 : 0.7) * 0.01 ** x : 0;
		return [{ low: 0, mid: fade, high: fade }, all(1)];
	}
	// Before the swap: the new song rising (its bass held back), the old one making room
	const bars = pre / a.bar;
	const vol = 0.01 ** (1 - clamp01(u / Math.min(0.25, 4 / Math.max(1, bars))));
	if (p.style === 'filter') {
		return [
			{ low: 1, mid: u < 0.5 ? 1 : 1 - 0.5 * (u - 0.5) * 2, high: 1 },
			{ low: 0, mid: vol * clamp01((u - 0.35) / 0.4), high: vol * clamp01((u - 0.65) / 0.3) }
		];
	}
	const room = p.drums
		? u > 1 - 1 / Math.max(1, bars)
			? 0.85
			: 1
		: u < 0.5
			? 1
			: 1 - 0.3 * (u - 0.5) * 2;
	return [
		{ low: 1, mid: room, high: room },
		{
			low: 0,
			mid: p.drums ? 0 : u < 0.5 ? 0 : vol * 0.7 * (u - 0.5) * 2,
			high: vol * (0.25 + 0.75 * clamp01(u * 2))
		}
	];
}

/** Where the new song is at a moment of the old one's (its intro loop too) */
function timeOfB(p: MixPlan, a: SongAnalysis, b: SongAnalysis, t: number) {
	const from = p.beatmatch ? p.startA : p.swapA;
	const played = ((t - from) / (p.rateA || 1)) * (p.rateB || 1);
	if (played < 0) return -Infinity;
	const loop = p.loopB;
	if (!loop) return p.startB + played;
	const bars = played / b.bar;
	const looped = loop.bars * loop.times;
	const into = bars < looped ? bars % loop.bars : loop.bars + bars - looped;
	return loop.start + into * b.bar;
}

const powerOf = (s: Bands, g: Bands) =>
	s.low * g.low * g.low + s.mid * g.mid * g.mid + s.high * g.high * g.high;
const totalOf = (s: Bands) => s.low + s.mid + s.high;
const median = (list: number[]) => [...list].sort((x, y) => x - y)[list.length >> 1] ?? 0;
/** A song's main part against its peaks (power: -3 dB) */
const MAIN_LEVEL = 0.5;

/**
 * How much a mix lets the music sag (dB × bars): bar by bar from where the old song could
 * have been left (`from`) to a while after the swap, what's heard (both songs through the
 * mix's moves, roughly) against a song's main part, its bass on its own. A DJ keeps the
 * floor going: the new song's intro without its bass under the old one's breakdown, or the
 * old song played on into its quiet part before the mix, is a hole; a mix over the old
 * song's last full bars into the new one's main part isn't.
 */
export function sag(p: MixPlan, a: SongAnalysis, b: SongAnalysis, from: number) {
	const begin = Math.min(p.startA, Math.max(a.firstBar, from));
	const startBar = barIndex(a, begin);
	const before: Bands[] = [];
	for (let i = Math.max(0, startBar - 8); i < startBar; i++)
		before.push(bandPower(a, a.bars[i].start + 0.01));
	// The level to keep: a song's main part (a few dB under its peaks), or what played if
	// that was quieter already; and its bass (the kick and the bassline: without them the
	// floor stops, however loud the rest)
	const target = Math.min(
		MAIN_LEVEL,
		before.length ? Math.max(median(before.map(totalOf)), 0.25) : 1
	);
	const lowA = mainLow(a);
	const lowB = mainLow(b);
	const targetLow = Math.min(
		MAIN_LEVEL,
		before.length ? Math.max(median(before.map((x) => x.low / lowA)), 0.1) : 1
	);
	const end = barsLater(a, Math.max(p.endA, p.swapA), 8);
	let loss = 0;
	for (let t = barCeil(a, begin) + a.bar / 2; t < end; t = barsLater(a, t, 1)) {
		const [ga, gb] = gainsAt(p, a, t);
		const sa = bandPower(a, t);
		const sb = bandPower(b, timeOfB(p, a, b, t));
		const heard = powerOf(sa, ga) + powerOf(sb, gb);
		const low = (sa.low * ga.low ** 2) / lowA + (sb.low * gb.low ** 2) / lowB;
		// (a few dB less is a breath; more is a hole)
		const db = 10 * Math.log10(target / Math.max(heard, 1e-4));
		const lowDb = 10 * Math.log10(targetLow / Math.max(low, 1e-4));
		loss += Math.min(20, Math.max(0, db - 3)) + 0.5 * Math.min(20, Math.max(0, lowDb - 6));
		if (t >= a.lastBar) break;
	}
	return loss;
}

const mainLows = new WeakMap<SongAnalysis, number>();
/** How much bass a song's peaks have (power, like bandPower's) */
function mainLow(s: SongAnalysis) {
	let low = mainLows.get(s);
	if (low == null) {
		const peaks = s.bars.filter((bar) =>
			s.drops.some((d) => bar.start >= d.start - 0.01 && bar.start < d.end - 0.01)
		);
		const list = (peaks.length ? peaks : s.bars).map((bar) => bandPower(s, bar.start + 0.01).low);
		low = Math.max(1e-4, median(list.filter((x) => x > 0)) || 1e-4);
		mainLows.set(s, low);
	}
	return low;
}

/**
 * Where Auto DJ may leave a song: in a longer song after one of its peaks (once it played a
 * good while), in the part before its next peak; else its outro (or fade), its last hit, its end
 */
function exitRegions(a: SongAnalysis, now: number) {
	const regions: { from: number; until: number; kind: 'outro' | 'hit' | 'end' | 'break' }[] = [];
	const length = a.lastBar - a.firstBar;
	if (length >= 150) {
		for (let i = 0; i < a.drops.length - 1; i++) {
			const from = phraseFloor(a, a.drops[i].end + a.bar * 0.5);
			const until = phraseFloor(a, a.drops[i + 1].start + a.bar * 0.5);
			if (from - a.firstBar < Math.max(60, length * 0.4)) continue;
			if (a.lastBar - until < 25 || until - from < a.bar * 4) continue;
			if (now > until - a.bar * 4) continue;
			regions.push({ from, until, kind: 'break' });
			break;
		}
	}
	if (a.ending === 'outro' || a.ending === 'fade')
		regions.push({ from: a.outroStart, until: a.lastBar, kind: 'outro' });
	if (a.endHit != null) regions.push({ from: a.endHit, until: a.endHit, kind: 'hit' });
	if (!regions.some((r) => r.kind !== 'break'))
		regions.push({ from: phraseFloor(a, a.lastBar - a.bar * 0.5), until: a.lastBar, kind: 'end' });
	return regions;
}

type Candidate = { plan: MixPlan; score: number; loss: number };

/** What a dB × bar of sag costs a mix's score */
const SAG_COST = 0.02;

/** The mix from the playing song (A) to the next one (B) */
export function planMix(A: DeckView, B: DeckView, o: PlanOptions): MixPlan {
	const a = A.analysis;
	const b = B.analysis;
	// (a moment from now: the mix can't start in the past)
	const now = A.position + 0.25 * A.rate;
	const startB = B.start;
	const swapB0 = B.placed ? startB : kickIn(b, startB);
	const fit = tempoFit(A, B, swapB0);
	const factor = fit.factor;
	const songBpmA = tempoAt(A.grid, A.position);

	// The tempos: the new song at the old one's (with key lock up to 8 % off its own, without
	// 4 %); further apart (up to 25 %, with key lock) the old song moves most of the way first,
	// over its last 16 or 32 bars
	const maxB = o.keyLock ? 0.08 : 0.04;
	let rateA = A.rate;
	let rateB = fit.need;
	let ramp = 0;
	let beatmatchable = fit.change != null && Math.abs(fit.change) <= maxB;
	if (!beatmatchable && fit.change != null && o.keyLock && Math.abs(fit.change) <= 0.25) {
		const sign = Math.sign(fit.change);
		rateB = 1 + sign * 0.06;
		const bpmB = tempoAt(B.grid, swapB0);
		rateA = (bpmB * rateB) / factor / (songBpmA || 1);
		ramp = Math.abs(rateA / A.rate - 1) > 0.1 ? 32 : 16;
		beatmatchable = true;
	}
	if (!beatmatchable) rateB = 1;
	const keys = keyFit(a.key, b.key, o.keyLock ? 1 : rateB);
	const introBars = Math.max(0, barsBetween(b, startB, swapB0));
	const seed = `${A.songId}>${B.songId}`;
	const meet = ramp ? ` · the tempos meet at ${Math.round(songBpmA * rateA)} BPM` : '';

	const base = {
		factor,
		rateA,
		rampFrom: null as number | null,
		rateB,
		keys,
		fit,
		throwEcho: false,
		loopB: null as MixPlan['loopB'],
		options: ''
	};

	/**
	 * A blend (EQ, filter, crossfade) with its swap on a point of the old song, the new song
	 * under it for some bars before: its intro, looped if it's shorter
	 */
	const blend = (
		style: 'blend' | 'filter' | 'crossfade',
		swapA: number,
		earliest: number,
		target: number,
		postMax: number
	): MixPlan | null => {
		if (!beatmatchable) return null;
		const first = barCeil(a, Math.max(now, earliest));
		const room = Math.max(0, barsBetween(a, first, swapA) - (ramp ? 4 : 0));
		let drums = keys === 0 && style !== 'crossfade';
		const own = introBars / factor;
		// No intro to speak of: it comes in from its start with only its highs, for 8 bars
		const cold = !B.placed && introBars < 4 && style !== 'crossfade';
		if (cold) drums = true;
		const limit = Math.min(room, target, drums ? 8 : 32);
		let pre = musical(limit);
		let start = startB;
		let swapB = swapB0;
		let loopB: MixPlan['loopB'] = null;
		if (cold) {
			start = startB;
			swapB = barsLater(b, startB, pre * factor);
		} else if (B.placed) {
			// From where the user put it, the swap where it falls
			pre = musical(Math.min(limit, Math.max(8, own)));
			swapB = barsLater(b, startB, pre * factor);
		} else if (pre <= own + 1e-6) {
			start = barsLater(b, swapB0, -pre * factor);
		} else {
			// Its intro is shorter: its first bars loop (4 or 8 of them, up to 16 bars more),
			// then it plays on into where it gets going, on the swap
			const bars = introBars >= 8 ? 8 : introBars >= 4 ? 4 : 0;
			const times = bars
				? Math.min(1 + Math.floor((pre * factor - introBars) / bars + 1e-6), 1 + 16 / bars)
				: 1;
			const total = (introBars + (times - 1) * bars) / factor;
			if (times > 1 && Math.abs(total - Math.round(total)) < 1e-6) {
				pre = Math.round(total);
				loopB = { start: startB, bars, times };
			} else {
				pre = musical(Math.min(limit, own));
				start = barsLater(b, swapB0, -pre * factor);
			}
		}
		const after = Math.max(0, barsBetween(a, swapA, a.lastBar));
		// (the old song still full after the swap: it goes quicker, two melodies don't mix long)
		const busyAfter = busyness(a, swapA, barsLater(a, swapA, 4)) > 0.75;
		const post = Math.min(after, drums || busyAfter ? Math.min(2, postMax) : postMax);
		if (pre < 2 && post < 1) return null;
		const startA = barsLater(a, swapA, -pre);
		const endA = post > 0 ? barsLater(a, swapA, post) : swapA;
		if (startA < now - 0.01) return null;
		const playedB = loopB ? barsLater(b, startB, introBars) : swapB;
		if (
			!steady(A.grid, startA, endA) ||
			!steady(B.grid, start, barsLater(b, playedB, post * factor))
		)
			return null;
		const name =
			style === 'filter' ? 'Filter blend' : style === 'crossfade' ? 'Crossfade' : 'Blend';
		const how =
			pre === 0
				? 'it comes in on the one'
				: cold
					? 'from its start, only its highs first'
					: drums
						? 'the keys clash: only its drums first'
						: style === 'filter'
							? 'it opens up as the old one thins out'
							: loopB
								? 'its intro looped under the old one'
								: 'its intro under the old one';
		return {
			...base,
			style,
			startA,
			startB: start,
			swapA,
			swapB,
			endA,
			pre,
			post,
			beatmatch: true,
			rampFrom: ramp ? barsLater(a, startA, -ramp) : null,
			drums,
			loopB,
			// (the old song's last beat before the swap into its echo, when it stops there full)
			throwEcho: post === 0 && after > 0 && busyAfter && style !== 'crossfade',
			why: `${name} over ${pre + post} bars (${how}), the basslines swap on the one${meet}`
		};
	};

	/** The new song comes in on the one (after a build-up of the old one, or an effect) */
	const onOne = (
		style: 'build' | 'echo' | 'wash' | 'cut' | 'brake' | 'segue',
		swapA: number,
		why: string,
		from = startB,
		buildBars = 0
	): MixPlan | null => {
		const lead = style === 'wash' ? a.bar * 2 : style === 'build' ? a.bar * 4 : a.beat;
		if (swapA < now + lead - 0.01) return null;
		// A build-up over the bars before the swap (fewer if there aren't as many left)
		const build =
			style === 'build' ? musical(Math.min(buildBars, barsBetween(a, barCeil(a, now), swapA))) : 0;
		if (style === 'build' && build < 4) return null;
		const tail = style === 'segue' ? Math.min(2, Math.max(0, barsBetween(a, swapA, a.lastBar))) : 0;
		return {
			...base,
			style,
			rateA: A.rate,
			rateB: o.type === 'smart' ? 1 : B.rate,
			startA: build ? barsLater(a, swapA, -build) : swapA,
			startB: from,
			swapA,
			swapB: from,
			endA: tail ? barsLater(a, swapA, tail) : swapA,
			pre: build,
			post: tail,
			beatmatch: false,
			drums: false,
			why
		};
	};
	/** How long a build-up is: about 15 seconds */
	const buildBars = songBpmA * A.rate > 150 ? 16 : 8;
	/** Where the new song drops in after a build-up: where it gets going */
	const dropIn = B.placed ? startB : swapB0;

	// --- Picked by hand ----------------------------------------------------------------
	if (o.type !== 'smart') {
		// On the next phrase if it's close, else on the next bar
		const phrase = phraseCeil(a, now);
		const bar = barCeil(a, now);
		const begin = barsBetween(a, bar, phrase) <= 4 ? phrase : bar;
		const total = Math.max(1, o.bars);
		const forced = { ...base, fit, keys };
		if (o.type === 'blend' || o.type === 'filter' || o.type === 'crossfade') {
			if (fit.change != null && Math.abs(fit.change) <= 0.43) {
				const pre = o.type === 'crossfade' ? total / 2 : (total * 3) / 4;
				const post = total - pre;
				const swapA = barsLater(a, begin, pre);
				// The new song so it gets going on the swap (if its intro is long enough)
				let from = startB;
				if (!B.placed && introBars >= pre * factor) from = barsLater(b, swapB0, -pre * factor);
				const swapB = barsLater(b, from, pre * factor);
				return {
					...forced,
					style: o.type,
					rateA: A.rate,
					rateB: fit.need,
					startA: begin,
					startB: from,
					swapA,
					swapB,
					endA: barsLater(a, swapA, post),
					pre,
					post,
					beatmatch: true,
					drums: false,
					why: `${o.type === 'filter' ? 'Filter blend' : o.type === 'crossfade' ? 'Crossfade' : 'Blend'} over ${total} bars, the basslines swap on bar ${pre + 1}`
				};
			}
		}
		if (o.type === 'build') {
			const plan = onOne(
				'build',
				barsLater(a, begin, buildBars),
				`Build-up over ${buildBars} bars, the new song drops in on the one`,
				dropIn,
				buildBars
			);
			if (plan) return plan;
		}
		const style =
			o.type === 'blend' || o.type === 'filter' || o.type === 'crossfade' || o.type === 'build'
				? 'echo'
				: o.type;
		const swapA = style === 'wash' ? barsLater(a, begin, 2) : begin;
		const names = {
			echo: 'Echo out',
			wash: 'Wash out',
			brake: 'Brake',
			cut: 'Cut'
		};
		return {
			...onOne(style, swapA, `${names[style]} on the one`)!,
			fit,
			keys
		};
	}

	// --- Smart ---------------------------------------------------------------------------
	const options: Candidate[] = [];
	// (every option also by how well it keeps the energy up: see sag)
	const add = (plan: MixPlan | null, score: number, from = now) => {
		if (!plan) return;
		const loss = sag(plan, a, b, from);
		options.push({ plan, score: score - SAG_COST * loss, loss });
	};
	const blendScore = (p: MixPlan) => {
		let s = 1;
		const busyA = busyness(a, p.startA, p.swapA);
		const busyB = busyness(b, p.startB, p.swapB);
		// Two full songs at once, the longer the worse
		s -=
			0.6 *
			Math.max(0, busyA - 0.45) *
			Math.max(0, busyB - 0.35) *
			2 *
			Math.min(1.5, Math.max(0.5, p.pre / 16));
		// A mix builds up: 16 bars, or 32 over quiet parts; a few bars are no mix
		s +=
			p.pre >= 32
				? busyA < 0.6 && busyB < 0.6
					? 0.35
					: 0.1
				: p.pre >= 16
					? 0.3
					: p.pre >= 8
						? 0.1
						: p.pre >= 4
							? -0.25
							: -0.5;
		if (p.loopB) s -= 0.04 * (p.loopB.times - 1);
		if (p.post >= 2) s -= 0.25 * Math.max(0, busyness(a, p.swapA, p.endA) - 0.5);
		// (keys that clash: only its drums first, a little less good)
		if (keys === 0) s -= 0.12;
		if (keys === 2) s += 0.05;
		s -= Math.abs(p.rateB - 1) * 1.5 + (p.rampFrom != null ? 0.1 : 0);
		if (a.boundaries.some((x) => Math.abs(x - p.swapA) < 0.05)) s += 0.05;
		return s;
	};
	// (a build-up now and then, above all for tempos too far apart to blend)
	const buildScore = 0.5 + (beatmatchable ? 0 : 0.35);

	if (o.auto) {
		for (const region of exitRegions(a, now)) {
			// (leaving a longer song after a peak, like a DJ keeping the set going)
			const bonus = region.kind === 'break' ? 0.3 : 0;
			if (region.kind === 'hit') {
				const hit = region.from;
				// The new song gets going on the old one's last hit
				for (const target of [16, 32]) {
					const p = blend('blend', hit, phraseFloor(a, hit - a.bar * 16), target, 2);
					if (p) add(p, blendScore(p) + 0.1, region.from);
				}
				// Or the old song builds up into its last hit, where the new one drops in
				add(
					onOne(
						'build',
						hit,
						'Build-up: the old song builds up into its last hit, the new one drops in on it',
						dropIn,
						buildBars
					),
					buildScore,
					region.from
				);
				// Or the new one starts as the old one's last hit rings (on the bar after it), or
				// right where it stops
				const ring = (a.lastBar - hit) / a.bar < 0.5 ? 0 : 1;
				const segue = onOne(
					'segue',
					barsLater(a, hit, ring),
					ring
						? 'Segue: the song ends, the next one starts on the bar after its last hit'
						: 'Segue: the song stops, the next one starts right on the beat',
					B.placed ? startB : Math.max(b.firstBar, barsLater(b, b.introEnd, -16))
				);
				add(segue, 0.5 + (beatmatchable ? 0 : 0.2) + (keys === 0 ? 0.1 : 0), region.from);
				continue;
			}
			// Swaps on the phrases of the region (the new song's intro under the outro or the
			// part before the old song's next peak, or under the old song's last full phrases,
			// its main part taking over where the old one would go quiet)
			const points = a.phrases.filter((p) => p >= region.from - 0.01 && p <= region.until + 0.01);
			if (!points.length) points.push(region.until);
			for (const swap of points) {
				const earliest = phraseFloor(a, region.from - a.bar * 16);
				// (into the old song's next peak: the new one's takes its place, the old one stops)
				const intoPeak = region.kind === 'break' && Math.abs(swap - region.until) < a.bar * 0.5;
				for (const target of [16, 32]) {
					for (const style of ['blend', 'filter'] as const) {
						const p = blend(style, swap, earliest, target, intoPeak ? 0 : 4);
						if (!p) continue;
						let s = blendScore(p) * (style === 'filter' ? 0.85 : 1) + bonus;
						// The old song plays its outro out under the new one, or the new song's
						// drop comes where the old one's would have
						if (Math.abs(swap - region.until) < a.bar * 0.5) s += 0.1;
						if (style === 'filter' && busyness(b, p.startB, p.swapB) > 0.6) s += 0.1;
						add(p, s, region.from);
					}
				}
			}
			// A build-up into where the region ends (the old song's next peak, or its end)
			add(
				onOne(
					'build',
					region.until,
					region.kind === 'break'
						? 'Build-up: the old song builds up, the new one drops in where its next drop would be'
						: 'Build-up: the old song builds up, the new one drops in on the one',
					dropIn,
					buildBars
				),
				buildScore + bonus,
				region.from
			);
			// Or on the old song's last full bar, before it goes quiet: a build-up over its last
			// full bars, or an echo, and the new song comes in where it gets going (the floor
			// keeps going, above all when the tempos are too far apart to blend)
			if (region.kind === 'break' || region.kind === 'outro') {
				add(
					onOne(
						'build',
						region.from,
						"Build-up over the old song's last full bars, the new one drops in where the old one would go quiet",
						dropIn,
						buildBars
					),
					buildScore + bonus,
					region.from
				);
				add(
					onOne(
						'echo',
						region.from,
						"Echo out on the old song's last full bar, the new one comes in where it gets going",
						dropIn
					),
					0.45 + (beatmatchable ? 0 : 0.2) + (keys === 0 ? 0.1 : 0) + bonus,
					region.from
				);
			}
			// Echo out where a short outro ends, half way through a long one (a fade is quiet by
			// its end), or where the breakdown starts
			const echoAt =
				region.kind !== 'outro'
					? region.from
					: barsBetween(a, region.from, region.until) <= 8
						? region.until
						: phraseCeil(
								a,
								barsLater(
									a,
									region.from,
									Math.min(8, barsBetween(a, region.from, region.until) / 2)
								)
							);
			const intoStart = B.placed ? startB : Math.max(b.firstBar, barsLater(b, b.introEnd, -8));
			add(
				onOne(
					'echo',
					echoAt,
					beatmatchable
						? 'Echo out: the old song echoes away, the new one comes in on the one'
						: 'Echo out: the tempos are too far apart to blend, the new one comes in on the one',
					intoStart
				),
				0.45 + (beatmatchable ? 0 : 0.2) + (keys === 0 ? 0.1 : 0) + bonus,
				region.from
			);
			add(
				onOne(
					'wash',
					echoAt,
					'Wash out: the old song washes away in reverb, the new one comes in on the one',
					intoStart
				),
				0.4 + (beatmatchable ? 0 : 0.2) + bonus,
				region.from
			);
		}
	} else {
		// By hand: the new song starts on the next phrase (or 4 bars from one), the mix builds
		// up over 16 bars (8 if the song is nearly over)
		const lattice: number[] = [];
		const first = phraseFloor(a, now);
		for (let k = 1; k <= 10; k++) {
			const p = barsLater(a, first, k * 4);
			if (p > a.lastBar + 0.01) break;
			lattice.push(p);
		}
		const ahead = (p: number) => barsBetween(a, barCeil(a, now), p);
		const extra = ramp ? 4 : 0;
		const swap =
			lattice.find((p) => ahead(p) >= 16 + extra) ??
			lattice.find((p) => ahead(p) >= 8 + extra) ??
			lattice.find((p) => p >= now + a.beat) ??
			a.lastBar;
		for (const style of ['blend', 'filter'] as const) {
			const p = blend(style, swap, now, 16, 4);
			if (p) add(p, blendScore(p) * (style === 'filter' ? 0.85 : 1));
		}
		const buildAt = lattice.find((p) => ahead(p) >= buildBars) ?? lattice.at(-1) ?? a.lastBar;
		add(
			onOne(
				'build',
				buildAt,
				`Build-up over ${buildBars} bars, the new song drops in on the one`,
				dropIn,
				buildBars
			),
			buildScore
		);
		const echoAt = lattice.find((p) => p >= now + a.beat) ?? a.lastBar;
		add(
			onOne(
				'echo',
				echoAt,
				beatmatchable
					? 'Echo out on the one'
					: 'Echo out: the tempos are too far apart to blend, the new one comes in on the one'
			),
			0.4 + (beatmatchable ? 0 : 0.2)
		);
	}

	// A DJ doesn't make the same move every time: the last one a little less likely, and a
	// little taste of its own for each pair of songs
	for (const option of options) {
		if (o.history[0] === option.plan.style)
			option.score *= option.plan.style === 'build' ? 0.6 : 0.9;
		else if (o.history[1] === option.plan.style && option.plan.style === 'build')
			option.score *= 0.8;
		option.score *= 0.93 + 0.14 * chance(seed + option.plan.style + option.plan.swapA.toFixed(1));
	}
	options.sort((x, y) => y.score - x.score);
	const best = options[0]?.plan;
	if (best) {
		best.options = options
			.slice(0, 6)
			.map(
				(x) =>
					`${x.plan.style}@${x.plan.swapA.toFixed(1)}/${x.plan.pre}+${x.plan.post}${x.plan.loopB ? 'L' : ''} ${x.score.toFixed(2)} sag ${Math.round(x.loss)}`
			)
			.join(', ');
		return best;
	}
	// Nothing fits (the song is all but over): straight in on the next beat
	const next = Math.max(now + a.beat, barCeil(a, now));
	return onOne('cut', Math.min(next, Math.max(now + 0.05, a.lastBar)), 'Cut: the song is ending')!;
}
