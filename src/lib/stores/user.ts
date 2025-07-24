import { load } from '@tauri-apps/plugin-store';
import { get, writable } from 'svelte/store';
import { playlistLoadingStatus } from './playlist';
import { setSongQueue } from './audio';
import { mapDataStore } from './data';

export const user = writable({});
export const userSettings = writable({
	settings: {},
	currentQueue: null
});

export function updateUserSettings(newSettings: any) {
	userSettings.update((currentUser) => ({
		...currentUser,
		settings: { ...currentUser.settings, ...newSettings }
	}));
}

export function updateCurrentQueue(queue: any) {
	if (!queue?.playlistId) return;
	userSettings.update((currentUser) => ({
		...currentUser,
		currentQueue: { ...currentUser.currentQueue, ...queue }
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
 