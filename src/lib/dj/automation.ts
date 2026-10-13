// The moves of a mix on the mixer: each deck's EQ bands, filters, echo and reverb sends and
// level, as points on the audio clock that the sound follows to the sample (worked out once
// when the mix is planned, so a bass swap is on the one however busy the app is).

import type { MixPlan } from './mixplan';

export interface Keyframe {
	t: number;
	v: number;
}

/** What a mix moves on a deck (on top of the deck's own controls) */
export type MixParam = 'low' | 'mid' | 'high' | 'hp' | 'lp' | 'dry' | 'vol' | 'echo' | 'reverb';
export type Curves = Partial<Record<MixParam, Keyframe[]>>;

/** Where the moves rest: bands open, filters open, the song on, no sends */
export const NEUTRAL: Record<MixParam, number> = {
	low: 1,
	mid: 1,
	high: 1,
	hp: 10,
	lp: 22000,
	dry: 1,
	vol: 1,
	echo: 0,
	reverb: 0
};

export interface MixTimes {
	/** The new song starts, the swap, the old song is gone (audio clock) */
	start: number;
	swap: number;
	end: number;
	/** One beat of the old song while they play (s) */
	beat: number;
	/** From when the old song has no bass left before the swap (the new one's may come), and
	 * from when it's quiet (the new one comes in fully); null: not before the swap */
	bassFree?: number | null;
	quiet?: number | null;
}

export interface MixCurves {
	A: Curves;
	B: Curves;
	/** The old song's echo: its time (s) and how long it rings (feedback) */
	echo: { time: number; feedback: number } | null;
	/** When the old deck's echo and reverb have rung out */
	tail: number;
}

type Shape = 'lin' | 'smooth' | 'in' | 'out' | 'db' | 'exp';

const shaped = (shape: Shape, x: number) =>
	shape === 'smooth'
		? x * x * (3 - 2 * x)
		: shape === 'in'
			? x * x
			: shape === 'out'
				? 1 - (1 - x) * (1 - x)
				: x;

/** A move from one value to another between two times, in steps along its shape */
function ramp(list: Keyframe[], t0: number, t1: number, v0: number, v1: number, shape: Shape) {
	if (t1 <= t0 + 1e-4) {
		list.push({ t: t0, v: v0 }, { t: t0 + 0.004, v: v1 });
		return;
	}
	const steps = shape === 'lin' ? 1 : Math.max(8, Math.min(48, Math.round((t1 - t0) * 6)));
	for (let i = 0; i <= steps; i++) {
		const x = i / steps;
		let v: number;
		if (shape === 'db') {
			// A fade in decibels (down to -40 dB, then off): what sounds even
			const floor = 0.01;
			const a = 20 * Math.log10(Math.max(floor, v0));
			const b = 20 * Math.log10(Math.max(floor, v1));
			v = 10 ** ((a + (b - a) * x) / 20);
			if (i === steps) v = v1;
			if (i === 0) v = v0;
		} else if (shape === 'exp') {
			v = v0 * (v1 / v0) ** x;
		} else v = v0 + (v1 - v0) * shaped(shape, x);
		list.push({ t: t0 + (t1 - t0) * x, v });
	}
}

/** A quick change at a time (a few milliseconds: no click) */
function jump(list: Keyframe[], t: number, from: number, to: number, length = 0.006) {
	list.push({ t, v: from }, { t: t + length, v: to });
}

/** The value a list of points has at a time */
export function valueAt(list: Keyframe[] | undefined, time: number, rest: number) {
	if (!list?.length || time < list[0].t) return rest;
	for (let i = 0; i < list.length - 1; i++) {
		const a = list[i];
		const b = list[i + 1];
		if (time < b.t) return b.t > a.t ? a.v + ((b.v - a.v) * (time - a.t)) / (b.t - a.t) : b.v;
	}
	return list.at(-1)!.v;
}

