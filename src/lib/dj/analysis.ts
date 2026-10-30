// What a DJ hears in a song before mixing it: where its beats really are in the audio, how
// much energy each bar has, its sections (intro, the peaks, breakdowns, outro), its phrases,
// how it ends (an outro, a fade, a last hit) and its key. From the decoded audio and the
// beatmap's beat grid and kiai (the parts mappers mark as the song's peaks).

import { downbeats, sectionAt, shiftGrid, type Grid } from './grid';

export interface Section {
	start: number;
	end: number;
}

export interface Bar {
	start: number;
	end: number;
	/** Loudness (0–1 of the song's loudest bar), of its bass, mids (vocals, leads) and highs */
	energy: number;
	bass: number;
	mid: number;
	high: number;
}

/** How a song ends: a quieter outro, a fade, a last hit (or stop) on the one, or full on */
export type Ending = 'outro' | 'fade' | 'hard' | 'cut';

export interface SongAnalysis {
	/** One bar and one beat (s), at the song's main tempo */
	bar: number;
	beat: number;
	/** The bars, on the grid */
	bars: Bar[];
	/** The peaks: drops / choruses */
	drops: Section[];
	/** Where the song changes (kiai edges, a big change in its sound) */
	boundaries: number[];
	/** Where phrases start: every boundary, and every 8 bars after it */
	phrases: number[];
	/** The first downbeat heard, and the end of the last bar heard */
	firstBar: number;
	lastBar: number;
	/** Where it really gets going (its intro ends) */
	introEnd: number;
	/** Where its last peak is over (its outro starts) */
	outroStart: number;
	ending: Ending;
	/** The downbeat of its last hit, or where it stops (null: it fades or plays on) */
	endHit: number | null;
	/** How loud its peaks are (0–1, like the bars' energy), and how full their mids are */
	peakLevel: number;
	peakMid: number;
	/** The loudest bar's level (RMS): the bars' energies times this are levels */
	loudest: number;
	/** The loudest bar's bass, mids and highs (RMS): the bars' bands times these are levels */
	bandsLoudest: { bass: number; mid: number; high: number };
	key: { camelot: string; pitch: number; minor: boolean; confidence: number } | null;
	/** How far the beatmap's grid was off the beats in this audio (s): added to it */
	shift: number;
}

export const PHRASE_BARS = 8;

