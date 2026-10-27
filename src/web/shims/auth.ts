// The web app's login: the osu! access token, pasted in (the proof of concept: without the
// client secret, which stays out of a web page, it can't be renewed; it lasts a day). Once
// it ran out, the app asks for a new one.

import { derived, get, writable } from 'svelte/store';

interface Keys {
	access_token: string;
	refresh_token: string;
	expiry_time: number;
	sessionKey: string;
}

const KEY = 'stosufy-web-login';
const empty: Keys = { access_token: '', refresh_token: '', expiry_time: 0, sessionKey: '' };

function saved(): Keys {
	try {
		return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return empty;
	}
}

export const keyStore = writable<Keys>(typeof localStorage === 'undefined' ? empty : saved());
keyStore.subscribe((keys) => {
	try {
		localStorage.setItem(KEY, JSON.stringify(keys));
	} catch {
		// (private browsing: the login lasts as long as the page)
	}
});

export const sessionKeyNeeded = writable(false);

/** The login ran out (checked every minute) */
const now = writable(Date.now());
if (typeof window !== 'undefined') setInterval(() => now.set(Date.now()), 60_000);
export const loginExpired = derived(
	[keyStore, now],
	([keys, time]) => !!keys.access_token && !!keys.expiry_time && keys.expiry_time <= time
);

export async function freshToken(_force = false): Promise<string> {
	return get(keyStore).access_token;
}

/**
 * What the desktop app copies: `{ "token": …, "expires": … }` (when it runs out, in ms), or
 * the token alone (then it's taken to last a day)
 */
export function readLogin(text: string) {
	const pasted = text.trim();
	try {
		const login = JSON.parse(pasted);
		if (typeof login?.token === 'string')
			return { token: login.token, expires: Number(login.expires) || Date.now() + 86_400_000 };
	} catch {
		// (the token alone)
	}
	return { token: pasted, expires: Date.now() + 86_400_000 };
}

export function logIn(token: string, expires = Date.now() + 86_400_000) {
	keyStore.set({ ...empty, access_token: token.trim(), expiry_time: expires });
}

export function logOut() {
	keyStore.set(empty);
}
