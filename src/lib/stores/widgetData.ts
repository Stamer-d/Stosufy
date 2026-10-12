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

export interface Place {
	name: string;
	lat: number;
	lon: number;
	/** Two letters, like DE */
	country?: string;
}

/** The place a widget shows (the last one chosen in any widget, until it gets its own) */
export function placeOf(data: Record<string, Record<string, any>>, uid: string): Place | null {
	return data[uid]?.place ?? data._place?.place ?? null;
}

export function setPlace(uid: string, place: Place) {
	const all = get(userSettings).settings?.widgetData ?? {};
	updateUserSettings({
		widgetData: { ...all, [uid]: { ...all[uid], place }, _place: { place } }
	});
}

/** A city by its name (Open-Meteo's geocoding, no account needed) */
export async function findPlace(name: string): Promise<Place | null> {
	const response = await fetch(
		`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`
	);
	const found = (await response.json()).results?.[0];
	return found
		? { name: found.name, lat: found.latitude, lon: found.longitude, country: found.country_code }
		: null;
}