/** The index of the bar a time is in (-1 before the first) */
export function barIndex(a: SongAnalysis, time: number) {
	let lo = 0;
	let hi = a.bars.length - 1;
	if (hi < 0 || time < a.bars[0].start - 1e-6) return -1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (a.bars[mid].start <= time + 1e-6) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/**
 * A time some bars after another (on the song's own bars, across tempo changes too). Part of
 * a bar (half time against double time) is that part of the main bar.
 */
export function barsLater(a: SongAnalysis, time: number, bars: number) {
	const i = barIndex(a, time);
	if (i < 0) return time + bars * a.bar;
	const whole = Math.floor(bars + 1e-9);
	const part = (bars - whole) * a.bar;
	const into = time - a.bars[i].start;
	const j = i + whole;
	if (j < 0) return a.bars[0].start + j * a.bar + into + part;
	if (j >= a.bars.length) return a.bars.at(-1)!.end + (j - a.bars.length) * a.bar + into + part;
	return a.bars[j].start + into + part;
}

/** Bars from one downbeat to another */
export function barsBetween(a: SongAnalysis, from: number, to: number) {
	const i = barIndex(a, from);
	const j = barIndex(a, to);
	if (i < 0 || j < 0) return Math.round((to - from) / a.bar);
	return j - i + Math.round((to - a.bars[j].start - (from - a.bars[i].start)) / a.bar);
}

/** The phrase start at or after a time */
export function phraseCeil(a: SongAnalysis, time: number) {
	return a.phrases.find((p) => p >= time - 1e-3) ?? a.lastBar;
}

/** The phrase start at or before a time */
export function phraseFloor(a: SongAnalysis, time: number) {
	let found = a.phrases[0] ?? a.firstBar;
	for (const p of a.phrases) {
		if (p <= time + 1e-3) found = p;
		else break;
	}
	return found;
}

/** The bar start at or after a time */
export function barCeil(a: SongAnalysis, time: number) {
	return a.bars.find((b) => b.start >= time - 1e-3)?.start ?? a.lastBar;
}

/**
 * Where a song really gets going after a point: its next peak, or before it a stretch nearly
 * as loud as its peaks (a verse with vocals, the full beat). What comes before is its intro.
 */
export function kickIn(a: SongAnalysis, from: number) {
	// (a peak of a few bars in an intro, a mapper's flash, isn't where it gets going)
	const peak =
		a.drops.find((d) => d.start > from + a.bar * 0.5 && d.end - d.start >= a.bar * 3.5)?.start ??
		Infinity;
	const i = Math.max(0, barIndex(a, from));
	let loud = Infinity;
	// (nearly as loud as its peaks, or with mids as full: a beat alone isn't the song yet)
	const full = (b: Bar) => b.energy >= a.peakLevel * 0.8 || b.mid >= a.peakMid * 0.85;
	for (let k = i; k < a.bars.length - 1; k++) {
		if (full(a.bars[k]) && full(a.bars[k + 1])) {
			loud = a.bars[k].start;
			break;
		}
	}
	const at = Math.min(peak, loud);
	if (!Number.isFinite(at)) return from;
	// On the section or phrase it's in (a full bar just before one still starts with it)
	const phrase = phraseFloor(a, at + a.bar * 1.5);
	return phrase >= from - 1e-3 && phrase <= at + a.bar * 1.5 ? phrase : at;
}

/** How loud a stretch of a song is (RMS, on the same scale for every song) */
export function levelBetween(a: SongAnalysis, from: number, to: number) {
	const inside = a.bars.filter((b) => b.start >= from - 0.01 && b.start < to - 0.01);
	if (!inside.length) return null;
	const power = inside.reduce((sum, b) => sum + b.energy * b.energy, 0) / inside.length;
	return Math.sqrt(power) * a.loudest;
}

/** How busy a stretch is compared with the song's peaks (0: quiet, 1: as full as a peak) */
export function busyness(a: SongAnalysis, from: number, to: number) {
	const level = levelBetween(a, from, to);
	return level == null ? 0 : level / (a.peakLevel * a.loudest || 1);
}

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The song as one channel at a quarter of its rate (enough for beats, energy and key) */
function downmix(buffer: AudioBuffer) {
	const factor = 4;
	const length = Math.floor(buffer.length / factor);
	const out = new Float32Array(length);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	for (const data of channels) {
		for (let i = 0; i < length; i++) {
			let sum = 0;
			for (let k = 0; k < factor; k++) sum += data[i * factor + k];
			out[i] += sum / factor / channels.length;
		}
	}
	return { data: out, rate: buffer.sampleRate / factor };
}

// --- Key ---------------------------------------------------------------------------------

// Krumhansl–Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Camelot numbers of the major keys by their tonic (C = 0) */
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

/** The Camelot code of a key (minor keys share the number of their relative major) */
export function camelot(pitch: number, minor: boolean) {
	const p = ((pitch % 12) + 12) % 12;
	return minor ? `${CAMELOT_MAJOR[(p + 3) % 12]}A` : `${CAMELOT_MAJOR[p]}B`;
}

/** In place, radix-2 */
function fft(re: Float32Array, im: Float32Array) {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let size = 2; size <= n; size <<= 1) {
		const angle = (-2 * Math.PI) / size;
		const wr = Math.cos(angle);
		const wi = Math.sin(angle);
		for (let start = 0; start < n; start += size) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < size / 2; k++) {
				const a = start + k;
				const b = a + size / 2;
				const tr = re[b] * cr - im[b] * ci;
				const ti = re[b] * ci + im[b] * cr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
				const next = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = next;
			}
		}
	}
}

