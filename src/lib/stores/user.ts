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

/**
 * The queue to restore on the next start. Kept apart from the settings: its position changes
 * every few seconds while playing, and saving (and re-checking) the settings with the whole
 * queue each time made the app stutter.
 */
export const savedQueue = writable<StoredQueue | null>(null);

export function updateCurrentQueue(queue: StoredQueue) {
	if (!queue?.playlistId) return;
	savedQueue.update((current) => ({ ...current, ...queue }));
}

const SAVE_AFTER = 1000;
let storePromise: ReturnType<typeof load> | null = null;
const store = () => (storePromise ??= load('userData.json'));

/** Saves a value after a moment of quiet, so quick changes are written once */
function saveLater(key: string, value: () => unknown) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(async () => {
			timer = null;
			try {
				await (await store()).set(key, value());
			} catch (error) {
				console.error(`Could not save ${key}:`, error);
			}
		}, SAVE_AFTER);
	};
}

async function initializeStores() {
	try {
		const data = await store();
		const stored = await data.get<UserSettings>('user');
		const songs = await data.get<StoredQueue['queue']>('queueSongs');
		const position = await data.get<Omit<StoredQueue, 'queue'>>('queuePosition');
		if (stored)
			userSettings.set({ settings: stored.settings ?? {}, currentQueue: null, sync: stored.sync });
		// Saved before the queue was kept apart: it was part of the user data
		const queue = songs ? { ...position, queue: songs } : (stored?.currentQueue ?? null);
		savedQueue.set(queue);

		// The settings: written when they change, not when only the queue position does
		const saveSettings = saveLater('user', () => {
			const { settings, sync } = get(userSettings);
			return { settings, sync, currentQueue: null };
		});
		let lastSettings: unknown = get(userSettings).settings;
		let lastSync: unknown = get(userSettings).sync;
		userSettings.subscribe(({ settings, sync }) => {
			if (settings === lastSettings && sync === lastSync) return;
			lastSettings = settings;
			lastSync = sync;
			saveSettings();
		});

		// The queue's songs only when they change; its position is a small value of its own
		const saveSongs = saveLater('queueSongs', () => get(savedQueue)?.queue ?? null);
		const savePosition = saveLater('queuePosition', () => {
			const { queue: _songs, ...rest } = get(savedQueue) ?? {};
			return rest;
		});
		let lastSongs = queue?.queue;
		savedQueue.subscribe((current) => {
			if (current?.queue !== lastSongs) {
				lastSongs = current?.queue;
				saveSongs();
			}
			savePosition();
		});
	} catch (err) {
		console.error('Error loading user settings:', err);
	}
	const queue = get(savedQueue);
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
/** Resolves once the settings are loaded from the device */
export const userSettingsLoaded = initializeStores();

export const DEFAULT_HOME: HomeSettings = {
	layout: 'desktop',
	sections: [
		{ id: 'hero', visible: true },
		{ id: 'playlists', visible: true },
		{ id: 'recent', visible: true },
		{ id: 'mixes', visible: true },
		{ id: 'discover', visible: true }
	],
	heroBackground: 'current',
	pinnedSetId: null
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
	accent: 'violet',
	background: true,
	dim: 75,
	video: true,
	beatEffects: true,
	focusLyrics: true
};

/**
 * The home settings, with the sections added since they were saved (where they are by
 * default: after the section before them)
 */
export function homeSettings(saved: Partial<HomeSettings> | undefined): HomeSettings {
	const home = { ...DEFAULT_HOME, ...saved };
	const sections = [...home.sections];
	DEFAULT_HOME.sections.forEach((section, i) => {
		if (sections.some((s) => s.id === section.id)) return;
		const before = DEFAULT_HOME.sections[i - 1];
		const at = before ? sections.findIndex((s) => s.id === before.id) + 1 : 0;
		sections.splice(at, 0, { ...section });
	});
	return { ...home, sections };
}

export function updateHomeSettings(change: Partial<HomeSettings>) {
	userSettings.update((u) => ({
		...u,
		settings: { ...u.settings, home: { ...homeSettings(u.settings.home), ...change } }
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
