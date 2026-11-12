// A song's (or a video's sound's) loudness over time, to draw its waveform at any zoom: the
// loudest of its channels, 2000 times a second (decoded by the browser; null when it can't,
// or the file's too big for it).

const MAX_SIZE = 400 * 1024 * 1024;
const RATE = 2000;

export interface Waveform {
	/** How loud (0–1 of its loudest), RATE values a second */
	data: Float32Array;
	rate: number;
}

export async function waveform(file: Blob): Promise<Waveform | null> {
	if (file.size > MAX_SIZE) return null;
	try {
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
		let top = 0;
		for (const value of data) if (value > top) top = value;
		if (top) for (let i = 0; i < data.length; i++) data[i] /= top;
		return { data, rate: RATE };
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

/** m:ss.s (or h:mm:ss.s) */
export function clock(seconds: number) {
	const s = Math.max(0, seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const rest = (s % 60).toFixed(1).padStart(4, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A time typed as s, m:ss or h:mm:ss (with tenths), or null */
export function parseClock(text: string): number | null {
	const parts = text.trim().replace(',', '.').split(':');
	if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part)))
		return null;
	return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}
