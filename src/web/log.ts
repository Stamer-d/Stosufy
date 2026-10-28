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

// What went wrong, and when the app stood still, into the log too (a song or the app that
// stops by itself can then be told apart)
if (typeof window !== 'undefined') {
	window.addEventListener('error', (event) =>
		log(`error: ${event.message} (${String(event.filename).split('/').pop()}:${event.lineno})`)
	);
	window.addEventListener('unhandledrejection', (event) => {
		const reason = event.reason;
		log(`error: ${reason instanceof Error ? reason.message : String(reason)}`);
	});
	// A beat a second: one that comes much later means the app was stuck in between
	let last = performance.now();
	setInterval(() => {
		const now = performance.now();
		const late = now - last - 1000;
		last = now;
		if (late > 2000 && !document.hidden)
			log(`the app was stuck for ${(late / 1000).toFixed(1)} s on ${location.pathname}`);
	}, 1000);
	// (in the background the beats stop: that's not stuck)
	document.addEventListener('visibilitychange', () => (last = performance.now()));
}
