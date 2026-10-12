import { attach, playbackContext } from './equalizer';

const analysers = new WeakMap<HTMLMediaElement, AnalyserNode>();

/**
 * An analyser for the frequencies of an audio element, or null if it can't be attached
 * safely (see equalizer.ts: only local audio, only while the audio context runs)
 */
export async function getAnalyser(audio: HTMLMediaElement | null | undefined) {
	if (!audio || !audio.src.startsWith('blob:')) return null;
	if (analysers.has(audio)) return analysers.get(audio);
	const source = await attach(audio);
	if (!source) return null;
	const analyser = playbackContext().createAnalyser();
	analyser.fftSize = 128;
	analyser.smoothingTimeConstant = 0.75;
	source.connect(analyser);
	analysers.set(audio, analyser);
	return analyser;
}
