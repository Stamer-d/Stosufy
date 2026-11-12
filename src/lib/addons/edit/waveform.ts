// A song's (or a video's sound's) loudness over time, to draw its waveform at any zoom: the
// loudest of its channels, 2000 times a second. Decoded by the browser when it's short; a long
// one (a stream, a film: gigabytes, decoded) by the native FFmpeg, as 2000 values a second
// only. Null when it can't be read.

import { extensionOf } from '../files/formats';
import { bytesOf, discard, runFfmpeg } from '../files/ffmpeg';
import { nativeFfmpeg } from '../files/native';

/** Decoded by the browser up to this (it holds the file and all of its sound in memory) */
const BROWSER_SIZE = 150 * 1024 * 1024;
const BROWSER_SECONDS = 30 * 60;
const RATE = 2000;

export interface Waveform {
	/** How loud (0–1 of its loudest), RATE values a second */
	data: Float32Array;
	rate: number;
}

function normalized(data: Float32Array): Waveform {
	let top = 0;
	for (const value of data) if (value > top) top = value;
	if (top) for (let i = 0; i < data.length; i++) data[i] /= top;
	return { data, rate: RATE };
}

async function inBrowser(file: Blob) {
	// (decoded at 8 kHz: enough for its loudness, a sixth of the memory)
	const context = new OfflineAudioContext(1, 1, 8000);
	const audio = await context.decodeAudioData(await file.arrayBuffer());
	const per = audio.sampleRate / RATE;
	const data = new Float32Array(Math.ceil(audio.length / per));
	for (let c = 0; c < audio.numberOfChannels; c++) {
		const channel = audio.getChannelData(c);
		for (let i = 0; i < data.length; i++) {
			let peak = 0;
			const to = Math.min(channel.length, Math.floor((i + 1) * per));
			for (let j = Math.floor(i * per); j < to; j++) {
				const value = Math.abs(channel[j]);
				if (value > peak) peak = value;
			}
			if (peak > data[i]) data[i] = peak;
		}
	}
	return normalized(data);
}

async function withFfmpeg(file: File, id: string) {
	const made = await runFfmpeg(
		file,
		extensionOf(file.name),
		['-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', '-f', 's16le'],
		'raw',
		{ id }
	);
	try {
		const bytes = await bytesOf(made);
		const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
		const data = new Float32Array(samples.length);
		for (let i = 0; i < samples.length; i++) data[i] = Math.abs(samples[i]) / 32768;
		return normalized(data);
	} finally {
		await discard(made);
	}
}

/** Its waveform (`duration`: how long it is, s; `id`: to stop it with `cancel`) */
export async function waveform(file: File, duration: number, id: string): Promise<Waveform | null> {
	const short = file.size <= BROWSER_SIZE && (!duration || duration <= BROWSER_SECONDS);
	if (short) {
		try {
			return await inBrowser(file);
		} catch {
			// (a format the browser can't read: FFmpeg can)
		}
	}
	try {
		if (!(await nativeFfmpeg({ install: false }))) return null;
		return await withFfmpeg(file, id);
	} catch {
		return null;
	}
}

/** The loudest between two times (s) */
export function peakBetween(wave: Waveform, from: number, to: number) {
	const a = Math.max(0, Math.floor(from * wave.rate));
	const b = Math.min(wave.data.length, Math.max(a + 1, Math.ceil(to * wave.rate)));
	let peak = 0;
	for (let i = a; i < b; i++) if (wave.data[i] > peak) peak = wave.data[i];
	return peak;
}

export { clock, parseClock } from '../files/time';
