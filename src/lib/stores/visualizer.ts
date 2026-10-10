let context: AudioContext | null = null;
const analysers = new WeakMap<HTMLMediaElement, AnalyserNode>();

/**
 * An analyser for the frequencies of an audio element, or null if it can't be attached
 * safely. Once attached, the element plays through the Web Audio graph, so this only
 * attaches when that can't silence it:
 * - only local (blob:) audio; cross-origin audio would be silenced by the browser
 * - only while the AudioContext is running
 */
export async function getAnalyser(audio: HTMLMediaElement | null | undefined) {
	if (!audio || !audio.src.startsWith('blob:')) return null;
	if (analysers.has(audio)) return analysers.get(audio);

	try {
		context ??= new AudioContext();
		if (context.state !== 'running') await context.resume();
		if (context.state !== 'running') return null;

		const analyser = context.createAnalyser();
		analyser.fftSize = 128;
		analyser.smoothingTimeConstant = 0.75;
		const source = context.createMediaElementSource(audio);
		source.connect(analyser);
		analyser.connect(context.destination);
		analysers.set(audio, analyser);
		return analyser;
	} catch (error) {
		console.error('Could not attach the visualizer:', error);
		return null;
	}
}
