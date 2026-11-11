// What was part of the app before there were add-ons. Settings saved back then say nothing
// about add-ons: for them, all of these stay installed (an update takes nothing away). Settings
// made since always say which are installed, an empty list for a new user.

export const LEGACY_ADDONS = ['dj', 'dash', 'world', 'puzzle'];

/** The settings, with the add-ons from before if they don't say which are installed */
export function withLegacyAddons<T extends { addons?: string[] }>(settings: T): T {
	return settings.addons ? settings : { ...settings, addons: [...LEGACY_ADDONS] };
}
