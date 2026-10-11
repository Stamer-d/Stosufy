import { writable } from 'svelte/store';

export type SettingsTab = 'home' | 'appearance' | 'playback' | 'library';

/** The open tab of the settings window, or null while it's closed */
export const settingsTab = writable<SettingsTab | null>(null);

export function openSettings(tab: SettingsTab = 'appearance') {
	settingsTab.set(tab);
}
