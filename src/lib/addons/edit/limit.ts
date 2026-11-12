// The editor's size limit (each file saved under it, for Discord and the like), kept for next
// time.

import { writable } from 'svelte/store';

const MB = 1024 * 1024;
const KEY = 'stosufy-edit-limit';

export const LIMITS = [
	{ value: 0, label: 'Any size', hint: 'as it comes out' },
	{ value: 8 * MB, label: 'Up to 8 MB' },
	{ value: 10 * MB, label: 'Up to 10 MB', hint: 'Discord' },
	{ value: 25 * MB, label: 'Up to 25 MB' },
	{ value: 50 * MB, label: 'Up to 50 MB' },
	{ value: 100 * MB, label: 'Up to 100 MB' }
];

function load() {
	try {
		const value = Number(localStorage.getItem(KEY));
		return LIMITS.some((limit) => limit.value === value) ? value : 0;
	} catch {
		return 0;
	}
}

export const sizeLimit = writable(typeof window === 'undefined' ? 0 : load());
sizeLimit.subscribe((value) => {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(KEY, String(value));
	} catch {
		// (only a convenience)
	}
});