/** The moves of a mix */
export function mixCurves(plan: MixPlan, times: MixTimes): MixCurves {
	const { start: tS, swap: tW, end: tE, beat } = times;
	// (the old song quiet, or without bass, before the swap: no need to hold the new one back)
	const quiet = times.quiet != null && times.quiet < tW - beat ? Math.max(tS, times.quiet) : null;
	const bassFree =
		times.bassFree != null && times.bassFree < tW - beat && plan.keys !== 0
			? Math.max(tS, times.bassFree)
			: null;
	const bar = beat * 4;
	const A: Curves = {};
	const B: Curves = {};
	const list = (curves: Curves, param: keyof Curves) => (curves[param] ??= []);
	let echo: MixCurves['echo'] = null;
	let tail = tE + 0.05;

	switch (plan.style) {
		case 'blend': {
			// The new song: its highs first, its mids later (none with keys that clash), its bass
			// on the swap. The old one: a little down as the new one's mids come, its bass off on
			// the swap, the rest fading out after it
			const pre = tW - tS;
			const mids = tS + pre * (pre >= bar * 4 ? 0.5 : 0.25);
			if (pre > 0) {
				const full = quiet ?? Infinity;
				ramp(list(B, 'vol'), tS, Math.min(tS + Math.min(bar * 2, pre / 4), full), 0, 1, 'db');
				const high = list(B, 'high');
				ramp(high, tS, Math.min(tS + pre / 2, full), 0.25, 1, 'smooth');
				const mid = list(B, 'mid');
				mid.push({ t: tS, v: 0 });
				if (plan.drums) {
					ramp(mid, tW, tW + beat, 0, 1, 'smooth');
				} else if (quiet != null && quiet <= mids) {
					// The old song is quiet from here: the new one's intro comes in as it is
					ramp(mid, Math.max(tS, quiet - beat), quiet + beat, 0, 1, 'smooth');
				} else {
					// (all the way up once the old song is quiet, else on the swap)
					const up = Math.min(quiet ?? Infinity, tW);
					ramp(mid, mids, up - beat, 0, 0.7, 'smooth');
					ramp(mid, up - beat, up + beat, 0.7, 1, 'lin');
				}
				list(B, 'low').push({ t: tS, v: 0 });
				jump(list(B, 'low'), bassFree ?? tW, 0, 1, 0.02);
				for (const band of ['mid', 'high'] as const) {
					const l = list(A, band);
					ramp(l, plan.drums ? tW - bar : mids, tW, 1, plan.drums ? 0.85 : 0.7, 'smooth');
				}
			}
			jump(list(A, 'low'), tW, 1, 0, 0.02);
			if (tE > tW + 0.05) {
				for (const band of ['mid', 'high'] as const) {
					const l = list(A, band);
					const from = l.at(-1)?.v ?? 1;
					ramp(l, tW, tE, from, 0, 'db');
				}
			}
			if (plan.throwEcho && tE > tW + beat) {
				// The old song's last beat into its echo, ringing on over the new one
				echo = { time: beat * 0.75, feedback: 0.5 };
				const e = list(A, 'echo');
				e.push({ t: tE - beat, v: 0 });
				jump(e, tE - beat, 0, 0.8, 0.004);
				jump(e, tE, 0.8, 0, 0.004);
				for (const band of ['mid', 'high'] as const) {
					// (the echo hears the song as it was: its bands stay up to the end)
					const l = list(A, band);
					l.length = 0;
					if (pre > 0) ramp(l, mids, tW, 1, 0.7, 'smooth');
					ramp(l, tW, tE - beat, pre > 0 ? 0.7 : 1, 0.5, 'smooth');
				}
				jump(list(A, 'dry'), tE, 1, 0, 0.008);
				tail = tE + beat * 6;
			} else jump(list(A, 'vol'), tE, 1, 0, 0.01);
			break;
		}
		case 'filter': {
			// The new song opens up (low-pass) into the swap, the old one thins out (high-pass)
			const pre = tW - tS;
			if (pre > 0) {
				ramp(list(B, 'vol'), tS, tS + Math.min(bar * 2, pre / 4), 0, 1, 'db');
				const lp = list(B, 'lp');
				// (slowly at first, faster towards the swap, or to where the old song is quiet)
				const open = (quiet ?? tW) - tS;
				for (let i = 0; i <= 24; i++) {
					const x = i / 24;
					lp.push({ t: tS + open * x, v: 250 * (20000 / 250) ** (x * x) });
				}
				jump(lp, tS + open, 20000, 22000, 0.05);
				list(B, 'low').push({ t: tS, v: 0 });
				jump(list(B, 'low'), bassFree ?? tW, 0, 1, 0.02);
				ramp(list(A, 'hp'), tS + pre / 2, tW, 10, 300, 'exp');
			} else list(A, 'hp').push({ t: tW, v: 10 });
			jump(list(A, 'low'), tW, 1, 0, 0.02);
			if (tE > tW + 0.05) {
				ramp(list(A, 'hp'), tW, tE, 300, 1500, 'exp');
				ramp(list(A, 'vol'), tW, tE, 1, 0, 'db');
			} else jump(list(A, 'vol'), tE, 1, 0, 0.01);
			break;
		}
		case 'crossfade': {
			// The levels cross, the basslines swap in the middle
			const v = list(B, 'vol');
			const w = list(A, 'vol');
			for (let i = 0; i <= 24; i++) {
				const x = i / 24;
				v.push({ t: tS + (tE - tS) * x, v: Math.sin((x * Math.PI) / 2) });
				w.push({ t: tS + (tE - tS) * x, v: Math.cos((x * Math.PI) / 2) });
			}
			list(B, 'low').push({ t: tS, v: 0 });
			jump(list(B, 'low'), tW, 0, 1, 0.02);
			jump(list(A, 'low'), tW, 1, 0, 0.02);
			break;
		}
		case 'echo': {
			// The old song's last beat into its echo (a little thinner), the song itself off on
			// the one: the echo rings out over the new song
			echo = { time: beat * 0.75, feedback: 0.55 };
			const e = list(A, 'echo');
			e.push({ t: tW - beat, v: 0 });
			jump(e, tW - beat, 0, 1, 0.003);
			jump(e, tW, 1, 0, 0.003);
			ramp(list(A, 'reverb'), tW - beat, tW, 0, 0.3, 'in');
			jump(list(A, 'reverb'), tW, 0.3, 0, 0.004);
			ramp(list(A, 'hp'), tW - beat, tW, 10, 250, 'exp');
			jump(list(A, 'dry'), tW, 1, 0, 0.008);
			tail = tW + beat * 8;
			break;
		}
		case 'wash': {
			// Two bars washing away in reverb and echo, thinning out; on the one only the wash
			echo = { time: beat * 0.75, feedback: 0.5 };
			const from = Math.max(tW - bar * 2, tS - bar * 2);
			ramp(list(A, 'reverb'), from, tW, 0, 0.9, 'in');
			ramp(list(A, 'echo'), from, tW, 0, 0.5, 'in');
			ramp(list(A, 'hp'), from, tW, 10, 700, 'exp');
			jump(list(A, 'dry'), tW, 1, 0, 0.01);
			jump(list(A, 'echo'), tW + 0.01, 0.5, 0, 0.01);
			jump(list(A, 'reverb'), tW + 0.01, 0.9, 0, 0.01);
			tail = tW + 4;
			break;
		}
		case 'cut': {
			// Off on the one, with a short reverb tail
			ramp(list(A, 'reverb'), tW - beat / 2, tW, 0, 0.35, 'in');
			jump(list(A, 'reverb'), tW, 0.35, 0, 0.004);
			jump(list(A, 'dry'), tW, 1, 0, 0.005);
			tail = tW + 2.5;
			break;
		}
		case 'segue': {
			// What's left of the old song (its last hit ringing) fades under the new one's start
			ramp(list(A, 'vol'), tW, Math.max(tE, tW + bar), 1, 0, 'db');
			tail = Math.max(tE, tW + bar) + 0.05;
			break;
		}
		case 'brake': {
			// (the old song slows to a halt by the one: see the timeline)
			jump(list(A, 'vol'), tW, 1, 0, 0.01);
			break;
		}
	}
	return { A, B, echo, tail };
}
