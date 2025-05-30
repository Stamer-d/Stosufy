import { load } from '@tauri-apps/plugin-store';
import { get, writable } from 'svelte/store';

export const user = writable({});
export const userSettings = writable({
	settings: {},
	lastPlayedSong: null
});

export function updateUserSettings(newSettings: any) {
	userSettings.update((currentUser) => ({
		...currentUser,
		settings: { ...currentUser.settings, ...newSettings }
	}));
}

export function updateLastPlayedSong(song: any) {
	userSettings.update((currentUser) => ({
		...currentUser,
		lastPlayedSong: song
	}));
}

async function initializeStores() {
	await load('userData.json')
		.then((data) => {
			return data.get('user');
		})
		.then((storedData) => {
			if (storedData) {
				userSettings.set(storedData);
			}
			userSettings.subscribe(async (value) => {
				await load('userData.json').then((data) => {
					data.set('user', value);
				});
			});
		})
		.catch((err) => {
			console.error('Error loading keyStore:', err);
		});
	console.log('KeyStore initialized: ', get(user));
}
initializeStores();
