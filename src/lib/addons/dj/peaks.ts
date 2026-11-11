// The waveform of a song in three bands (lows, mids, highs), like DJ software colours it:
// the loudness of each band in short slices. Worked out in chunks so the app stays smooth.

export interface Peaks {
	/** Slices per second */
	rate: number;
	low: Float32Array;
	mid: Float32Array;
	high: Float32Array;
	/** The loudest slice of all, to scale the drawing */
	max: number;
}

export const PEAK_RATE = 150;

/** One-pole low-pass coefficient for a cutoff frequency */
const coefficient = (cutoff: number, sampleRate: number) =>
	1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);

export async function computePeaks(buffer: AudioBuffer): Promise<Peaks> {
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	const rate = buffer.sampleRate;
	const slice = Math.max(1, Math.floor(rate / PEAK_RATE));
	const count = Math.ceil(buffer.length / slice);
	const low = new Float32Array(count);
	const mid = new Float32Array(count);
	const high = new Float32Array(count);
	const aLow = coefficient(200, rate);
	const aMid = coefficient(2500, rate);
	let lpLow = 0;
	let lpMid = 0;
	let max = 0;
	const CHUNK = 400_000;
	for (let start = 0; start < buffer.length; start += CHUNK) {
		const end = Math.min(buffer.length, start + CHUNK);
		for (let i = start; i < end; i++) {
			let x = 0;
			for (const data of channels) x += data[i];
			x /= channels.length;
			lpLow += aLow * (x - lpLow);
			lpMid += aMid * (x - lpMid);
			const bin = (i / slice) | 0;
			const l = lpLow * lpLow;
			const m = (lpMid - lpLow) * (lpMid - lpLow);
			const h = (x - lpMid) * (x - lpMid);
			low[bin] += l;
			mid[bin] += m;
			high[bin] += h;
		}
		// Let the app breathe between chunks
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (let bin = 0; bin < count; bin++) {
		// RMS of each band; highs and mids are quieter, so they count a bit more
		low[bin] = Math.sqrt(low[bin] / slice);
		mid[bin] = Math.sqrt(mid[bin] / slice) * 1.6;
		high[bin] = Math.sqrt(high[bin] / slice) * 2.6;
		max = Math.max(max, low[bin] + mid[bin] + high[bin]);
	}
	return { rate: PEAK_RATE, low, mid, high, max: max || 1 };
}
