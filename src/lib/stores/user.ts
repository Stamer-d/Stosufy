import { load } from '@tauri-apps/plugin-store';
import { get, writable } from 'svelte/store';
import { playlistLoadingStatus } from './playlist';
import { setSongQueue } from './audio';
import { mapDataStore } from './data';
import type {
	AppearanceSettings,
	HomeSettings,
	Settings,
	StoredQueue,
	User,
	UserSettings
} from '../types';

export const user = writable<User>({});
export const userSettings = writable<UserSettings>({
	settings: {},
	currentQueue: null
});

export function updateUserSettings(newSettings: Settings) {
	userSettings.update((currentUser) => ({
		...currentUser,
		settings: { ...currentUser.settings, ...newSettings }
	}));
}

export function updateCurrentQueue(queue: StoredQueue) {
	if (!queue?.playlistId) return;
	userSettings.update((currentUser) => ({
		...currentUser,
		currentQueue: { ...currentUser.currentQueue, ...queue }
	}));
}

async function initializeStores() {
	await load('userData.json')
		.then((data) => {
			return data.get<UserSettings>('user');
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
			console.error('Error loading user settings:', err);
		});
	const queue = get(userSettings).currentQueue;
	let setQueue = false;
	if (queue && queue?.type == 'playlist') {
		const checkIfReady = async () => {
			const playlistLoaded = !get(playlistLoadingStatus)[queue.playlistId];
			const mapData = get(mapDataStore);
			const mapDataLoaded = mapData && Object.keys(mapData).length > 0;

			if (playlistLoaded && mapDataLoaded && !setQueue) {
				setQueue = true;
				await setSongQueue(
					queue.index,
					queue.queue,
					queue.type,
					queue.playlistId,
					false,
					queue.currentSeconds
				);
				unsubscribePlaylist();
				unsubscribeMapData();
			}
		};

		const unsubscribePlaylist = playlistLoadingStatus.subscribe(checkIfReady);
		const unsubscribeMapData = mapDataStore.subscribe(checkIfReady);
	}
}
initializeStores();

export const DEFAULT_HOME: HomeSettings = {
	sections: [
		{ id: 'hero', visible: true },
		{ id: 'playlists', visible: true },
		{ id: 'recent', visible: true },
		{ id: 'discover', visible: true }
	],
	heroBackground: 'current',
	pinnedSetId: null
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
	accent: 'violet',
	background: true,
	dim: 75
};

export function updateHomeSettings(change: Partial<HomeSettings>) {
	userSettings.update((u) => ({
		...u,
		settings: { ...u.settings, home: { ...DEFAULT_HOME, ...u.settings.home, ...change } }
	}));
}

export function updateAppearance(change: Partial<AppearanceSettings>) {
	userSettings.update((u) => ({
		...u,
		settings: {
			...u.settings,
			appearance: { ...DEFAULT_APPEARANCE, ...u.settings.appearance, ...change }
		}
	}));
}
