// The songs' sound through Web Audio, for what an <audio> element can't do on an iPhone (its
// volume is fixed there): every song at the same loudness, and crossfades between songs.
// Each element goes source → level (the loudness) → fade (crossfades) → out; a K-weighted
// meter listens along to measure how loud the song is (see loudness.ts).
//
// Safely: an element is routed only once the audio context runs (started by a tap, as browsers
// want; a routed element whose context doesn't run is silent), and only when one of the two
// is on. The page's audio session is a player's (hitsounds.ts), so iOS keeps it running in the
// background.

import { get } from 'svelte/store';
import { userSettings } from './shims/user';
import { log } from './log';

type Route = {
	level: GainNode;
	fade: GainNode;
	meters: AnalyserNode[];
	/** The song's sound as it goes into the graph, to hear where the song is (songClock.ts) */
	tap: AnalyserNode;
};

let context: AudioContext | null = null;
const routes = new WeakMap<HTMLAudioElement, Route>();
/** Levels and fades asked for before the element was routed (it starts at them) */
const pending = new WeakMap<HTMLAudioElement, { level?: number; fade?: number }>();

/** Bring every song to the same loudness (the account's setting, the desktop's default: on) */
export const normalizeOn = () => get(userSettings).settings?.normalize ?? true;
/** Seconds the end of a song and the start of the next overlap (0: off) */
export const crossfadeSeconds = () => Math.max(0, get(userSettings).settings?.crossfade ?? 0);
/** (the hitsounds too: only a song that goes through the hitsounds' audio can be heard there,
 * and so be on their clock exactly: songClock.ts) */
const wanted = () =>
	normalizeOn() || crossfadeSeconds() > 0 || !!get(userSettings).settings?.hitsounds;

/**
 * The page's one audio context: the songs' and the hitsounds' (the same clock and the same
 * delay to the speaker: two contexts, one for listening and one quick, put the hitsounds ahead
 * of the song by the difference)
 */
export function songContext(): AudioContext | null {
	if (!context) {
		try {
			context = new AudioContext({ latencyHint: 'interactive' });
		} catch {
			return null;
		}
		context.addEventListener('statechange', () => {
			log(`song audio: ${context!.state}`);
			if (context!.state === 'running') for (const listener of onRunning) listener();
		});
	}
	return context;
}

const onRunning = new Set<() => void>();
/** Called each time the songs' audio context starts running (again) */
export function whenRunning(listener: () => void) {
	onRunning.add(listener);
}

/**
 * From a tap: starts the audio context (browsers allow sound only after one), and routes the
 * elements once it runs
 */
export function wakeGraph(elements: (HTMLAudioElement | null)[]) {
	if (!wanted() || !songContext() || !context) return;
	const ready = () => {
		if (context?.state !== 'running') return;
		for (const element of elements) if (element) route(element);
	};
	if (context.state === 'running') ready();
	else
		context
			.resume()
			.then(ready)
			.catch(() => {});
}

/** Keeps the context running while a song plays (after a call or Siri iOS may stop it) */
export function keepRunning() {
	if (context && context.state !== 'running' && context.state !== 'closed')
		context.resume().catch(() => {});
}

function route(element: HTMLAudioElement) {
	if (routes.has(element) || !context) return;
	try {
		const source = context.createMediaElementSource(element);
		const level = context.createGain();
		const fade = context.createGain();
		const before = pending.get(element);
		level.gain.value = before?.level ?? 1;
		fade.gain.value = before?.fade ?? 1;
		source.connect(level).connect(fade).connect(context.destination);
		// The meter: K-weighted (BS.1770's head shelf and high-pass), each channel on its own
		const shelf = context.createBiquadFilter();
		shelf.type = 'highshelf';
		shelf.frequency.value = 1681;
		shelf.gain.value = 4;
		const highpass = context.createBiquadFilter();
		highpass.type = 'highpass';
		highpass.frequency.value = 38;
		highpass.Q.value = 0.5;
		const split = context.createChannelSplitter(2);
		const quiet = context.createGain();
		quiet.gain.value = 0;
		quiet.connect(context.destination);
		source.connect(shelf).connect(highpass).connect(split);
		const meters = [0, 1].map((channel) => {
			const meter = context!.createAnalyser();
			meter.fftSize = 16384;
			split.connect(meter, channel);
			// (pulled along to the output, silent: else WebKit doesn't run it)
			meter.connect(quiet);
			return meter;
		});
		// What's heard of the song, for its clock: the lower part of its sound (as its reference
		// is decoded, see songClock.ts), the last two thirds of a second
		const low = context.createBiquadFilter();
		low.type = 'lowpass';
		low.frequency.value = TAP_LOWPASS;
		low.Q.value = 0.707;
		const tap = context.createAnalyser();
		tap.fftSize = 32768;
		tap.smoothingTimeConstant = 0;
		source.connect(low).connect(tap).connect(quiet);
		routes.set(element, { level, fade, meters, tap });
		log('song audio routed (loudness, crossfade)');
	} catch (error) {
		log(`song audio not routed: ${(error as Error)?.message}`);
	}
}

