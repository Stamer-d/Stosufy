// The clicks of a part as a level's creator syncs them: on one layer of the music (its drums,
// where they can be heard or the map marks them with a finish or a clap), on the beat grid, and
// the same pattern bar after bar for as long as the part goes (the music repeats there): the
// strongest slots of the part's two-bar pattern, as many as the difficulty takes. A slot is only
// clicked in a bar where something is heard (or mapped) there.

import { beatStrength, type DashChart, type DashNote } from './chart';
import { hitAt } from './audio';
import { musicalRest } from './composition';
import type { Preset } from './build';

/** Clicks a beat at most, by difficulty */
const DENSITY = [0.5, 0.75, 1, 1.25, 1.5];

export function drumClicks(
	chart: DashChart,
	notes: DashNote[],
	preset: Preset,
	from: number,
	to: number,
	/** The least time between two clicks (ms): a jump, where nothing else takes a click */
	least = 0
): number[] {
	const sound = chart.sound;
	// (half beats; quarter beats from insane on)
	const division = preset.level >= 3 ? 4 : 2;
	const near = (time: number) => {
		let best: DashNote | null = null;
		for (const n of notes) {
			if (Math.abs(n.time - time) > 40) continue;
			if (!best || Math.abs(n.time - time) < Math.abs(best.time - time)) best = n;
		}
		return best;
	};
	/** How much happens at a moment: a note (more for a drum hitsound), what's heard, the beat */
	const score = (time: number) => {
		const note = near(time);
		let s = beatStrength(chart.timing, time) * 0.5;
		if (note) s += 1 + (note.sound & 12 ? 0.6 : 0) + (note.sound & 2 ? 0.2 : 0);
		if (sound?.hits) s += hitAt(sound, time) * 1.2;
		return s;
	};
	const heard = (time: number) => !!near(time) || (!!sound?.hits && hitAt(sound, time) > 0.35);

	// The two-bar windows of the part, on its timing points' grid
	const windows: { start: number; slot: number; slots: number }[] = [];
	for (let i = 0; i < chart.timing.length; i++) {
		const point = chart.timing[i];
		const until = Math.min(to, chart.timing[i + 1]?.time ?? Infinity);
		const span = point.beatLength * point.meter * 2;
		const first = point.time + Math.max(0, Math.floor((from - point.time) / span)) * span;
		for (let t = first; t < until; t += span)
			windows.push({
				start: t,
				slot: point.beatLength / division,
				slots: point.meter * 2 * division
			});
	}
	if (!windows.length) return [];
	// The part's pattern: per slot of the two bars, the mean of what happens there
	const slots = windows[0].slots;
	const mean = new Array<number>(slots).fill(0);
	let counted = 0;
	for (const w of windows) {
		if (w.slots !== slots) continue;
		for (let k = 0; k < slots; k++) mean[k] += score(w.start + k * w.slot);
		counted++;
	}
	for (let k = 0; k < slots; k++) mean[k] /= Math.max(1, counted);
	const want = Math.max(1, Math.round((DENSITY[preset.level] * slots) / division));
	// The strongest slots, at least half a beat apart (a quarter on the hardest)
	const apart = Math.max(
		preset.level >= 4 ? 1 : division / 2,
		Math.ceil(least / windows[0].slot - 0.01)
	);
	const order = mean.map((m, k) => ({ m, k })).sort((a, b) => b.m - a.m || a.k - b.k);
	const pattern: number[] = [];
	for (const { m, k } of order) {
		if (pattern.length >= want || m < 0.45) break;
		// (around the two bars too: the last slot and the next window's first)
		if (pattern.some((p) => Math.min(Math.abs(p - k), slots - Math.abs(p - k)) < apart)) continue;
		pattern.push(k);
	}
	// No long stretch without a click in it: the strongest slot in the middle of the longest gap
	// (around the two bars), while there's one
	const longest = Math.ceil((slots / want) * 1.5);
	for (let guard = 0; guard < slots && pattern.length; guard++) {
		pattern.sort((a, b) => a - b);
		let gap = 0;
		let from = 0;
		pattern.forEach((p, k) => {
			const to = k + 1 < pattern.length ? pattern[k + 1] : pattern[0] + slots;
			if (to - p > gap) {
				gap = to - p;
				from = p;
			}
		});
		if (gap <= longest) break;
		let pick = -1;
		for (let d = apart; d <= gap - apart; d++) {
			const k = (from + d) % slots;
			if (mean[k] < 0.3) continue;
			const centered = 1 - Math.abs(d - gap / 2) / gap;
			if (
				pick < 0 ||
				mean[k] * centered >
					mean[pick] * (1 - Math.abs(((pick - from + slots) % slots) - gap / 2) / gap)
			)
				pick = k;
		}
		if (pick < 0) break;
		pattern.push(pick);
	}
	pattern.sort((a, b) => a - b);
	const clicks: number[] = [];
	for (const w of windows) {
		const per = w.slots === slots ? pattern : pattern.map((k) => Math.round((k * w.slots) / slots));
		for (const k of per) {
			const time = Math.round(w.start + k * w.slot);
			if (time < from || time >= to || musicalRest(chart, time) || !heard(time)) continue;
			clicks.push(time);
		}
	}
	// (where two timing points' grids meet: not two clicks at once, nor closer than allowed)
	clicks.sort((a, b) => a - b);
	const kept = clicks.filter((t, k) => k === 0 || t - clicks[k - 1] >= Math.max(80, least - 5));
	return fillGaps(chart, notes, kept, preset, from, to, least, score, heard);
}

/** The longest stretch without a click, by difficulty (beats) */
const LONGEST = [6, 3, 2.5, 2, 2];

/**
 * No long stretch without a click where the music plays, in the part's real bars too: where its
 * pattern leaves one (a part whose rhythm changes from bar to bar has few slots strong in all of
 * them: a syncopated verse, empty bars, triplets), the strongest note heard near its middle is a
 * click as well, again and again until none is left
 */
function fillGaps(
	chart: DashChart,
	notes: DashNote[],
	clicks: number[],
	preset: Preset,
	from: number,
	to: number,
	least: number,
	score: (time: number) => number,
	heard: (time: number) => boolean
) {
	const out = [...clicks];
	const apart = Math.max(120, least - 5);
	const candidates = notes
		.map((n) => n.time)
		.filter((t) => t > from + 150 && t < to - 250 && !musicalRest(chart, t) && heard(t));
	for (let guard = 0; guard < 400; guard++) {
		out.sort((a, b) => a - b);
		const marks = [from + 150, ...out, to - 250];
		let added = false;
		for (let i = 1; i < marks.length && !added; i++) {
			const a = marks[i - 1];
			const b = marks[i];
			const beat = chart.timing.reduce((p, q) => (q.time <= a ? q : p), chart.timing[0]).beatLength;
			if (b - a <= LONGEST[preset.level] * beat) continue;
			// (the part of a gap where the music rests doesn't count)
			let rest = 0;
			for (let t = a; t < b; t += 100) if (musicalRest(chart, t)) rest += 100;
			if (b - a - rest <= LONGEST[preset.level] * beat) continue;
			let best = -1;
			let bestScore = -Infinity;
			for (const t of candidates) {
				if (t - a < apart || b - t < apart) continue;
				const middle = 1 - Math.abs(t - (a + b) / 2) / (b - a);
				const v = score(t) * (0.5 + middle);
				if (v > bestScore) {
					bestScore = v;
					best = t;
				}
			}
			if (best >= 0) {
				out.push(best);
				added = true;
			}
		}
		if (!added) break;
	}
	return out.sort((a, b) => a - b);
}
