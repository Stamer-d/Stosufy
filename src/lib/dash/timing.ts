// The beatmap's timing points against the song itself. A mapper sets where the tempo changes and
// where its beats are by ear, and now and then a bit off: a new tempo's line a bar too early or
// too late, or its beats a few ms beside the song's (and the notes snapped to them with them).
// The level's speed portals, its clicks on the beat grid and its light go by those points, so
// they're checked against what's heard (the song's hits, see audio.ts) and set right where the
// song says clearly otherwise. Where it can't be heard, or it's not clear, the map's stay.

import type { DashChart, DashNote, TimingPoint } from './chart';
import type { SongSound } from './audio';

/** How hard the song hits at a moment, read between its frames (a sharp read, unlike hitAt) */
function hitNear(sound: SongSound, time: number) {
	const hits = sound.hits!;
	const at = time / sound.hop;
	const n = Math.floor(at);
	let sum = 0;
	for (let j = -1; j <= 2; j++) {
		const k = n + j;
		if (k < 0 || k >= hits.length) continue;
		sum += hits[k] * Math.max(0, 1 - Math.abs(at - k) / 1.5);
	}
	return sum;
}

/** How well a grid's beats fit what's heard between two times: the mean hit on its beats */
function fit(sound: SongSound, origin: number, beat: number, from: number, to: number) {
	let sum = 0;
	let n = 0;
	for (let t = origin + Math.ceil((from - origin) / beat) * beat; t < to; t += beat) {
		sum += hitNear(sound, t);
		n++;
	}
	return n ? sum / n : 0;
}

/**
 * How far each timing point's beats are off the song's (ms, from -60 to 60), and how clear that
 * is (how much better than the grid around it), on up to 16 bars after it
 */
function offsets(sound: SongSound, timing: TimingPoint[], end: number) {
	return timing.map((p, i) => {
		const to = Math.min(timing[i + 1]?.time ?? end, end);
		const until = Math.min(to, p.time + p.beatLength * p.meter * 16);
		const beats = (until - p.time) / p.beatLength;
		/** How long the song is on it (ms): what weighs for the song's usual offset */
		const span = Math.max(0, to - p.time);
		if (beats < 8) return { shift: 0, clear: 0, beats, span };
		let best = 0;
		let most = -Infinity;
		let sum = 0;
		let count = 0;
		for (let d = -60; d <= 60; d += 2) {
			const f = fit(sound, p.time + d, p.beatLength, p.time + d, until);
			sum += f;
			count++;
			if (f > most) {
				most = f;
				best = d;
			}
		}
		const mean = sum / count;
		return { shift: best, clear: mean > 0 ? most / mean : 0, beats, span };
	});
}

/**
 * Where the tempo really changes, near a timing point with a new one: on its grid, up to eight of
 * its beats either way, where what comes before fits the old grid and what comes after the new.
 * The point's own time unless another is clearly better.
 */
function changeAt(sound: SongSound, before: TimingPoint, point: TimingPoint, next: number) {
	const steps: number[] = [];
	for (let k = -8; k <= 8; k++) {
		const c = point.time + k * point.beatLength;
		if (c > before.time + 2 * before.beatLength && c < next - 2 * point.beatLength) steps.push(c);
	}
	if (steps.length < 3 || !steps.includes(point.time)) return point.time;
	// Per step of the new grid: how much better the old grid fits it than the new one
	// (on half beats: the eighths tell the two tempos apart where their beats are too few)
	const half = before.beatLength / 2;
	const better = steps.slice(0, -1).map((c, k) => {
		const to = steps[k + 1];
		// (no half beat of the old grid in this step: nothing to tell)
		const first = before.time + Math.ceil((c - 1 - before.time) / half) * half;
		if (first >= to - 1) return 0;
		const fresh = (hitNear(sound, c) + hitNear(sound, c + point.beatLength / 2)) / 2;
		return fit(sound, before.time, half, c - 1, to - 1) - fresh;
	});
	// (the change at step j: the steps before it old, those from it on new)
	let score = 0;
	let best = 0;
	let bestScore = -Infinity;
	let own = 0;
	for (let j = 0; j < steps.length; j++) {
		if (score > bestScore) {
			bestScore = score;
			best = j;
		}
		if (steps[j] === point.time) own = score;
		if (j < better.length) score += better[j];
	}
	return bestScore - own >= 0.6 ? steps[best] : point.time;
}

/**
 * The chart with its timing points where the song has them: a new tempo where it's heard to
 * change, and beats a few ms off the rest of the song's moved onto the song's (with the notes on
 * them). Unchanged without the song's hits, and where it isn't clear.
 */
export function alignTiming(chart: DashChart): DashChart {
	const sound = chart.sound;
	if (!sound?.hits || chart.timing.length === 0) return chart;
	const end = sound.hits.length * sound.hop;
	const timing = chart.timing.map((p) => ({ ...p }));
	let notes = chart.notes;

	// Beats beside the song's: against how far off the song's beats are overall (the same for all
	// of them is how the song's hits are heard, not the map)
	const off = offsets(sound, timing, end);
	const sure = off.filter((o) => o.beats >= 8 && o.clear >= 1.3);
	if (sure.length >= 2) {
		// (the offset most of the song is on)
		const sorted = [...sure].sort((a, b) => a.shift - b.shift);
		let weight = sorted.reduce((s, o) => s + o.span, 0) / 2;
		let usual = sorted[0].shift;
		for (const o of sorted) {
			weight -= o.span;
			usual = o.shift;
			if (weight < 0) break;
		}
		const moved: { from: number; to: number; by: number }[] = [];
		timing.forEach((p, i) => {
			const o = off[i];
			const by = o.shift - usual;
			if (o.beats < 8 || o.clear < 1.3 || Math.abs(by) < 10) return;
			moved.push({ from: p.time, to: timing[i + 1]?.time ?? Infinity, by });
		});
		for (const m of moved) {
			const p = timing.find((q) => q.time === m.from)!;
			p.time += m.by;
		}
		if (moved.length)
			notes = notes.map((n): DashNote => {
				const m = moved.find((q) => n.time >= q.from - 1 && n.time < q.to - 1);
				return m ? { ...n, time: n.time + m.by, end: n.end + m.by } : n;
			});
	}

	// A new tempo where the song changes to it
	for (let i = 1; i < timing.length; i++) {
		const ratio = timing[i - 1].beatLength / timing[i].beatLength;
		if (Math.abs(Math.log(ratio)) < Math.log(1.03)) continue;
		const next = timing[i + 1]?.time ?? end;
		timing[i].time = changeAt(sound, timing[i - 1], timing[i], next);
	}
	timing.sort((a, b) => a.time - b.time);
	if (notes === chart.notes && timing.every((p, i) => p.time === chart.timing[i].time))
		return chart;
	return { ...chart, timing, notes };
}
