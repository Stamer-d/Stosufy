// The Dash mode's sound settings: how loud its own sounds are and which of them play
// (kept on this device)

import { writable } from 'svelte/store';

export interface DashSoundSettings {
	/** 0–1 */
	volume: number;
	death: boolean;
	checkpoint: boolean;
	complete: boolean;
	/** A soft tick on every press */
	click: boolean;
}

const KEY = 'stosufy-dash-sounds';
const DEFAULTS: DashSoundSettings = {
	volume: 0.6,
	death: true,
	checkpoint: true,
	complete: true,
	click: false
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