export const isRouted = (element: HTMLAudioElement | null) => !!element && routes.has(element);
/** The song's sound as it goes into the graph (null: not routed) */
export const tapOf = (element: HTMLAudioElement | null) =>
	(element && routes.get(element)?.tap) || null;
/** Above this (Hz) the tap doesn't listen */
export const TAP_LOWPASS = 4000;

/**
 * A sound too quiet to hear, while the player plays: between two songs with the screen locked
 * no song sounds for a moment, and a page that makes no sound there is put to sleep by iOS
 * (the next song never started). With it the page's audio goes on through the change.
 */
let held: ConstantSourceNode | null = null;
export function holdAudio(on: boolean) {
	if (on && !held && context && context.state !== 'closed') {
		try {
			held = context.createConstantSource();
			held.offset.value = 0.0001;
			held.connect(context.destination);
			held.start();
		} catch {
			held = null;
		}
	} else if (!on && held) {
		try {
			held.stop();
			held.disconnect();
		} catch {
			// (already stopped)
		}
		held = null;
	}
}
export const graphRunning = () => context?.state === 'running';

/** The song's level (the loudness), gliding over `seconds` */
export function setLevel(element: HTMLAudioElement, value: number, seconds = 0) {
	const routed = routes.get(element);
	if (!routed || !context) {
		pending.set(element, { ...pending.get(element), level: value });
		return;
	}
	const gain = routed.level.gain;
	gain.cancelScheduledValues(context.currentTime);
	if (seconds > 0) gain.setTargetAtTime(value, context.currentTime, seconds / 3);
	else gain.setValueAtTime(value, context.currentTime);
}

/**
 * Fades a song to a level (0–1) over `seconds`, on the audio thread (smooth while the page is
 * busy or in the background). False when it isn't routed (no fades then)
 */
export function fadeTo(element: HTMLAudioElement, value: number, seconds: number) {
	const routed = routes.get(element);
	if (!routed || !context) {
		pending.set(element, { ...pending.get(element), fade: value });
		return false;
	}
	const gain = routed.fade.gain;
	const now = context.currentTime;
	gain.cancelScheduledValues(now);
	gain.setValueAtTime(gain.value, now);
	// (equal power: the two songs together aren't quieter in the middle)
	const steps = 32;
	const from = gain.value;
	const curve = new Float32Array(steps);
	for (let i = 0; i < steps; i++) {
		const t = i / (steps - 1);
		curve[i] =
			value > from
				? from + (value - from) * Math.sin((t * Math.PI) / 2)
				: value + (from - value) * Math.cos((t * Math.PI) / 2);
	}
	if (seconds > 0) gain.setValueCurveAtTime(curve, now, seconds);
	else gain.setValueAtTime(value, now);
	return true;
}

/** Puts the fade back to full at once (a song started without one) */
export function unfade(element: HTMLAudioElement) {
	const routed = routes.get(element);
	pending.set(element, { ...pending.get(element), fade: 1 });
	if (!routed || !context) return;
	routed.fade.gain.cancelScheduledValues(context.currentTime);
	routed.fade.gain.setValueAtTime(1, context.currentTime);
}

const samples = new Float32Array(16384);
/**
 * The song's K-weighted energy of the last moment (its mean square, the channels summed), as
 * BS.1770 counts it; null when it isn't routed
 */
export function measureMoment(element: HTMLAudioElement): number | null {
	const routed = routes.get(element);
	if (!routed || context?.state !== 'running') return null;
	let energy = 0;
	for (const meter of routed.meters) {
		meter.getFloatTimeDomainData(samples);
		let sum = 0;
		for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
		energy += sum / samples.length;
	}
	return energy;
}
