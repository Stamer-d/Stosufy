// Where the song is, heard rather than asked. The hitsounds are set on the audio clock; the
// song's place comes from its <audio> element, and a phone tells that only roughly: Safari
// works it out from a reading up to seconds old, and the sound takes its own time from the
// element into the audio graph (another amount by phone, by speaker or headphones). So the
// hitsounds were off by tens of milliseconds, another amount each time.
//
// Here the song's sound is listened to where it goes into the graph (audioGraph.ts's tap), the
// same graph the hitsounds play in, and compared with the song's own audio, decoded once: how
// loud it is every 2 ms. Where the last two thirds of a second fit best is where the song is,
// to about a millisecond, on the clock the hitsounds are set by.

import { get } from 'svelte/store';
import { tapOf, TAP_LOWPASS } from './audioGraph';
import { localAudio, downloaded } from './downloads';
import { keyOf, streamUrl } from './songs';
import { log } from './log';
import type { MapSet } from '../lib/types';

/** The song's loudness is taken every this many ms */
const HOP = 2;
/** What's heard is laid on the song in steps of a quarter of that */
const SUB = 4;
const STEP = HOP / SUB;
/** The song is decoded at this rate (its lower part is enough, and a quarter of the memory) */
const RATE = 12000;
/** Songs longer than this (s) aren't decoded (memory) */
const LONGEST = 900;
/** How well what's heard has to fit (1: exactly), and how much better than anywhere else */
const FIT = 0.7;
const FIT_KNOWN = 0.55;
const CLEAR = 0.04;

type Reference = { key: string; loudness: Float32Array };

const references = new Map<string, Reference | null>();
const loading = new Map<string, AbortController>();

/** What the element plays of the song: its downloaded or streamed audio (null: its preview) */
function sourceOf(song: MapSet, src: string) {
	if (src.startsWith('blob:')) return `kept:${keyOf(song)}`;
	return src === streamUrl(song) ? `stream:${keyOf(song)}` : null;
}

/** The song's audio in an offline context: decoded at a low rate where the browser does that */
async function decode(data: ArrayBuffer) {
	for (const rate of [RATE, 22050, 44100]) {
		let context: OfflineAudioContext;
		try {
			context = new OfflineAudioContext(1, 1, rate);
		} catch {
			continue;
		}
		return context.decodeAudioData(data);
	}
	throw new Error('no offline audio');
}

/** (lets the page draw in between; in the background its timers come too seldom to wait on) */
const breathe = () =>
	document.hidden ? Promise.resolve() : new Promise<void>((done) => setTimeout(done));

/** How loud the song is every HOP ms: what the tap hears of it (both ears as one, its lower part) */
async function loudnessOf(buffer: AudioBuffer) {
	const rate = buffer.sampleRate;
	const length = buffer.length;
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	// (the tap's low-pass, as a biquad at this rate)
	const w = (2 * Math.PI * Math.min(TAP_LOWPASS, rate * 0.45)) / rate;
	const alpha = Math.sin(w) / (2 * 0.707);
	const a0 = 1 + alpha;
	const b0 = (1 - Math.cos(w)) / 2 / a0;
	const b1 = (1 - Math.cos(w)) / a0;
	const a1 = (-2 * Math.cos(w)) / a0;
	const a2 = (1 - alpha) / a0;
	const perHop = (rate * HOP) / 1000;
	const hops = Math.floor(length / perHop);
	const loudness = new Float32Array(hops);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	let hop = 0;
	let sum = 0;
	let count = 0;
	let until = perHop;
	for (let i = 0; i < length && hop < hops; i++) {
		let x = 0;
		for (const channel of channels) x += channel[i];
		x /= channels.length;
		const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
		sum += y * y;
		count++;
		if (i + 1 >= until) {
			loudness[hop++] = Math.sqrt(sum / count);
			sum = 0;
			count = 0;
			until = (hop + 1) * perHop;
		}
		if (i % 600000 === 599999) await breathe();
	}
	return loudness;
}

/**
 * Makes the song's reference ready (once; it's asked for again and again while the song
 * plays): its audio from the phone if it's downloaded, else from the mirror once more
 */
export function prepareReference(song: MapSet, src: string) {
	const key = sourceOf(song, src);
	if (!key || references.has(key) || loading.has(key)) return;
	// (not a very long song: memory. And not from the mirror once more where data is saved)
	const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
		?.saveData;
	if (
		(Number(song.beatmaps?.[0]?.total_length) || 0) > LONGEST ||
		(saving && key.startsWith('stream:'))
	) {
		references.set(key, null);
		return;
	}
	// (only the song playing: one asked for before isn't needed any more)
	for (const [other, abort] of loading) {
		abort.abort();
		loading.delete(other);
	}
	const abort = new AbortController();
	loading.set(key, abort);
	(async () => {
		const kept = get(downloaded).has(keyOf(song)) ? await localAudio(song) : null;
		const data =
			kept ??
			(await fetch(streamUrl(song), { signal: abort.signal }).then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.arrayBuffer();
			}));
		if (abort.signal.aborted) return;
		const loudness = await loudnessOf(await decode(data));
		if (abort.signal.aborted) return;
		references.set(key, { key, loudness });
		// (the last few songs' are kept: going back to one is right away)
		for (const old of [...references.keys()].slice(0, Math.max(0, references.size - 4)))
			references.delete(old);
		log(`hitsounds: ${song.title} is heard for its place (${loudness.length * HOP} ms known)`);
	})()
		.catch((error) => {
			if (abort.signal.aborted) return;
			// (not asked again for this song: the hitsounds go by the element's place, as before)
			references.set(key, null);
			log(`hitsounds: ${song.title} can't be heard for its place (${error?.message ?? error})`);
		})
		.finally(() => loading.get(key) === abort && loading.delete(key));
}

