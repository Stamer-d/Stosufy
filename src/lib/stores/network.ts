// Whether the app is online. Offline, only downloaded songs play, the library comes from the
// copy saved on this computer, and nothing complains about failed requests.

import { writable, get } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';

export const offline = writable(typeof navigator !== 'undefined' ? !navigator.onLine : false);

/** Whether an error is a failed connection (not an answer from a server) */
export function isNetworkError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		!navigator.onLine ||
		/error sending request|failed to fetch|network|dns|connect|timed out|offline/i.test(message)
	);
}

/** Notes a failed connection: the app goes offline until a check gets through again */
export function noteNetworkError(error: unknown) {
	if (isNetworkError(error)) setOffline(true);
}

let checking: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/** Called once the app is back online */
export function whenOnline(callback: () => void) {
	listeners.add(callback);
	return () => listeners.delete(callback);
}

function setOffline(value: boolean) {
	if (get(offline) === value) return;
	offline.set(value);
	if (value) {
		// Checks every 20 s whether the connection is back
		checking ??= setInterval(check, 20_000);
	} else {
		if (checking) clearInterval(checking);
		checking = null;
		for (const callback of listeners) callback();
	}
}

async function check() {
	if (!navigator.onLine) return;
	try {
		await fetch('https://osu.ppy.sh/favicon.ico', { method: 'HEAD' });
		setOffline(false);
	} catch {
		// Still offline
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('offline', () => setOffline(true));
	window.addEventListener('online', () => check());
	if (!navigator.onLine) checking = setInterval(check, 20_000);
}
