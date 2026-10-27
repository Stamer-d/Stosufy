// What the player did, kept on the phone (the last 80 events) and shown on the checks page:
// to see what happens with the screen locked, where nothing can be watched

import { writable } from 'svelte/store';

const KEY = 'stosufy-web-log';
const MOST = 80;

function kept(): string[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]');
	} catch {
		return [];
	}
}

export const playerLog = writable<string[]>(typeof localStorage === 'undefined' ? [] : kept());

export function log(event: string) {
	const time = new Date().toLocaleTimeString('de-DE');
	const hidden = typeof document !== 'undefined' && document.hidden ? ' (hidden)' : '';
	playerLog.update((all) => {
		const next = [...all, `${time}${hidden} ${event}`].slice(-MOST);
		try {
			localStorage.setItem(KEY, JSON.stringify(next));
		} catch {
			// (full: only on the page)
		}
		return next;
	});
}

export function clearLog() {
	playerLog.set([]);
	try {
		localStorage.removeItem(KEY);
	} catch {
		// (nothing kept)
	}
}

if (typeof document !== 'undefined') {
	document.addEventListener('visibilitychange', () =>
		log(document.hidden ? 'app hidden' : 'app shown')
	);
}