/** Whether the song's reference is there (to hear it by) */
export const canHear = (song: MapSet | null, src: string) =>
	!!song && !!references.get(sourceOf(song, src) ?? '');

const heard = new Float32Array(32768);
let energies = new Float64Array(0);
let steps = new Float32Array(0);

/**
 * Where the song is: its place (ms) at a moment of the audio clock (s), by what was just heard
 * of it. `guess` is where it should be now (ms), looked for `around` ms either way; `since`
 * is the audio clock's time from which what's heard is of the song as it plays now (after a
 * seek, a start). Null: not heard clearly (silence, a part like any other, not routed).
 */
export function hearSong(
	element: HTMLAudioElement,
	song: MapSet,
	guess: number,
	rate: number,
	around: number,
	since: number,
	known: boolean
): { song: number; ctx: number; fit: number } | null {
	const tap = tapOf(element);
	const reference = references.get(sourceOf(song, element.src) ?? '');
	if (!tap || !reference || !(rate > 0)) return null;
	const context = tap.context;
	// (read between two moments of the audio thread: the samples end at the clock's time)
	let at = context.currentTime;
	for (let tries = 0; tries < 3; tries++) {
		tap.getFloatTimeDomainData(heard);
		const after = context.currentTime;
		if (after === at) break;
		at = after;
		if (tries === 2) return null;
	}
	const sampleRate = context.sampleRate;
	// Only what's of the song as it plays now, at least a quarter of a second
	const fresh = Math.min(heard.length, Math.floor((at - since) * sampleRate));
	// (a step of the song in samples of the clock: at the speed it plays)
	const perStep = ((STEP / 1000) * sampleRate) / rate;
	const count = Math.floor(fresh / perStep);
	if (count < (250 / STEP) * 1) return null;
	if (energies.length < count + 1) {
		energies = new Float64Array(count + 1);
		steps = new Float32Array(count + 1);
	}
	// The energy up to each step (counted from the end: the last step ends at the clock's time)
	const first = heard.length - count * perStep;
	let sum = 0;
	let peak = 0;
	energies[0] = 0;
	for (let step = 0; step < count; step++) {
		const from = Math.round(first + step * perStep);
		const to = Math.round(first + (step + 1) * perStep);
		for (let i = from; i < to; i++) {
			const value = heard[i];
			sum += value * value;
			if (value > peak) peak = value;
		}
		energies[step + 1] = sum;
	}
	if (peak < 0.002) return null;
	// How loud each HOP of what's heard is, starting at every step
	const starts = count - SUB + 1;
	const samplesPerHop = perStep * SUB;
	for (let step = 0; step < starts; step++)
		steps[step] = Math.sqrt((energies[step + SUB] - energies[step]) / samplesPerHop);

	const loudness = reference.loudness;
	// The song's place at the end of what's heard, in steps: `end`; step s of what's heard is
	// the song's step end - count + s. Each place lays whole hops of the song on what's heard
	const middle = Math.round(guess / STEP);
	const reach = Math.round(around / STEP);
	const fits = new Float32Array(reach * 2 + 1);
	let best = -1;
	for (let offset = -reach; offset <= reach; offset++) {
		const end = middle + offset;
		const firstHop = Math.max(0, Math.ceil((end - count) / SUB));
		const lastHop = Math.min(loudness.length, Math.floor(end / SUB)) - 1;
		const hops = lastHop - firstHop + 1;
		fits[offset + reach] = -1;
		if (hops < 100) continue;
		let a = 0;
		let b = 0;
		let aa = 0;
		let bb = 0;
		let ab = 0;
		let step = firstHop * SUB - end + count;
		for (let hop = firstHop; hop <= lastHop; hop++, step += SUB) {
			const x = steps[step];
			const y = loudness[hop];
			a += x;
			b += y;
			aa += x * x;
			bb += y * y;
			ab += x * y;
		}
		const spreadA = aa - (a * a) / hops;
		const spreadB = bb - (b * b) / hops;
		// (a part without ups and downs fits anywhere: not told)
		if (spreadA <= 1e-9 * hops || spreadB <= 1e-9 * hops) continue;
		fits[offset + reach] = (ab - (a * b) / hops) / Math.sqrt(spreadA * spreadB);
		if (best < 0 || fits[offset + reach] > fits[best]) best = offset + reach;
	}
	if (best < 0) return null;
	const fit = fits[best];
	if (fit < (known ? FIT_KNOWN : FIT)) return null;
	// (at the edge of where it was looked for: the real place may be further out)
	if (best === 0 || best === fits.length - 1) return null;
	// Clearly here: nowhere else (more than a few ms away) nearly as well
	const near = Math.round(6 / STEP);
	let other = -1;
	for (let i = 0; i < fits.length; i++)
		if (Math.abs(i - best) > near && fits[i] > other) other = fits[i];
	if (fit - other < CLEAR) return null;
	// Between two steps: by the fit of the ones next to it
	const before = fits[best - 1];
	const next = fits[best + 1];
	const curve = before - 2 * fit + next;
	const between = curve < 0 && before > -1 && next > -1 ? (0.5 * (before - next)) / curve : 0;
	return {
		song: (middle + best - reach + Math.max(-0.5, Math.min(0.5, between))) * STEP,
		ctx: at,
		fit
	};
}
