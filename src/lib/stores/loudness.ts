// Loudness normalization: measures how loud a song is (integrated loudness after ITU-R
// BS.1770, the LUFS measure streaming services use) and turns it into a volume factor.

/** Loudness every song is brought to, like Spotify's "normal" setting */
const TARGET_LUFS = -14;
const MIN_GAIN = 0.25;
const MAX_GAIN = 4;

const BLOCK_SECONDS = 0.4;
const BLOCK_OVERLAP = 0.75;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

/** Volume factor that brings a song of the given loudness to the target */
export function gainFor(loudness: number) {
	return Math.min(MAX_GAIN, Math.max(MIN_GAIN, 10 ** ((TARGET_LUFS - loudness) / 20)));
}

/** Integrated loudness of an audio file in LUFS, or null if it can't be decoded */
export async function measureLoudness(file: Uint8Array): Promise<number | null> {
	try {
		const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(file.slice().buffer);
		return await loudnessOf(decoded);
	} catch (error) {
		console.warn('Could not measure the loudness', error);
		return null;
	}
}

/** Integrated loudness of decoded audio in LUFS (null: silent) */
export async function loudnessOf(decoded: AudioBuffer): Promise<number | null> {
	{
		// K-weighting: a high shelf for the head's acoustic effect and a high-pass
		const context = new OfflineAudioContext(
			decoded.numberOfChannels,
			decoded.length,
			decoded.sampleRate
		);
		const source = context.createBufferSource();
		source.buffer = decoded;
		const shelf = context.createBiquadFilter();
		shelf.type = 'highshelf';
		shelf.frequency.value = 1681;
		shelf.gain.value = 4;
		const highpass = context.createBiquadFilter();
		highpass.type = 'highpass';
		highpass.frequency.value = 38;
		highpass.Q.value = 0.5;
		source.connect(shelf).connect(highpass).connect(context.destination);
		source.start();
		const weighted = await context.startRendering();

		// Mean square of overlapping 400 ms blocks, summed over the channels
		const blockLength = Math.round(BLOCK_SECONDS * weighted.sampleRate);
		const hop = Math.round(blockLength * (1 - BLOCK_OVERLAP));
		const channels = Array.from({ length: weighted.numberOfChannels }, (_, i) =>
			weighted.getChannelData(i)
		);
		const blocks: number[] = [];
		for (let start = 0; start + blockLength <= weighted.length; start += hop) {
			let energy = 0;
			for (const data of channels) {
				let sum = 0;
				for (let i = start; i < start + blockLength; i++) sum += data[i] * data[i];
				energy += sum / blockLength;
			}
			blocks.push(energy);
		}
		const loudness = (energy: number) => -0.691 + 10 * Math.log10(energy);
		const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

		// Gating: ignore silence, then everything 10 LU below the average
		const audible = blocks.filter((energy) => loudness(energy) > ABSOLUTE_GATE);
		if (!audible.length) return null;
		const threshold = loudness(mean(audible)) + RELATIVE_GATE;
		const gated = audible.filter((energy) => loudness(energy) > threshold);
		return Math.round(loudness(mean(gated)) * 10) / 10;
	}
}
