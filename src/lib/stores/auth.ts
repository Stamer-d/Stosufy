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

async function initializeStores() {
	await load('keyStore.json')
		.then((keyData) => {
			return keyData.get<Keys>('store');
		})
		.then((storedData) => {
			if (storedData) {
				keyStore.set(storedData);
			}
			keyStore.subscribe(async (value) => {
				await load('keyStore.json').then((keyData) => {
					keyData.set('store', value);
				});
			});
		})
		.catch((err) => {
			console.error('Error loading keyStore:', err);
		});
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

export async function refreshToken(refreshToken: string) {
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

let refreshing: Promise<unknown> | null = null;
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
		refreshing ??= refreshToken(keys.refresh_token)
			.catch(() => null)
			.finally(() => (refreshing = null));
		await refreshing;
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

// Refreshes the access token one minute before it expires, retrying every minute on failure
function scheduleTokenRefresh() {
	clearTimeout(refreshTimer);
	const refreshIn = Math.max(get(keyStore).expiry_time - Date.now() - 60 * 1000, 0);
	refreshTimer = setTimeout(async () => {
		try {
			if (await refreshToken(get(keyStore).refresh_token)) {
				scheduleTokenRefresh();
				return;
			}
		} catch {
			// refreshToken already logs the error
		}
		refreshTimer = setTimeout(scheduleTokenRefresh, 60 * 1000);
	}, refreshIn);
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
	scheduleTokenRefresh();
}
