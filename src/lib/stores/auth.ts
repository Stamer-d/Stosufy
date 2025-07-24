import { get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { load } from '@tauri-apps/plugin-store';
import { goto } from '$app/navigation';
import { user } from './user';

export const keyStore = writable({
	access_token: '',
	refresh_token: '',
	expiry_time: 0,
	sessionKey: ''
});

const clientId = '40234';
const clientSecret = import.meta.env.VITE_CLIENT_SECRET;
const redirectUrl = 'stosufynew://callback';

async function initializeStores() {
	await load('keyStore.json')
		.then((keyData) => {
			return keyData.get('store');
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

export async function checkSessionKey(sessionKey: string) {
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
	let newToken = response.headers.get('set-cookie');
	if (!response.ok) {
		return {
			status_code: response.status,
			status: false,
			session_key: null
		};
	}

	return {
		status: true,
		session_key: newToken.match(/osu_session=([^;]+)/)[1]
	};
}

export async function refreshToken(refreshToken) {
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

export async function verifyAccessToken(token) {
	const response = await fetch('https://api.stamer-d.de/v1/stosufy/login', {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	if (response.ok) {
		const data = await response.json();

		user.set(data);
		return {
			status: true,
			userData: data
		};
	}

	return {
		status: false,
		userData: null
	};
}

export async function exchangeCode(code) {
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

export async function checkAccessToken(shouldPush = true, round = 0) {
	if (round > 1) {
		console.log('Token refresh failed');
		if (shouldPush) {
			goto('/login');
		}
		return false;
	}

	let tokens = get(keyStore);
	if (!tokens.access_token) {
		if (shouldPush) {
			goto('/login');
		}
		return false;
	}

	//Check if token is valid
	let isValid = await verifyAccessToken(tokens.access_token);
	if (isValid.status) {
		return true;
	}

	//Token is invalid - try to refresh
	let isRefreshed;
	isRefreshed = await refreshToken(tokens.refresh_token);
	if (!isRefreshed) {
		if (shouldPush) {
			goto('/login');
		}
		return false;
	} else {
		checkAccessToken(shouldPush, round + 1);
	}
}

let refreshInterval;

export async function startTokenRefresh() {
	await initializeStores();
	let diffInSeconds = Math.floor((get(keyStore).expiry_time - Date.now()) / 1000);
	if (refreshInterval) clearInterval(refreshInterval);
	if (get(keyStore).expiry_time < Date.now()) {
		const refreshed = await refreshToken(get(keyStore).refresh_token);
		if (refreshed == null) {
			goto('/login');
		} else {
			goto('/home');
		}
	} else {
		const valid = await checkAccessToken();
		if (valid) goto('/home');
		refreshInterval = setInterval(
			async () => {
				await refreshToken(get(keyStore).refresh_token);
				diffInSeconds = Math.floor((get(keyStore).expiry_time - Date.now()) / 1000);
			},
			(diffInSeconds - 60) * 1000
		);
	}

	return () => {
		if (refreshInterval) clearInterval(refreshInterval);
	};
}
