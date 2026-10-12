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
		} catch {
			// Not allowed (or offline): the backend tells which
			backendOnly.add(host);
		}
	}
	return tauriFetch(url, init);
}
