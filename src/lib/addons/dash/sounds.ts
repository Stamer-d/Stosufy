// The Dash mode's sound settings: how loud its own sounds are, which of them play, and how
// much later the music is heard than played (kept on this device)

import { writable } from 'svelte/store';

export interface DashSoundSettings {
	/** 0–1 */
	volume: number;
	death: boolean;
	checkpoint: boolean;
	complete: boolean;
	/** A soft tick on every press */
	click: boolean;
	/**
	 * How much later the music reaches the ears than the player says (ms): Bluetooth
	 * headphones, some drivers. The level runs that much later, so it's on the beat again.
	 */
	delay: number;
}

const KEY = 'stosufy-dash-sounds';
const DEFAULTS: DashSoundSettings = {
	volume: 0.6,
	death: true,
	checkpoint: true,
	complete: true,
	click: false,
	delay: 0
};

function load(): DashSoundSettings {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return { ...DEFAULTS };
	}
}

export const dashSounds = writable<DashSoundSettings>(
	typeof window === 'undefined' ? { ...DEFAULTS } : load()
);

dashSounds.subscribe((value) => {
	try {
		if (typeof window !== 'undefined') localStorage.setItem(KEY, JSON.stringify(value));
	} catch {
		// Only for now then
	}
});