async function detectKey(data: Float32Array, rate: number) {
	const size = 8192;
	const chroma = new Float64Array(12);
	const frame = new Float64Array(12);
	const re = new Float32Array(size);
	const im = new Float32Array(size);
	const half = size / 2;
	// The pitch class of each bin (60 Hz to 2.1 kHz) and how close it is to a note, worked out once
	const classes = new Int8Array(half).fill(-1);
	const weights = new Float32Array(half);
	let first = half;
	let last = 0;
	for (let bin = 1; bin < half; bin++) {
		const f = (bin * rate) / size;
		if (f < 60 || f > 2100) continue;
		const note = 12 * Math.log2(f / 440) + 69;
		const nearest = Math.round(note);
		classes[bin] = (((nearest % 12) + 12) % 12) as number;
		weights[bin] = Math.max(0, 1 - Math.abs(note - nearest) / 0.5);
		first = Math.min(first, bin);
		last = Math.max(last, bin);
	}
	const window = new Float32Array(size).map(
		(_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
	);
	const power = new Float32Array(half);
	const sorted = new Float32Array(last - first + 1);
	let frames = 0;
	for (let start = 0; start + size < data.length; start += size) {
		for (let i = 0; i < size; i++) {
			re[i] = data[start + i] * window[i];
			im[i] = 0;
		}
		fft(re, im);
		for (let bin = first; bin <= last; bin++) power[bin] = re[bin] * re[bin] + im[bin] * im[bin];
		// Only the tones: peaks well above the frame's noise (drums, hats) count
		sorted.set(power.subarray(first, last + 1));
		sorted.sort();
		const floor = sorted[sorted.length >> 1] * 4;
		frame.fill(0);
		let sum = 0;
		for (let bin = first + 1; bin < last; bin++) {
			const p = power[bin];
			if (p <= floor || p <= power[bin - 1] || p < power[bin + 1] || classes[bin] < 0) continue;
			const v = Math.sqrt(p) * weights[bin];
			frame[classes[bin]] += v;
			sum += v;
		}
		// Every frame counts the same, loud or quiet
		if (sum > 0) for (let c = 0; c < 12; c++) chroma[c] += frame[c] / sum;
		if (++frames % 20 === 0) await yieldNow();
	}
	const mean = (list: ArrayLike<number>) => {
		let s = 0;
		for (let i = 0; i < 12; i++) s += list[i];
		return s / 12;
	};
	const correlate = (profile: number[], tonic: number) => {
		const mc = mean(chroma);
		const mp = mean(profile);
		let num = 0;
		let a = 0;
		let b = 0;
		for (let i = 0; i < 12; i++) {
			const x = chroma[(i + tonic) % 12] - mc;
			const y = profile[i] - mp;
			num += x * y;
			a += x * x;
			b += y * y;
		}
		return num / Math.sqrt(a * b || 1);
	};
	const scores: { pitch: number; minor: boolean; score: number }[] = [];
	for (let tonic = 0; tonic < 12; tonic++)
		for (const minor of [false, true])
			scores.push({ pitch: tonic, minor, score: correlate(minor ? MINOR : MAJOR, tonic) });
	scores.sort((x, y) => y.score - x.score);
	const best = scores[0];
	// How sure: the lead over the next key that would mix differently (a key and its relative
	// minor/major sound alike and sit on the same Camelot number)
	const number = (k: { pitch: number; minor: boolean }) => camelot(k.pitch, k.minor).slice(0, -1);
	const second = scores.find((k) => number(k) !== number(best))?.score ?? -2;
	if (!(best.score > 0.3)) return null;
	return {
		camelot: camelot(best.pitch, best.minor),
		pitch: best.pitch,
		minor: best.minor,
		confidence: Math.max(0, Math.min(1, (best.score - second) * 8))
	};
}

// --- Where the beats are --------------------------------------------------------------------

const ONSET_HOP = 32;
const ONSET_SIZE = 64;

/** How strongly something starts (a hit) in each moment (2.9 ms steps) */
async function onsetEnvelope(data: Float32Array, rate: number) {
	const frames = Math.max(0, Math.floor((data.length - ONSET_SIZE) / ONSET_HOP));
	const env = new Float32Array(frames);
	const alpha = 1 - Math.exp((-2 * Math.PI * 150) / rate);
	let low = 0;
	let lowAt = 0;
	let previousFull = 0;
	let previousLow = 0;
	for (let f = 0; f < frames; f++) {
		const from = f * ONSET_HOP;
		let full = 0;
		let bass = 0;
		for (let i = from; i < from + ONSET_SIZE; i++) {
			const d = data[i] - (i > 0 ? data[i - 1] : 0);
			full += d * d;
			// (the low-pass runs once over the song: the frames overlap)
			while (lowAt <= i) {
				low += alpha * (data[lowAt] - low);
				lowAt++;
			}
			bass += low * low;
		}
		const lf = Math.log(1 + 1000 * full);
		const lb = Math.log(1 + 1000 * bass);
		env[f] = Math.max(0, lf - previousFull) + 0.5 * Math.max(0, lb - previousLow);
		previousFull = lf;
		previousLow = lb;
		if (f % 20000 === 0) await yieldNow();
	}
	return env;
}

/**
 * How far the beatmap's beats are off the hits in this audio (s): decoders don't all start
 * a song at the same sample (an MP3's encoder delay), and two songs a few milliseconds apart
 * flam in a mix. Only a clear offset counts.
 */
async function gridOffset(data: Float32Array, rate: number, grid: Grid, from: number, to: number) {
	if (!grid.length) return 0;
	const env = await onsetEnvelope(data, rate);
	const frameOf = (t: number) => (t * rate - ONSET_SIZE + ONSET_HOP / 2) / ONSET_HOP;
	const beats: number[] = [];
	grid.forEach((point, i) => {
		const end = Math.min(grid[i + 1]?.time ?? Infinity, to);
		for (
			let k = Math.ceil((Math.max(from, i ? point.time : from) - point.time) / point.beat);
			;
			k++
		) {
			const t = point.time + k * point.beat;
			if (t >= end) break;
			beats.push(t);
		}
	});
	if (beats.length < 32) return 0;
	const score = (shift: number) => {
		let sum = 0;
		for (const b of beats) {
			const f = Math.round(frameOf(b + shift));
			if (f < 1 || f + 1 >= env.length) continue;
			sum += Math.max(env[f - 1], env[f], env[f + 1]);
		}
		return sum;
	};
	let best = 0;
	let bestScore = score(0);
	const none = bestScore;
	for (let ms = -50; ms <= 50; ms++) {
		const s = score(ms / 1000);
		if (s > bestScore) {
			bestScore = s;
			best = ms / 1000;
		}
	}
	return Math.abs(best) >= 0.008 && bestScore > none * 1.12 ? best : 0;
}

// --- Structure ---------------------------------------------------------------------------

/** Analyses a song (a second or so, in steps, so the app stays smooth) */
export async function analyzeSong(
	buffer: AudioBuffer,
	beatmapGrid: Grid,
	beatmapKiai: Section[],
	cue: number
): Promise<SongAnalysis> {
	const { data, rate } = downmix(buffer);
	const duration = buffer.duration;
	const shift = await gridOffset(data, rate, beatmapGrid, Math.max(0, cue), duration - 1).catch(
		() => 0
	);
	const grid = shiftGrid(beatmapGrid, shift);
	const kiai = beatmapKiai.map((k) => ({ start: k.start + shift, end: k.end + shift }));
	const main = sectionAt(grid, duration / 2);
	const beat = main?.beat ?? 0.5;
	const bar = beat * (main?.meter ?? 4);

	// Energy, bass (below about 150 Hz), mids (200 Hz to 2.5 kHz) and highs of each bar
	const starts = grid.length
		? downbeats(grid, -bar, duration)
		: Array.from({ length: Math.ceil(duration / bar) }, (_, i) => i * bar);
	const bars: Bar[] = [];
	const aLow = 1 - Math.exp((-2 * Math.PI * 150) / rate);
	const aHigh = Math.exp((-2 * Math.PI * 2500) / rate);
	const aMidLow = 1 - Math.exp((-2 * Math.PI * 200) / rate);
	const aMidHigh = 1 - Math.exp((-2 * Math.PI * 2500) / rate);
	let midLow = 0;
	let midHigh = 0;
	let low = 0;
	let high = 0;
	let previous = 0;
	let at = 0;
	for (let n = 0; n < starts.length; n++) {
		const start = starts[n];
		const end = starts[n + 1] ?? Math.min(duration, start + bar);
		if (end <= 0) continue;
		const from = Math.max(0, Math.floor(start * rate));
		const to = Math.min(data.length, Math.floor(end * rate));
		// (the filters run on through the song)
		for (; at < from; at++) {
			low += aLow * (data[at] - low);
			midLow += aMidLow * (data[at] - midLow);
			midHigh += aMidHigh * (data[at] - midHigh);
			high = aHigh * (high + data[at] - previous);
			previous = data[at];
		}
		let sum = 0;
		let bass = 0;
		let highs = 0;
		let mids = 0;
		for (; at < to; at++) {
			const v = data[at];
			low += aLow * (v - low);
			midLow += aMidLow * (v - midLow);
			midHigh += aMidHigh * (v - midHigh);
			mids += (midHigh - midLow) * (midHigh - midLow);
			high = aHigh * (high + v - previous);
			previous = v;
			sum += v * v;
			bass += low * low;
			highs += high * high;
		}
		const count = Math.max(1, to - from);
		bars.push({
			start,
			end,
			energy: Math.sqrt(sum / count),
			bass: Math.sqrt(bass / count),
			mid: Math.sqrt(mids / count),
			high: Math.sqrt(highs / count)
		});
		if (n % 64 === 0) await yieldNow();
	}
	const loudest = Math.max(1e-6, ...bars.map((b) => b.energy));
	const deepest = Math.max(1e-6, ...bars.map((b) => b.bass));
	const brightest = Math.max(1e-6, ...bars.map((b) => b.high));
	const fullest = Math.max(1e-6, ...bars.map((b) => b.mid));
	for (const b of bars) {
		b.energy /= loudest;
		b.bass /= deepest;
		b.mid /= fullest;
		b.high /= brightest;
	}
	const sorted = bars.map((b) => b.energy).sort((x, y) => x - y);
	const median = sorted[sorted.length >> 1] ?? 0;
	const top = sorted[Math.floor(sorted.length * 0.85)] ?? 1;

	// The peaks: the mapper's kiai (pieces of one chorus less than 4 bars apart as one), else
	// the loudest stretches (4 bars or more)
	let drops: Section[] = [];
	for (const k of [...kiai].sort((x, y) => x.start - y.start)) {
		const last = drops.at(-1);
		if (last && k.start - last.end < bar * 4) last.end = Math.max(last.end, k.end);
		else drops.push({ ...k });
	}
	drops = drops.filter((k) => k.end - k.start >= bar * 2);
	if (!drops.length) {
		const threshold = Math.max(median, top * 0.88);
		let run: Section | null = null;
		for (const b of bars) {
			if (b.energy >= threshold) {
				if (run) run.end = b.end;
				else run = { start: b.start, end: b.end };
			} else if (run) {
				if (run.end - run.start >= bar * 4) drops.push(run);
				run = null;
			}
		}
		if (run && run.end - run.start >= bar * 4) drops.push(run);
	}
	const peakBars = bars.filter((b) =>
		drops.some((d) => b.start >= d.start - 0.01 && b.start < d.end - 0.01)
	);
	const middle = (list: number[]) => list.sort((x, y) => x - y)[list.length >> 1];
	const peakLevel = peakBars.length ? middle(peakBars.map((b) => b.energy)) : top;
	const peakMid = peakBars.length
		? middle(peakBars.map((b) => b.mid))
		: (middle(bars.map((b) => b.mid)) ?? 1);

	const heardLevel = Math.max(0.04, median * 0.15);
	const heard = bars.filter((b) => b.energy > heardLevel);
	const firstBar = Math.max(heard[0]?.start ?? 0, Math.min(cue + shift, heard[0]?.start ?? 0));
	const lastHeard = heard.at(-1) ?? bars.at(-1);
	const lastBar = Math.min(duration, lastHeard?.end ?? duration);
	const index = (time: number) => {
		let found = -1;
		for (let i = 0; i < bars.length; i++) {
			if (bars[i].start <= time + 1e-3) found = i;
			else break;
		}
		return found;
	};
	const first = Math.max(0, index(firstBar));
	const last = Math.max(first, index(lastBar - bar * 0.5));

	// Where the song changes: kiai edges (on the nearest bar), and big changes in its sound
	// (energy, bass, highs: the 4 bars after against the 4 before)
	const marks: { bar: number; strength: number }[] = [];
	for (const k of kiai)
		for (const edge of [k.start, k.end]) {
			const i = index(edge + bar * 0.5);
			if (i >= first && i <= last + 1) marks.push({ bar: i, strength: 2 });
		}
	const novelty: number[] = bars.map(() => 0);
	const mean = (from: number, to: number, key: 'energy' | 'bass' | 'mid' | 'high') => {
		let sum = 0;
		for (let i = from; i < to; i++) sum += bars[i][key];
		return sum / (to - from);
	};
	for (let i = first + 4; i <= last - 3; i++)
		novelty[i] = (['energy', 'bass', 'mid', 'high'] as const).reduce(
			(sum, key) => sum + Math.abs(mean(i, i + 4, key) - mean(i - 4, i, key)),
			0
		);
	for (let i = first + 4; i <= last - 3; i++) {
		const n = novelty[i];
		if (
			n >= 0.3 &&
			n >= novelty[i - 1] &&
			n > novelty[i + 1] &&
			n >= novelty[i - 2] &&
			n > novelty[i + 2]
		)
			marks.push({ bar: i, strength: n });
	}
	marks.push({ bar: first, strength: 3 });
	marks.sort((x, y) => x.bar - y.bar || y.strength - x.strength);
	const kept: number[] = [];
	for (const mark of marks) {
		const previousMark = kept.at(-1);
		if (previousMark != null && mark.bar - previousMark < 2) continue;
		kept.push(mark.bar);
	}
	const boundaries = kept.filter((i) => i < bars.length).map((i) => bars[i].start);
	// Phrases: a boundary, then every 8 bars until the next one
	const phraseBars: number[] = [];
	kept.forEach((start, j) => {
		const next = kept[j + 1] ?? last + 1;
		for (let i = start; i < next - 1 || i === start; i += PHRASE_BARS) phraseBars.push(i);
	});
	if (!phraseBars.includes(last + 1)) phraseBars.push(last + 1);
	const phrases = phraseBars
		.filter((i) => i >= 0)
		.map((i) => bars[i]?.start ?? lastBar)
		.filter((t, i, list) => i === 0 || t > list[i - 1]);

	const partial: SongAnalysis = {
		bar,
		beat,
		bars,
		drops,
		boundaries,
		phrases,
		firstBar,
		lastBar,
		introEnd: firstBar,
		outroStart: lastBar,
		ending: 'cut',
		endHit: null,
		peakLevel,
		peakMid,
		loudest,
		bandsLoudest: { bass: deepest, mid: fullest, high: brightest },
		key: null,
		shift
	};
	partial.introEnd = kickIn(partial, firstBar);

	// The outro: after the last peak, or after the last loud stretch
	let lastLoud = -1;
	for (let i = last; i >= first; i--)
		if (bars[i].energy >= peakLevel * 0.72) {
			lastLoud = i;
			break;
		}
	const peakEnd = drops.length ? drops.at(-1)!.end : lastLoud >= 0 ? bars[lastLoud].end : firstBar;
	const nearPhrase = phrases.find((p) => Math.abs(p - peakEnd) <= bar * 1.5);
	partial.outroStart = Math.min(
		lastBar,
		nearPhrase ?? bars[index(peakEnd + bar * 0.5)]?.start ?? peakEnd
	);
	const outroBars = Math.round((lastBar - partial.outroStart) / bar);
	const outroBusy = busyness(partial, partial.outroStart, lastBar);

	// The last hit: the last loud beat, with (nearly) nothing after it
	const beatLevel = (from: number) => {
		const a = Math.max(0, Math.floor(from * rate));
		const b = Math.min(data.length, Math.floor((from + beat) * rate));
		let sum = 0;
		for (let i = a; i < b; i++) sum += data[i] * data[i];
		return Math.sqrt(sum / Math.max(1, b - a)) / loudest;
	};
	let lastLoudBeat: number | null = null;
	for (let t = lastBar - beat; t >= Math.max(firstBar, lastBar - bar * 6); t -= beat) {
		if (beatLevel(t) >= peakLevel * 0.45) {
			lastLoudBeat = t;
			break;
		}
	}
	if (lastLoudBeat != null && lastBar - lastLoudBeat <= bar * 2.5) {
		// On the one: the hit's own downbeat, or (a bar that's loud to its end) the next one
		const i = index(lastLoudBeat + 1e-3);
		const intoBar = i >= 0 ? lastLoudBeat - bars[i].start : 0;
		const onOne = intoBar < beat * 0.5;
		partial.endHit = onOne ? bars[i].start : (bars[i + 1]?.start ?? lastBar);
	}

	// A fade: steadily quieter over its last bars
	const level = (from: number, to: number) => {
		const list = bars.slice(Math.max(first, from), Math.max(first, to) + 1);
		return list.reduce((s, b) => s + b.energy, 0) / Math.max(1, list.length);
	};
	const early = level(last - 11, last - 8);
	const late = level(last - 3, last);
	let steady = true;
	for (let i = last - 7; i <= last; i++)
		if (i > first && bars[i].energy > bars[i - 1].energy * 1.2) steady = false;
	const fades = early >= peakLevel * 0.45 && late <= early * 0.45 && steady;

	partial.ending =
		outroBars >= 4 && outroBusy <= 0.75
			? 'outro'
			: fades
				? 'fade'
				: partial.endHit != null
					? 'hard'
					: 'cut';
	partial.key = await detectKey(data, rate).catch(() => null);
	return partial;
}

// --- How well two songs go together ---------------------------------------------------------

/**
 * How well two keys go together (2: same or neighbours on the Camelot wheel, 1: still fine,
 * 0: clash), after the new song's pitch moved by its tempo change (no key lock)
 */
export function keyFit(a: SongAnalysis['key'], b: SongAnalysis['key'], rate = 1): number | null {
	if (!a || !b || a.confidence < 0.15 || b.confidence < 0.15) return null;
	const shift = Math.round(12 * Math.log2(rate));
	const code = (pitch: number, minor: boolean) => {
		const c = camelot(pitch, minor);
		return { number: Number(c.slice(0, -1)), letter: c.slice(-1) };
	};
	const x = code(a.pitch, a.minor);
	const y = code(b.pitch + shift, b.minor);
	const steps = Math.min((x.number - y.number + 12) % 12, (y.number - x.number + 12) % 12);
	if (x.letter === y.letter && steps <= 1) return 2;
	if (x.letter !== y.letter && steps === 0) return 2;
	if (x.letter === y.letter && steps === 2) return 1;
	if (x.letter !== y.letter && steps === 1) return 1;
	return 0;
}

/**
 * What can be said about a song from its beat grid alone (before it's analysed): its bars,
 * phrases every 8 bars from its first downbeat, no intro or outro
 */
export function roughAnalysis(grid: Grid, duration: number, cue: number): SongAnalysis {
	const main = sectionAt(grid, duration / 2);
	const beat = main?.beat ?? 0.5;
	const bar = beat * (main?.meter ?? 4);
	const starts = grid.length
		? downbeats(grid, Math.max(0, cue) - 0.01, duration)
		: Array.from({ length: Math.ceil(duration / bar) }, (_, i) => i * bar);
	const bars: Bar[] = starts.map((start, i) => ({
		start,
		end: starts[i + 1] ?? Math.min(duration, start + bar),
		energy: 1,
		bass: 1,
		mid: 1,
		high: 1
	}));
	const firstBar = bars[0]?.start ?? 0;
	const lastBar = bars.at(-1)?.end ?? duration;
	const phrases = bars.filter((_, i) => i % PHRASE_BARS === 0).map((b) => b.start);
	phrases.push(lastBar);
	return {
		bar,
		beat,
		bars,
		drops: [],
		boundaries: [firstBar],
		phrases,
		firstBar,
		lastBar,
		introEnd: firstBar,
		outroStart: lastBar,
		ending: 'cut',
		endHit: null,
		peakLevel: 1,
		peakMid: 1,
		loudest: 1,
		bandsLoudest: { bass: 1, mid: 1, high: 1 },
		key: null,
		shift: 0
	};
}
