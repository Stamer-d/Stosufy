// What the Dash mode hears in the song itself, every 10 ms: how loud it is, and how hard each
// moment hits (an onset: the bass, the middle or the highs suddenly louder), the bass's own
// hits (the kick) apart. Heard on the page from the decoded audio and handed to the level
// generator with the beatmap, so the structures grow where the song gets loud, its silences
// stay calm, maps without kiai still get their drops, and of the notes the ones heard hardest
// are likelier clicks. (Which notes there are stays with the beatmap: the beat is what's felt.)
// The kicks go into the level too, for the light to hit with the drums.

import { decodeAudio } from '../audioDecode';

export interface SongSound {
	/** ms per value */
	hop: number;
	/** Loudness, 0–1 of the song's loud parts (over a quarter second) */
	loud: Float32Array;
	/** How hard each moment hits, 0–1 of the song's hard hits (all bands) */
	hits?: Float32Array;
	/** How hard the bass hits (the kick), 0–1 of its hard hits */
	kicks?: Float32Array;
}

const HOP = 10;
/** Where the bands part (Hz): bass below the first, highs above the second */
const BASS = 150;
const HIGH = 2000;

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The value `share` of the way up the sorted values (at least a tiny bit above 0) */
function percentile(values: Float32Array, share: number) {
	const sorted = Float32Array.from(values).sort();
	return sorted[Math.floor((sorted.length - 1) * share)] || 1e-9;
}

/**
 * How much louder each frame is than the frames just before (in log terms: as much for a quiet
 * hit as for a loud one), 0 where it gets quieter
 */
function rises(energy: Float32Array) {
	const floor = percentile(energy, 0.97) * 1e-4;
	const log = energy.map((e) => Math.log(e + floor));
	const out = new Float32Array(energy.length);
	for (let n = 3; n < energy.length; n++) {
		const before = (log[n - 1] + log[n - 2] + log[n - 3]) / 3;
		out[n] = Math.max(0, log[n] - before);
	}
	return out;
}

/** 0–1 of the hard ones (the top 3 % are 1) */
function normal(values: Float32Array) {
	const top = percentile(values, 0.97);
	return values.map((v) => Math.min(1, v / top));
}

/** Hears a song (a moment of work, in steps so the page stays smooth) */
export async function hearSong(buffer: AudioBuffer): Promise<SongSound> {
	// One channel at a quarter of the rate: enough for loudness and up to the highs' hits
	const factor = 4;
	const rate = buffer.sampleRate / factor;
	const length = Math.floor(buffer.length / factor);
	const per = Math.max(1, Math.round((rate * HOP) / 1000));
	const frames = Math.floor(length / per);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	// Each frame's level (RMS), and the energy of the bass, middle and highs (two low-passes)
	const level = new Float32Array(frames);
	const bass = new Float32Array(frames);
	const middle = new Float32Array(frames);
	const highs = new Float32Array(frames);
	const a1 = 1 - Math.exp((-2 * Math.PI * BASS) / rate);
	const a2 = 1 - Math.exp((-2 * Math.PI * HIGH) / rate);
	let low1 = 0;
	let low2 = 0;
	for (let i = 0; i < frames * per; i++) {
		let v = 0;
		for (const data of channels) for (let k = 0; k < factor; k++) v += data[i * factor + k] ?? 0;
		v /= factor * channels.length;
		low1 += a1 * (v - low1);
		low2 += a2 * (v - low2);
		const frame = (i / per) | 0;
		level[frame] += v * v;
		bass[frame] += low1 * low1;
		middle[frame] += (low2 - low1) ** 2;
		highs[frame] += (v - low2) ** 2;
		if (i % 262144 === 262143) await yieldNow();
	}
	for (let n = 0; n < frames; n++) level[n] = Math.sqrt(level[n] / per);

	// Over a quarter second, then 0–1 of the loud parts
	const loud = new Float32Array(frames);
	const span = 25;
	let sum = 0;
	for (let n = 0; n < frames; n++) {
		sum += level[n] - (n >= span ? level[n - span] : 0);
		loud[Math.max(0, n - (span >> 1))] = sum / Math.min(n + 1, span);
	}
	const top = percentile(loud, 0.97);

	// The hits: where the bands rise (the highs count a bit less: cymbals ring all the time)
	const kickRise = rises(bass);
	const middleRise = rises(middle);
	const highRise = rises(highs);
	const hits = new Float32Array(frames);
	for (let n = 0; n < frames; n++) hits[n] = kickRise[n] + middleRise[n] + highRise[n] * 0.6;

	return {
		// (a frame is a whole number of samples: not quite 10 ms, which would add up over a song)
		hop: (per / rate) * 1000,
		loud: loud.map((v) => Math.min(1, v / top)),
		hits: normal(hits),
		kicks: normal(kickRise)
	};
}

const heard = new Map<string, Promise<SongSound | null>>();

/** Hears the song an audio element plays (null when its audio can't be read) */
export function hearAudio(key: string, audio: HTMLAudioElement | null | undefined) {
	if (!audio?.src || !audio.src.startsWith('blob:')) return Promise.resolve(null);
	if (!heard.has(key)) {
		const made = (async () => {
			try {
				const bytes = await (await fetch(audio.src)).arrayBuffer();
				const decoded = await decodeAudio(new OfflineAudioContext(1, 1, 44100), bytes);
				return await hearSong(decoded);
			} catch (error) {
				console.warn('Could not hear the song for its Dash level', error);
				return null;
			}
		})();
		heard.set(key, made);
		if (heard.size > 3) heard.delete(heard.keys().next().value!);
	}
	return heard.get(key)!;
}

/** How loud a stretch is (0–1, the average) */
export function loudness(sound: SongSound, from: number, to: number) {
	const a = Math.max(0, Math.floor(from / sound.hop));
	const b = Math.min(sound.loud.length, Math.ceil(to / sound.hop));
	if (b <= a) return 0;
	let sum = 0;
	for (let n = a; n < b; n++) sum += sound.loud[n];
	return sum / (b - a);
}

/** How hard the song hits at a moment (0–1: the hardest within 30 ms of it; 0 unheard) */
export function hitAt(sound: SongSound, time: number) {
	const hits = sound.hits;
	if (!hits) return 0;
	const a = Math.max(0, Math.floor((time - 30) / sound.hop));
	const b = Math.min(hits.length - 1, Math.ceil((time + 30) / sound.hop));
	let most = 0;
	for (let n = a; n <= b; n++) most = Math.max(most, hits[n]);
	return most;
}
