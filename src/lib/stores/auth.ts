import { get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { load } from '@tauri-apps/plugin-store';
import { goto } from '$app/navigation';
import { user } from './user';
import { getStosufyUser } from '../api';
import type { Keys, User } from '../types';
import { offline, isNetworkError, noteNetworkError, whenOnline } from './network';

export const keyStore = writable<Keys>({
	access_token: '',
	refresh_token: '',
	expiry_time: 0,
	sessionKey: ''
});

const clientId = '40234';
const clientSecret = import.meta.env.VITE_CLIENT_SECRET;
const redirectUrl = 'stosufynew://callback';
/** friends.read: to show what the user's osu! friends listen to */
const scope = 'public friends.read';
export const osuAuthUrl = `https://osu.ppy.sh/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&scope=${encodeURIComponent(scope)}`;

let storesLoaded: Promise<void> | null = null;

/** Loads the saved keys and keeps them saved; once (going online again starts over) */
function initializeStores() {
	storesLoaded ??= load('keyStore.json')
		.then(async (keyData) => {
			const storedData = await keyData.get<Keys>('store');
			if (storedData) keyStore.set(storedData);
			keyStore.subscribe((value) => {
				keyData.set('store', value).catch((err) => console.error('Error saving keyStore:', err));
			});
		})
		.catch((err) => {
			console.error('Error loading keyStore:', err);
		});
	return storesLoaded;
}

/** Asks for the osu! session key (downloads need it, and it's optional at the login) */
export const sessionKeyNeeded = writable(false);

/** The osu! Songs folder picked at the login, imported once logged in */
const PENDING_OSU_FOLDER = 'stosufy-pending-osu-folder';
export function setPendingOsuFolder(folder: string | null) {
	try {
		if (folder) localStorage.setItem(PENDING_OSU_FOLDER, folder);
		else localStorage.removeItem(PENDING_OSU_FOLDER);
	} catch {
		// Not saved: it can be imported in the settings
	}
}
export function takePendingOsuFolder(): string | null {
	try {
		const folder = localStorage.getItem(PENDING_OSU_FOLDER);
		localStorage.removeItem(PENDING_OSU_FOLDER);
		return folder;
	} catch {
		return null;
	}
}

export interface SessionKeyCheck {
	status: boolean;
	status_code?: number;
	session_key: string | null;
}

export async function checkSessionKey(sessionKey: string): Promise<SessionKeyCheck> {
	if (!sessionKey)
		return {
			status: false,
			session_key: null
		};

	const response = await fetch('https://osu.ppy.sh/notifications/endpoint', {
		method: 'GET',
		headers: {
			Cookie: `osu_session=${sessionKey}`,
			Referer: 'https://osu.ppy.sh/home/account/edit'
		},
		credentials: 'include'
	});
	if (!response.ok) {
		return {
			status_code: response.status,
			status: false,
			session_key: null
		};
	}

	const newToken = response.headers.get('set-cookie')?.match(/osu_session=([^;]+)/)?.[1];
	return {
		status: true,
		session_key: newToken ?? sessionKey
	};
}

let refreshing: Promise<any> | null = null;

/**
 * Gets new tokens with the refresh token: null when osu! turns it down. Refreshes that
 * overlap share one request (osu! hands out a new refresh token each time, so a second
 * request with the old one would be turned down).
 */
export function refreshToken(refreshToken: string) {
	refreshing ??= requestRefresh(refreshToken).finally(() => (refreshing = null));
	return refreshing;
}

async function requestRefresh(refreshToken: string) {
	try {
		const response = await fetch('https://osu.ppy.sh/oauth/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: refreshToken,
				grant_type: 'refresh_token'
			})
		});
		if (!response.ok) {
			return null;
		}
		const data = await response.json();
		keyStore.update((current) => ({
			...current,
			access_token: data.access_token,
			refresh_token: data.refresh_token,
			expiry_time: Date.now() + data.expires_in * 1000
		}));

		return data;
	} catch (error) {
		console.error('Error refreshing token:', error);
		throw error;
	}
}

/** The last logged in user, to start offline with */
const LAST_USER = 'stosufy-last-user';

/**
 * The osu! access token, renewed first if it ran out or is about to (timers don't run while
 * the computer sleeps, so the scheduled refresh can be late)
 */
export async function freshToken(force = false): Promise<string> {
	const keys = get(keyStore);
	if (!keys.refresh_token) return keys.access_token;
	if (force || keys.expiry_time - Date.now() < 60 * 1000) {
		await refreshToken(keys.refresh_token).catch(() => null);
	}
	return get(keyStore).access_token;
}

