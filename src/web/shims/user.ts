// The desktop app's user settings, as far as the shared code asks for them in the web app
// (the lyrics' romaji and timing): kept on the phone

import { writable } from 'svelte/store';
import type { Settings, User, UserSettings } from '../../lib/types';

const KEY = 'stosufy-web-settings';

function kept(): Settings {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}');
	} catch {
		return {};
	}
}

export const user = writable<User>({});
export const userSettings = writable<UserSettings>({
	settings: typeof localStorage === 'undefined' ? {} : kept(),
	currentQueue: null
});
userSettings.subscribe(({ settings }) => {
	try {
		localStorage.setItem(KEY, JSON.stringify(settings ?? {}));
	} catch {
		// (only for now)
	}
});

export function updateUserSettings(newSettings: Settings) {
	userSettings.update((current) => ({
		...current,
		settings: { ...current.settings, ...newSettings }
	}));
}
