// The web app's login. Two ways in:
// - osu!'s login, once the Stosufy API has the web app's osu! OAuth app (a web page can't
//   keep a client secret: the API exchanges the code and renews the tokens with it)
// - the login copied from the desktop app: can't be renewed, so it lasts a day
// Once a login ran out for good, the app asks for a new one.

import { derived, get, writable } from 'svelte/store';

interface Keys {
	access_token: string;
	refresh_token: string;
	expiry_time: number;
	sessionKey: string;
}

const KEY = 'stosufy-web-login';
const STATE_KEY = 'stosufy-web-login-state';
const WEB_LOGIN = 'https://api.stamer-d.de/v2/stosufy/web-login';
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

/** The login ran out and can't be renewed (checked every minute) */
const now = writable(Date.now());
if (typeof window !== 'undefined') setInterval(() => now.set(Date.now()), 60_000);
export const loginExpired = derived(
	[keyStore, now],
	([keys, time]) =>
		!!keys.access_token && !keys.refresh_token && !!keys.expiry_time && keys.expiry_time <= time
);

/** osu!'s login of the web app: what the link needs, or null if the API doesn't have it yet */
export async function webLoginSetup(): Promise<{ client_id: string; redirect_uri: string } | null> {
	try {
		const response = await fetch(WEB_LOGIN);
		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
}

/** Goes to osu!'s login (it comes back to /callback with a code) */
export function startOsuLogin(setup: { client_id: string; redirect_uri: string }) {
	const state = crypto.randomUUID();
	localStorage.setItem(STATE_KEY, state);
	const params = new URLSearchParams({
		client_id: setup.client_id,
		redirect_uri: setup.redirect_uri,
		response_type: 'code',
		scope: 'public friends.read',
		state
	});
	location.href = `https://osu.ppy.sh/oauth/authorize?${params}`;
}

async function askForTokens(body: { code: string } | { refresh_token: string }) {
	const response = await fetch(`${WEB_LOGIN}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await response.json().catch(() => null);
	if (!response.ok || !data?.access_token) {
		const error = new Error(data?.error ?? `The login answered ${response.status}`);
		(error as Error & { status?: number }).status = response.status;
		throw error;
	}
	keyStore.set({
		...empty,
		access_token: data.access_token,
		refresh_token: data.refresh_token ?? '',
		expiry_time: Date.now() + Number(data.expires_in ?? 86400) * 1000
	});
}

/** Back from osu!'s login: the code becomes tokens (throws if it doesn't work) */
export async function finishOsuLogin(code: string | null, state: string | null) {
	const expected = localStorage.getItem(STATE_KEY);
	localStorage.removeItem(STATE_KEY);
	if (!code) throw new Error("osu! didn't log you in");
	if (!state || state !== expected) throw new Error('That login link is from somewhere else');
	await askForTokens({ code });
}

let refreshing: Promise<void> | null = null;

/** The access token, renewed first if it runs out in a minute (when it can be renewed) */
export async function freshToken(force = false): Promise<string> {
	const keys = get(keyStore);
	if (keys.refresh_token && (force || keys.expiry_time - Date.now() < 60_000)) {
		refreshing ??= askForTokens({ refresh_token: keys.refresh_token })
			.catch((error) => {
				// Turned down: log in again (without a connection it's tried again later)
				if (error?.status === 401) keyStore.set({ ...keys, refresh_token: '', expiry_time: 1 });
			})
			.finally(() => (refreshing = null));
		await refreshing;
	}
	return get(keyStore).access_token;
}

// Renewed ahead of time (the shared stores take the token as it is): every few minutes, and
// when the app comes back to the screen
if (typeof window !== 'undefined') {
	const renewSoon = () => {
		const keys = get(keyStore);
		if (keys.refresh_token && keys.expiry_time - Date.now() < 10 * 60_000) freshToken(true);
	};
	renewSoon();
	setInterval(renewSoon, 4 * 60_000);
	document.addEventListener('visibilitychange', () => !document.hidden && renewSoon());
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
