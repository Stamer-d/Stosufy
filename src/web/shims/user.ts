// The desktop app's user and settings, as far as the shared code asks for them in the web
// app. The settings are the account's (the desktop app's settings sync brings them down and
// sends changes made here up), kept on the phone too, with what the sync knows about them.

import { writable } from 'svelte/store';
import type { Settings, User, UserSettings } from '../../lib/types';

const KEY = 'stosufy-web-settings';

function kept(): UserSettings {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		// (from before: the settings alone)
		if (saved && !('settings' in saved)) return { settings: saved, currentQueue: null };
		return { settings: {}, currentQueue: null, ...saved };
	} catch {
		return { settings: {}, currentQueue: null };
	}
}

export const user = writable<User>({});
export const userSettings = writable<UserSettings>(
	typeof localStorage === 'undefined' ? { settings: {}, currentQueue: null } : kept()
);
userSettings.subscribe(({ settings, sync }) => {
	try {
		localStorage.setItem(KEY, JSON.stringify({ settings: settings ?? {}, sync }));
	} catch {
		// (only for now)
	}
});
/** (the settings are there from the start: read from the phone right away) */
export const userSettingsLoaded = Promise.resolve();

export function updateUserSettings(newSettings: Settings) {
	userSettings.update((current) => ({
		...current,
		settings: { ...current.settings, ...newSettings }
	}));
}
