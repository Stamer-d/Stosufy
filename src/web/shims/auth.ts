// The web app's login: the osu! access token, pasted in (the proof of concept: without the
// client secret, which stays out of a web page, it can't be renewed; it lasts a day)

import { get, writable } from 'svelte/store';

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

export async function freshToken(_force = false): Promise<string> {
	return get(keyStore).access_token;
}

export function logIn(token: string) {
	keyStore.set({ ...empty, access_token: token.trim(), expiry_time: Date.now() + 86_400_000 });
}

export function logOut() {
	keyStore.set(empty);
}
