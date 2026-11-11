// The desktop app's user and settings, as far as the shared code asks for them in the web
// app. The settings are the account's (the desktop app's settings sync brings them down and
// sends changes made here up), kept on the phone too, with what the sync knows about them.

import { writable } from 'svelte/store';
import type { Settings, User, UserSettings } from '../../lib/types';
import { withLegacyAddons } from '../../lib/addons/legacy';

const KEY = 'stosufy-web-settings';

// (the add-ons are the desktop app's, but the settings are the account's: what they say about
// them is kept, and said from the start, like on the desktop; see lib/addons/legacy.ts)
function kept(): UserSettings {
	try {
		const text = localStorage.getItem(KEY);
		if (!text) return { settings: { addons: [] }, currentQueue: null };
		const saved = JSON.parse(text);
		// (from before: the settings alone)
		if (saved && !('settings' in saved))
			return { settings: withLegacyAddons(saved), currentQueue: null };
		return { currentQueue: null, ...saved, settings: withLegacyAddons(saved.settings ?? {}) };
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
