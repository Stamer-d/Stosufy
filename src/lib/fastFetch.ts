// The browser's own fetch where a server allows it (much quicker for big answers and many
// requests), else the app's backend (which isn't held to the browser's rules)

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/** Servers the browser may not ask (no CORS): straight to the backend for those */
const backendOnly = new Set<string>();

export async function fastFetch(url: string, init?: RequestInit): Promise<Response> {
	const host = new URL(url).host;
	if (!backendOnly.has(host)) {
		try {
			return await fetch(url, init);
		} catch (error) {
			// Given up on (see fetchWithin): not a reason to go round the browser
			if (init?.signal?.aborted) throw error;
			// Not allowed (or offline): the backend tells which
			backendOnly.add(host);
		}
	}
	return tauriFetch(url, init);
}

export class TimeoutError extends Error {
	constructor(url: string, ms: number) {
		super(`${new URL(url).host} didn't answer within ${Math.round(ms / 1000)} s`);
		this.name = 'TimeoutError';
	}
}

/**
 * A server's answer, read (by `read`) within a time, else a TimeoutError: a server that
 * doesn't answer never holds up what waits for it
 */
export async function fetchWithin<T>(
	url: string,
	ms: number,
	read: (response: Response) => Promise<T>,
	init?: RequestInit
): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new TimeoutError(url, ms));
			controller.abort();
		}, ms);
	});
	try {
		return await Promise.race([
			fastFetch(url, { ...init, signal: controller.signal }).then(read),
			late
		]);
	} finally {
		clearTimeout(timer);
	}
}
