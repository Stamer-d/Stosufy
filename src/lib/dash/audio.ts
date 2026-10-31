// What the Dash mode hears in the song itself: how loud it is and where something hits (a
// kick, a snare, any sound that starts), every 10 ms. Heard on the page from the decoded audio
// and handed to the level generator with the beatmap, so the clicks go on what you hear, the
// structures grow where the song gets loud and maps without kiai still get their drops.

import { decodeAudio } from '../audioDecode';

export interface SongSound {
	/** ms per value */
	hop: number;
	/** Loudness, 0–1 of the song's loud parts (over a quarter second) */
	loud: Float32Array;
	/** How hard something starts there, 0–1: anything, and only the bass (the kick) */
	hit: Float32Array;
	bass: Float32Array;
}

const HOP = 10;

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The value a share of them stays under */
function percentile(values: Float32Array, share: number) {
	const sorted = Float32Array.from(values).sort();
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] || 1e-9;
}

/** Hears a song (a moment of work, in steps so the page stays smooth) */
export async function hearSong(buffer: AudioBuffer): Promise<SongSound> {
	// One channel at a quarter of the rate: enough for loudness and hits
	const factor = 4;
	const rate = buffer.sampleRate / factor;
	const length = Math.floor(buffer.length / factor);
	const per = Math.max(1, Math.round((rate * HOP) / 1000));
	const frames = Math.floor(length / per);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	// Bass (below 150 Hz), mids (to 2 kHz) and highs, each frame's energy
	const bands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
	const aBass = 1 - Math.exp((-2 * Math.PI * 150) / rate);
	const aMid = 1 - Math.exp((-2 * Math.PI * 2000) / rate);
	let bass = 0;
	let below = 0;
	for (let i = 0; i < frames * per; i++) {
		let v = 0;
		for (const data of channels) for (let k = 0; k < factor; k++) v += data[i * factor + k] ?? 0;
		v /= factor * channels.length;
		bass += aBass * (v - bass);
		below += aMid * (v - below);
		const f = (i / per) | 0;
		bands[0][f] += bass * bass;
		bands[1][f] += (below - bass) * (below - bass);
		bands[2][f] += (v - below) * (v - below);
		if (i % 262144 === 262143) await yieldNow();
	}

	// A hit: a band getting louder than it just was (on a log scale, so a quiet hi-hat counts
	// too), less what's usual around it
	const rise = (energy: Float32Array) => {
		const c = 1 / (percentile(energy, 0.9) * 0.01);
		const level = energy.map((e) => Math.log1p(e * c));
		const out = new Float32Array(frames);
		for (let n = 3; n < frames; n++)
			out[n] = Math.max(0, level[n] - (level[n - 1] + level[n - 2] + level[n - 3]) / 3);
		return out;
	};
	const flux = bands.map(rise);
	const settle = (values: Float32Array) => {
		// Above the average of the 200 ms around it, then 0–1
		const out = new Float32Array(frames);
		let sum = 0;
		const w = 10;
		for (let n = 0; n < frames; n++) {
			sum += values[n] - (values[n - 2 * w - 1] ?? 0);
			const mean = sum / Math.min(n + 1, 2 * w + 1);
			out[Math.max(0, n - w)] = Math.max(0, values[Math.max(0, n - w)] - mean);
		}
		const top = percentile(out, 0.99);
		return out.map((v) => Math.min(1, v / top));
	};
	const all = new Float32Array(frames);
	for (let n = 0; n < frames; n++)
		all[n] = flux[0][n] * 0.45 + flux[1][n] * 0.35 + flux[2][n] * 0.2;
	await yieldNow();

	// Loudness over a quarter second
	const loud = new Float32Array(frames);
	const span = 25;
	let sum = 0;
	for (let n = 0; n < frames; n++) {
		sum += Math.sqrt((bands[0][n] + bands[1][n] + bands[2][n]) / per);
		if (n >= span)
			sum -= Math.sqrt((bands[0][n - span] + bands[1][n - span] + bands[2][n - span]) / per);
		loud[Math.max(0, n - (span >> 1))] = sum / Math.min(n + 1, span);
	}
	const top = percentile(loud, 0.97);
	return {
		hop: HOP,
		loud: loud.map((v) => Math.min(1, v / top)),
		hit: settle(all),
		bass: settle(flux[0])
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

/** How hard something hits near a time (0–1): the strongest within 30 ms of it */
export function heardAt(sound: SongSound, time: number, key: 'hit' | 'bass' = 'hit') {
	const values = sound[key];
	const at = Math.round(time / sound.hop);
	let best = 0;
	for (let n = Math.max(0, at - 3); n <= at + 3 && n < values.length; n++)
		if (values[n] > best) best = values[n];
	return best;
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
