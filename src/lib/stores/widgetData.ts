// What a placed widget keeps (a note's text, the weather's city): in the settings, by the
// widget's uid, so it follows the user to other computers like the layout does

import { derived, get, readable } from 'svelte/store';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
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

/** Where the computer is, roughly (by its internet address), until a city is chosen */
const FALLBACK: Place = { name: 'Germany', lat: 51.16, lon: 10.45, country: 'DE' };
export const detectedPlace = readable<Place | null>(null, (set) => {
	let stopped = false;
	tauriFetch('https://get.geojs.io/v1/ip/geo.json')
		.then((response) => response.json())
		.then((data) => {
			const lat = Number(data.latitude);
			const lon = Number(data.longitude);
			if (!isFinite(lat) || !isFinite(lon)) throw new Error('No place');
			if (!stopped)
				set({
					name: data.city || data.region || data.country || 'You',
					lat,
					lon,
					country: data.country_code
				});
		})
		.catch(() => !stopped && set(FALLBACK));
	return () => {
		stopped = true;
	};
});

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
