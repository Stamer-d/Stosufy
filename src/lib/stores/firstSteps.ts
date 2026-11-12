// The first steps on the home page (how to get songs in): shown while there are no songs,
// until they're closed.

import { derived, writable } from 'svelte/store';
import { downloadedLibrary } from './data';

const KEY = 'stosufy-first-steps-closed';

function load() {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

const closed = writable(typeof window === 'undefined' ? false : load());

export function closeFirstSteps() {
	closed.set(true);
	try {
		localStorage.setItem(KEY, '1');
	} catch {
		// (only for this time)
	}
}

export const showFirstSteps = derived(
	[closed, downloadedLibrary],
	([$closed, $library]) => !$closed && !$library.length
);
