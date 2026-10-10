// The volume of a song is the user's volume × the song's normalization gain × its crossfade
// fade. Everything that changes one of them goes through here.

import { get } from 'svelte/store';
import { userSettings } from './user';

interface Levels {
	/** Loudness normalization of the song */
	gain: number;
	/** 0–1 while fading in or out for a crossfade */
	fade: number;
}

const levels = new WeakMap<HTMLAudioElement, Levels>();
const active = new Set<HTMLAudioElement>();
let userVolume: number | null = null;

function volumeSetting() {
	return userVolume ?? (get(userSettings).settings?.volume || 0.05);
}

function apply(audio: HTMLAudioElement) {
	const { gain, fade } = levels.get(audio) ?? { gain: 1, fade: 1 };
	const normalize = get(userSettings).settings?.normalize ?? true;
	audio.volume = Math.min(1, Math.max(0, volumeSetting() * (normalize ? gain : 1) * fade));
}

/** Applies changed settings (e.g. normalization turned off) to the playing songs */
export function refresh() {
	active.forEach(apply);
}

function update(audio: HTMLAudioElement, change: Partial<Levels>) {
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

/** The volume chosen by the user, applied to every playing song */
export function setVolume(volume: number) {
	userVolume = volume;
	active.forEach(apply);
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
