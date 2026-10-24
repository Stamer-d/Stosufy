// The equalizer: ten bands (like most music players) the songs play through. Songs are
// routed through the Web Audio graph once the equalizer is on; flat bands change nothing.

import { get } from 'svelte/store';
import { userSettings } from './user';

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LIMIT = 12;

export const EQ_PRESETS: Record<string, number[]> = {
	Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
	'Bass reducer': [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
	Electronic: [4, 3.5, 1, 0, -2, 1.5, 1, 1.5, 4, 4.5],
	'Hip-hop': [5, 4, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3],
	Rock: [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5],
	Pop: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5],
	Vocal: [-2, -3, -3, 1.5, 3.5, 3.5, 3, 1.5, 0, -2],
	'Treble boost': [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6],
	Acoustic: [4.5, 4.5, 3.5, 1, 2, 1.5, 3, 3.5, 3, 2],
	Night: [-4, -3, -1, 0, 1, 1, 0, -1, -3, -4]
};

export interface EqSettings {
	on: boolean;
	gains: number[];
	preset: string | null;
}

export const DEFAULT_EQ: EqSettings = { on: false, gains: EQ_PRESETS.Flat, preset: 'Flat' };

let context: AudioContext | null = null;
let input: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
let preamp: GainNode | null = null;
/** A low-pass at the end of the graph: the puzzle muffles the music until it's solved */
let muffle: BiquadFilterNode | null = null;

/** Above what anyone hears: the low-pass changes nothing */
const OPEN = 20000;
/** How muffled the music sounds at its most: as if from the room next door */
const MUFFLED = 280;

const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
/** Each routed song's own fade (crossfades and switches), on the audio thread */
const fades = new WeakMap<HTMLMediaElement, GainNode>();
/**
 * Each routed song's volume (the user's volume × its normalization). WebKit (macOS, Linux)
 * ignores an element's own volume once it plays through the graph, so it's applied here.
 */
const volumes = new WeakMap<HTMLMediaElement, GainNode>();

/** A routed song's fade gain, or null if it plays straight (then fades step its volume) */
export function fadeNode(audio: HTMLMediaElement | null | undefined) {
	return (audio && fades.get(audio)) || null;
}

/** A routed song's volume gain, or null if it plays straight (then its own volume counts) */
export function volumeNode(audio: HTMLMediaElement | null | undefined) {
	return (audio && volumes.get(audio)) || null;
}

/** The audio context the songs play through (shared with the visualizer) */
export function playbackContext() {
	if (!context) {
		context = new AudioContext();
		input = context.createGain();
		filters = EQ_BANDS.map((frequency, i) => {
			const filter = context!.createBiquadFilter();
			filter.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
			filter.frequency.value = frequency;
			filter.Q.value = 1.1;
			return filter;
		});
		preamp = context.createGain();
		muffle = context.createBiquadFilter();
		muffle.type = 'lowpass';
		muffle.frequency.value = OPEN;
		muffle.Q.value = 0.7;
		let node: AudioNode = input;
		for (const filter of filters) node = node.connect(filter);
		node.connect(preamp).connect(muffle).connect(context.destination);
		applyEq();
	}
	return context;
}

/**
 * Routes a song through the equalizer (once; it stays routed). Only local (blob:) audio and
 * only while the context runs: anything else could be silenced by the browser.
 */
export async function attach(audio: HTMLMediaElement | null | undefined) {
	if (!audio || !audio.src.startsWith('blob:')) return null;
	if (sources.has(audio)) return sources.get(audio)!;
	try {
		const ctx = playbackContext();
		if (ctx.state !== 'running') await ctx.resume().catch(() => {});
		if (ctx.state !== 'running') return null;
		if (sources.has(audio)) return sources.get(audio)!;
		const source = ctx.createMediaElementSource(audio);
		// The volume moves from the element into the graph
		const start = routedLevels(audio);
		const volume = ctx.createGain();
		volume.gain.value = start.volume;
		audio.volume = 1;
		const fade = ctx.createGain();
		fade.gain.value = start.fade;
		source.connect(volume).connect(fade).connect(input!);
		volumes.set(audio, volume);
		fades.set(audio, fade);
		sources.set(audio, source);
		return source;
	} catch (error) {
		console.error('Could not route the song through the equalizer:', error);
		return null;
	}
}

/**
 * Takes a song that won't play again out of the graph: a connected source keeps its element
 * (and the whole song's data) alive for as long as the app runs
 */
export function detach(audio: HTMLMediaElement) {
	for (const node of [sources.get(audio), volumes.get(audio), fades.get(audio)]) node?.disconnect();
	sources.delete(audio);
	volumes.delete(audio);
	fades.delete(audio);
}

/** A song's volume and where its fade is when it gets routed (set by the mixer) */
let routedLevels: (audio: HTMLMediaElement) => { volume: number; fade: number } = (audio) => ({
	volume: audio.volume,
	fade: 1
});
export function onRoute(get: (audio: HTMLMediaElement) => { volume: number; fade: number }) {
	routedLevels = get;
}

export function eqSettings(): EqSettings {
	return { ...DEFAULT_EQ, ...get(userSettings).settings?.equalizer };
}

/** Sets the bands from the settings (smoothly) */
export function applyEq() {
	if (!context || !preamp) return;
	const { on, gains } = eqSettings();
	const now = context.currentTime;
	filters.forEach((filter, i) => filter.gain.setTargetAtTime(on ? (gains[i] ?? 0) : 0, now, 0.05));
	// Headroom for boosted bands, so they don't clip
	const boost = on ? Math.max(0, ...gains) : 0;
	preamp.gain.setTargetAtTime(10 ** (-(boost * 0.6) / 20), now, 0.05);
}

/**
 * Muffles the music: 1 sounds like through a wall, 0 is the music as it is. The cut-off
 * moves on a log scale, so each step opens up about as much as the last.
 */
export function setMuffle(amount: number, seconds = 0.25) {
	if (!context || !muffle) return;
	const clamped = Math.min(1, Math.max(0, amount));
	const frequency = clamped <= 0 ? OPEN : OPEN * (MUFFLED / OPEN) ** clamped;
	muffle.frequency.setTargetAtTime(frequency, context.currentTime, seconds / 3);
}

/** The output delay of an audio context (s): what's scheduled now is heard this much later */
export function outputDelay(ctx: BaseAudioContext | null | undefined) {
	if (!ctx || !(ctx instanceof AudioContext)) return 0;
	const total = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
	// Nonsense values (some drivers) aren't trusted
	return total > 0 && total < 0.5 ? total : 0;
}

/**
 * Where a song is as it's heard now (ms). The audio element's time already counts its own
 * output delay; once it plays through the equalizer, the graph's delay comes on top.
 */
export function heardTime(audio: HTMLMediaElement) {
	const routed = sources.has(audio) ? outputDelay(context) : 0;
	return (audio.currentTime - routed) * 1000;
}
