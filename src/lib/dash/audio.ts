// What the Dash mode hears in the song itself: how loud it is, every 10 ms. Heard on the page
// from the decoded audio and handed to the level generator with the beatmap, so the structures
// grow where the song gets loud, its silences stay calm and maps without kiai still get their
// drops. (Which notes are clicks stays with the beatmap: the beat is what's felt.)

import { decodeAudio } from '../audioDecode';

export interface SongSound {
	/** ms per value */
	hop: number;
	/** Loudness, 0–1 of the song's loud parts (over a quarter second) */
	loud: Float32Array;
}

const HOP = 10;

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Hears a song (a moment of work, in steps so the page stays smooth) */
export async function hearSong(buffer: AudioBuffer): Promise<SongSound> {
	// One channel at a quarter of the rate: enough for loudness
	const factor = 4;
	const rate = buffer.sampleRate / factor;
	const length = Math.floor(buffer.length / factor);
	const per = Math.max(1, Math.round((rate * HOP) / 1000));
	const frames = Math.floor(length / per);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	// Each frame's level (RMS)
	const level = new Float32Array(frames);
	for (let i = 0; i < frames * per; i++) {
		let v = 0;
		for (const data of channels) for (let k = 0; k < factor; k++) v += data[i * factor + k] ?? 0;
		v /= factor * channels.length;
		level[(i / per) | 0] += v * v;
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
	const sorted = Float32Array.from(loud).sort();
	const top = sorted[Math.floor(sorted.length * 0.97)] || 1e-9;
	return { hop: HOP, loud: loud.map((v) => Math.min(1, v / top)) };
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
