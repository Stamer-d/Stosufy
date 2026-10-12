// What a DJ hears in a song before mixing it: how much energy (and bass) each bar has, where
// its intro ends and its outro starts, its phrases (8 bars, the blocks songs are built of)
// and its key. All from the decoded audio and the beatmap's beat grid and kiai (the parts
// mappers mark as the song's peaks: drops, choruses).

import { sectionAt, type Grid } from './grid';

export interface Section {
	start: number;
	end: number;
}

export interface SongAnalysis {
	/** One bar (s), at the song's main tempo */
	bar: number;
	/** Where the phrases are counted from (s): phrases are 8 bars from here */
	anchor: number;
	/** Energy of each bar (0–1 of the song's loudest) and of its bass */
	bars: { start: number; energy: number; bass: number }[];
	/** The peaks: drops / choruses */
	drops: Section[];
	/** Where the first peak starts: the end of the intro */
	introEnd: number;
	/** Where the last peak ends: the start of the outro */
	outroStart: number;
	/** The end of the last bar that's still heard */
	lastBar: number;
	/** The first downbeat that's heard */
	firstBar: number;
	key: { camelot: string; pitch: number; minor: boolean; confidence: number } | null;
}

export const PHRASE_BARS = 8;

/** The phrase boundary at or before a time */
export function phraseFloor(a: SongAnalysis, time: number) {
	const phrase = a.bar * PHRASE_BARS;
	return a.anchor + Math.floor((time - a.anchor) / phrase + 1e-6) * phrase;
}

/** The phrase boundary at or after a time */
export function phraseCeil(a: SongAnalysis, time: number) {
	const phrase = a.bar * PHRASE_BARS;
	return a.anchor + Math.ceil((time - a.anchor) / phrase - 1e-6) * phrase;
}

/** The phrase boundary nearest a time */
export function phraseRound(a: SongAnalysis, time: number) {
	const phrase = a.bar * PHRASE_BARS;
	return a.anchor + Math.round((time - a.anchor) / phrase) * phrase;
}

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The song as one quiet channel at a quarter of its rate (enough for energy and key) */
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

// --- Structure ---------------------------------------------------------------------------

/** Analyses a song (a second or so, in steps, so the app stays smooth) */
export async function analyzeSong(
	buffer: AudioBuffer,
	grid: Grid,
	kiai: Section[],
	cue: number
): Promise<SongAnalysis> {
	const { data, rate } = downmix(buffer);
	const duration = buffer.duration;
	const main = sectionAt(grid, duration / 2);
	const beat = main?.beat ?? 0.5;
	const bar = beat * (main?.meter ?? 4);
	const gridStart = main ? main.time - Math.floor(main.time / bar) * bar : 0;

	// Energy and bass of each bar (bass: a smoothed copy, below about 150 Hz)
	const bars: SongAnalysis['bars'] = [];
	const alpha = 1 - Math.exp((-2 * Math.PI * 150) / rate);
	let low = 0;
	let index = 0;
	for (let start = gridStart; start < duration; start += bar) {
		const from = Math.max(0, Math.floor(start * rate));
		const to = Math.min(data.length, Math.floor((start + bar) * rate));
		let sum = 0;
		let bass = 0;
		for (let i = from; i < to; i++) {
			const v = data[i];
			low += alpha * (v - low);
			sum += v * v;
			bass += low * low;
		}
		const n = Math.max(1, to - from);
		bars.push({ start, energy: Math.sqrt(sum / n), bass: Math.sqrt(bass / n) });
		if (++index % 64 === 0) await yieldNow();
	}
	const loudest = Math.max(1e-6, ...bars.map((b) => b.energy));
	const deepest = Math.max(1e-6, ...bars.map((b) => b.bass));
	for (const b of bars) {
		b.energy /= loudest;
		b.bass /= deepest;
	}
	const sorted = bars.map((b) => b.energy).sort((a, b) => a - b);
	const median = sorted[sorted.length >> 1] ?? 0;
	const high = sorted[Math.floor(sorted.length * 0.85)] ?? 1;

	// The peaks: the mapper's kiai, else the loudest stretches (4 bars or more)
	let drops = kiai.filter((k) => k.end - k.start >= bar * 2);
	if (!drops.length) {
		const threshold = Math.max(median, high * 0.88);
		let run: Section | null = null;
		for (const b of bars) {
			if (b.energy >= threshold) {
				if (run) run.end = b.start + bar;
				else run = { start: b.start, end: b.start + bar };
			} else if (run) {
				if (run.end - run.start >= bar * 4) drops.push(run);
				run = null;
			}
		}
		if (run && run.end - run.start >= bar * 4) drops.push(run);
	}

	const heard = bars.filter((b) => b.energy > Math.max(0.04, median * 0.15));
	const firstBar = Math.max(cue, heard[0]?.start ?? cue);
	const lastBar = Math.min(duration, (heard.at(-1)?.start ?? duration - bar) + bar);
	// Phrases are counted from the first peak (peaks start on phrases), else the first bar
	const anchor = drops[0]?.start ?? firstBar;
	const partial: SongAnalysis = {
		bar,
		anchor,
		bars,
		drops,
		introEnd: 0,
		outroStart: 0,
		lastBar,
		firstBar,
		key: null
	};
	partial.introEnd = drops.length ? phraseRound(partial, drops[0].start) : firstBar;
	partial.outroStart = drops.length
		? Math.min(lastBar, phraseRound(partial, drops[drops.length - 1].end))
		: phraseFloor(partial, Math.max(firstBar, lastBar - bar * 16));
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
