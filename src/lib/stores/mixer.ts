// The volume of a song is the user's volume × the song's normalization gain × its crossfade
// fade. Everything that changes one of them goes through here.

import { get } from 'svelte/store';
import { userSettings, updateUserSettings } from './user';
import { fadeNode, onRoute } from './equalizer';

interface Levels {
	/** Loudness normalization of the song */
	gain: number;
	/** 0–1 while fading in or out for a crossfade */
	fade: number;
}

const levels = new WeakMap<HTMLAudioElement, Levels>();
const active = new Set<HTMLAudioElement>();

export const DEFAULT_VOLUME = 0.05;
export const MAX_VOLUME = 0.2;

/** The user's volume (settings.volume), 0 while muted */
function volumeSetting() {
	const settings = get(userSettings).settings;
	return settings?.muted ? 0 : (settings?.volume ?? DEFAULT_VOLUME);
}

function apply(audio: HTMLAudioElement) {
	const { gain, fade } = levels.get(audio) ?? { gain: 1, fade: 1 };
	const normalize = get(userSettings).settings?.normalize ?? true;
	// Routed songs fade on the audio thread (smooth even while the app is busy), the
	// element's volume is only the user's volume and the normalization
	const node = fadeNode(audio);
	const level = volumeSetting() * (normalize ? gain : 1);
	if (node) {
		audio.volume = Math.min(1, Math.max(0, level));
		if (!fading.has(audio)) node.gain.setTargetAtTime(fade, node.context.currentTime, 0.01);
	} else audio.volume = Math.min(1, Math.max(0, level * fade));
}

// A song routed in the middle of a fade starts where the fade is
onRoute((audio) => levels.get(audio as HTMLAudioElement)?.fade ?? 1);

/** Songs whose fade is scheduled on the audio thread right now */
const fading = new Set<HTMLAudioElement>();

/**
 * Fades a song from one level to another along a curve (0–1 → 0–1) over a time: on the
 * audio thread when the song is routed, else in small steps of its volume. Resolves when done.
 */
export function fadeTo(
	audio: HTMLAudioElement,
	to: number,
	ms: number,
	curve: (t: number) => number = (t) => t
): Promise<void> {
	const from = levels.get(audio)?.fade ?? 1;
	const node = fadeNode(audio);
	return new Promise((resolve) => {
		if (node) {
			const ctx = node.context;
			const steps = 64;
			const values = new Float32Array(steps);
			for (let i = 0; i < steps; i++) values[i] = from + (to - from) * curve(i / (steps - 1));
			fading.add(audio);
			node.gain.cancelScheduledValues(ctx.currentTime);
			node.gain.setValueAtTime(from, ctx.currentTime);
			node.gain.setValueCurveAtTime(values, ctx.currentTime + 0.005, Math.max(0.02, ms / 1000));
			levels.set(audio, { gain: 1, ...levels.get(audio), fade: to });
			setTimeout(() => {
				fading.delete(audio);
				resolve();
			}, ms + 20);
			return;
		}
		const start = performance.now();
		const timer = setInterval(() => {
			const progress = Math.min(1, (performance.now() - start) / ms);
			update(audio, { fade: from + (to - from) * curve(progress) });
			if (progress < 1) return;
			clearInterval(timer);
			resolve();
		}, 30);
	});
}

/** Stops a scheduled fade where it is (a crossfade cut short) */
export function holdFade(audio: HTMLAudioElement | null | undefined, fade: number) {
	if (!audio) return;
	const node = fadeNode(audio);
	fading.delete(audio);
	if (node) {
		node.gain.cancelScheduledValues(node.context.currentTime);
		node.gain.setValueAtTime(fade, node.context.currentTime);
	}
	update(audio, { fade });
}

/** Applies changed settings (e.g. normalization turned off) to the playing songs */
export function refresh() {
	active.forEach(apply);
}

function update(audio: HTMLAudioElement, change: Partial<Levels>) {
	watchVolume();
	levels.set(audio, { gain: 1, fade: 1, ...levels.get(audio), ...change });
	active.add(audio);
	apply(audio);
}

/** Registers a new song's audio with the current volume */
export function track(audio: HTMLAudioElement, fade = 1) {
	update(audio, { fade });
}

/** Forgets audio that won't play again */
export function untrack(audio: HTMLAudioElement) {
	active.delete(audio);
}

/** Sets the user's volume (0 mutes, keeping the volume to come back to) */
export function setVolume(volume: number) {
	const value = Math.min(MAX_VOLUME, Math.max(0, volume));
	updateUserSettings(value > 0 ? { volume: value, muted: false } : { muted: true });
}

export function toggleMute() {
	const settings = get(userSettings).settings;
	if (settings?.muted || !settings?.volume) {
		updateUserSettings({ muted: false, volume: settings?.volume || DEFAULT_VOLUME });
	} else updateUserSettings({ muted: true });
}

// Whenever the volume or mute changes, from wherever. Subscribed with the first song, as
// user.ts isn't ready yet when this module loads (they import each other).
let watching = false;
function watchVolume() {
	if (watching) return;
	watching = true;
	let applied = '';
	userSettings.subscribe(({ settings }) => {
		const key = `${settings?.volume}:${settings?.muted}`;
		if (key === applied) return;
		applied = key;
		active.forEach(apply);
	});
}

export function setGain(audio: HTMLAudioElement, gain: number) {
	update(audio, { gain });
}

export function setFade(audio: HTMLAudioElement, fade: number) {
	update(audio, { fade });
}

/** Smoothly changes the gain, so a song doesn't jump in volume when its loudness is known */
export function rampGain(audio: HTMLAudioElement, gain: number, duration = 1500) {
	const from = levels.get(audio)?.gain ?? 1;
	const start = performance.now();
	// A timer instead of requestAnimationFrame: it keeps running while the window is hidden
	const timer = setInterval(() => {
		const progress = Math.min(1, (performance.now() - start) / duration);
		setGain(audio, from + (gain - from) * progress);
		if (progress === 1) clearInterval(timer);
	}, 50);
}
