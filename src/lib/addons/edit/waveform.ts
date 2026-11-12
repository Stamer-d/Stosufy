// A song's (or a video's sound's) waveform: how loud each of `count` parts of it is, at its
// loudest (0–1). Decoded by the browser; null when it can't (or the file's too big for it).

const MAX_SIZE = 400 * 1024 * 1024;

export async function waveform(file: Blob, count = 1200): Promise<Float32Array | null> {
	if (file.size > MAX_SIZE) return null;
	try {
		const context = new OfflineAudioContext(1, 1, 22050);
		const audio = await context.decodeAudioData(await file.arrayBuffer());
		const peaks = new Float32Array(count);
		const per = audio.length / count;
		for (let c = 0; c < audio.numberOfChannels; c++) {
			const data = audio.getChannelData(c);
			for (let i = 0; i < count; i++) {
				let peak = 0;
				const from = Math.floor(i * per);
				const to = Math.min(data.length, Math.floor((i + 1) * per));
				// (every fourth sample: enough for a picture of it)
				for (let j = from; j < to; j += 4) {
					const value = Math.abs(data[j]);
					if (value > peak) peak = value;
				}
				if (peak > peaks[i]) peaks[i] = peak;
			}
		}
		let top = 0;
		for (const peak of peaks) if (peak > top) top = peak;
		return top ? peaks.map((peak) => peak / top) : peaks;
	} catch {
		return null;
	}
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