export async function verifyAccessToken(
	token: string
): Promise<{ status: boolean; userData: User | null }> {
	try {
		const userData = await getStosufyUser(token);
		user.set(userData);
		try {
			localStorage.setItem(LAST_USER, JSON.stringify(userData));
		} catch {
			// Only for starting offline
		}
		return { status: true, userData };
	} catch (error) {
		// No connection is no reason to log in again
		if (isNetworkError(error)) throw error;
		return { status: false, userData: null };
	}
}

/** The code of the osu! login link (stosufynew://callback?code=…), or null for other links */
export function authCode(link: string | undefined): string | null {
	if (!link?.includes('code=')) return null;
	try {
		return new URL(link).searchParams.get('code');
	} catch {
		return decodeURIComponent(link.split('code=')[1].split('&')[0]);
	}
}

export async function exchangeCode(code: string) {
	try {
		const response = await fetch('https://osu.ppy.sh/oauth/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				code: code,
				grant_type: 'authorization_code',
				redirect_uri: redirectUrl
			})
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json();
		return data;
	} catch (error) {
		console.error('Error exchanging code for tokens:', error);
		throw error;
	}
}

export async function checkAccessToken(shouldPush = true, round = 0): Promise<boolean> {
	if (round > 1) {
		console.log('Token refresh failed');
		if (shouldPush) {
			goto('/login', { replaceState: true });
		}
		return false;
	}

	let tokens = get(keyStore);
	if (!tokens.access_token) {
		if (shouldPush) {
			goto('/login', { replaceState: true });
		}
		return false;
	}

	const isValid = await verifyAccessToken(tokens.access_token);
	if (isValid.status) {
		return true;
	}

	// Token is invalid - try to refresh it and check again
	const isRefreshed = await refreshToken(tokens.refresh_token);
	if (!isRefreshed) {
		if (shouldPush) {
			goto('/login', { replaceState: true });
		}
		return false;
	}
	return checkAccessToken(shouldPush, round + 1);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let scheduledFor = 0;

// Refreshes the access token one minute before it expires, retrying every minute while the
// connection fails
function scheduleTokenRefresh() {
	clearTimeout(refreshTimer);
	scheduledFor = get(keyStore).expiry_time;
	const refreshIn = Math.max(scheduledFor - Date.now() - 60 * 1000, 0);
	refreshTimer = setTimeout(async () => {
		// Offline it can't work: tried again once a minute (and the token is renewed before
		// use anyway, see freshToken)
		let retryIn = 60 * 1000;
		if (!get(offline)) {
			try {
				if (await refreshToken(get(keyStore).refresh_token)) return scheduleTokenRefresh();
				// Turned down by osu! (or it has trouble): not asked again every minute
				retryIn = 10 * 60 * 1000;
			} catch {
				// No connection; refreshToken already logs the error
			}
		}
		refreshTimer = setTimeout(scheduleTokenRefresh, retryIn);
	}, refreshIn);
}

/**
 * Keeps the refresh scheduled for the tokens there are: new ones from the login, or ones
 * renewed early by freshToken, move the refresh along
 */
let following = false;
function followTokens() {
	if (following) return;
	following = true;
	keyStore.subscribe(({ refresh_token, expiry_time }) => {
		if (!refresh_token) {
			clearTimeout(refreshTimer);
			scheduledFor = 0;
		} else if (expiry_time !== scheduledFor) scheduleTokenRefresh();
	});
}

/** Starts the app without a connection: with the last user and the songs on this computer */
function startOffline() {
	try {
		const last = localStorage.getItem(LAST_USER);
		if (last && !get(user)?.id) user.set(JSON.parse(last));
	} catch {
		// No saved user: the app still works with the downloaded songs
	}
	goto('/home', { replaceState: true });
	// Logged in properly once the connection is back
	const stop = whenOnline(() => {
		stop();
		startTokenRefresh();
	});
}

export async function startTokenRefresh() {
	await initializeStores();
	followTokens();
	// Never logged in: that needs a connection anyway
	if (!get(keyStore).refresh_token) {
		goto('/login', { replaceState: true });
		return;
	}
	if (get(offline)) return startOffline();
	try {
		if (get(keyStore).expiry_time < Date.now()) {
			const refreshed = await refreshToken(get(keyStore).refresh_token);
			if (refreshed == null) {
				goto('/login', { replaceState: true });
				return;
			}
		} else if (!(await checkAccessToken())) {
			return;
		}
	} catch (error) {
		noteNetworkError(error);
		if (get(offline) || isNetworkError(error)) return startOffline();
		throw error;
	}
	goto('/home', { replaceState: true });
}
