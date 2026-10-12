// What a placed widget keeps (a note's text, the weather's city): in the settings, by the
// widget's uid, so it follows the user to other computers like the layout does

import { derived, get } from 'svelte/store';
import { userSettings, updateUserSettings } from './user';

export const widgetData = derived(
	userSettings,
	($settings) => $settings.settings?.widgetData ?? {}
);

export function setWidgetData(uid: string, change: Record<string, unknown>) {
	const all = get(userSettings).settings?.widgetData ?? {};
	updateUserSettings({ widgetData: { ...all, [uid]: { ...all[uid], ...change } } });
}
