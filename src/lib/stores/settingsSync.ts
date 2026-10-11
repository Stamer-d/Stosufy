// Keeps the settings (appearance, widgets, shortcuts, …) in the user's account, so they're
// the same on every device. The settings also stay on the device, so the app starts with
// them offline. Changes made here go up after a moment; on start and when the window gets
// focus, the account's settings come down unless this device has changes not sent yet.

import { get } from 'svelte/store';
import * as api from '../api';
import { keyStore } from './auth';
import { user, userSettings, userSettingsLoaded } from './user';
import type { Settings } from '../types';

/** Settings that belong to the device, not the account */
const DEVICE_ONLY: (keyof Settings)[] = ['volume', 'muted'];
const SAVE_AFTER = 2000;

function shared(settings: Settings = {}) {
	const copy: Record<string, unknown> = { ...settings };
	for (const key of DEVICE_ONLY) delete copy[key];
	return copy;
}

/** The shared settings as last synced, to tell own changes from synced ones */
let lastSynced: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let ready = false;

function token() {
	return get(keyStore).access_token;
}

function setSync(sync: { syncedAt?: number; dirty?: boolean }) {
	userSettings.update((u) => ({ ...u, sync: { ...u.sync, ...sync } }));
}

async function save() {
	saveTimer = null;
	const settings = shared(get(userSettings).settings);
	const json = JSON.stringify(settings);
	if (json === lastSynced || !token()) return;
	try {
		const syncedAt = await api.saveSettings(token(), settings);
		lastSynced = json;
		// Changed again while saving: that change is still to send
		const now = JSON.stringify(shared(get(userSettings).settings));
		setSync({ syncedAt, dirty: now !== json });
	} catch (error) {
		console.warn('Could not save the settings:', error);
	}
}

/** Takes the account's settings, unless this device has changes to send first */
export async function pullSettings() {
	// The settings from the device first, or they'd overwrite the account's
	await userSettingsLoaded;
	if (!token() || !get(user)?.id) return;
	if (saveTimer) return;
	try {
		const remote = await api.getSettings(token());
		const local = get(userSettings);
		if (!remote || local.sync?.dirty) {
			// Nothing saved yet, or newer changes here: send this device's settings
			ready = true;
			await save();
			return;
		}
		if (remote.updatedAt === local.sync?.syncedAt) {
			// Nothing new in the account
			lastSynced = JSON.stringify(shared(local.settings));
			ready = true;
			return;
		}
		const settings = { ...(remote.settings as Settings) };
		for (const key of DEVICE_ONLY) {
			if (local.settings?.[key] !== undefined) (settings as any)[key] = local.settings[key];
			else delete (settings as any)[key];
		}
		lastSynced = JSON.stringify(shared(settings));
		userSettings.update((u) => ({
			...u,
			settings,
			sync: { syncedAt: remote.updatedAt, dirty: false }
		}));
		ready = true;
	} catch (error) {
		console.warn('Could not load the settings:', error);
	}
}

let started = false;

export function startSettingsSync() {
	if (started || typeof window === 'undefined') return;
	started = true;
	let lastUser: number | undefined;
	user.subscribe((current) => {
		if (!current?.id || current.id === lastUser) return;
		lastUser = current.id;
		ready = false;
		lastSynced = null;
		pullSettings();
	});
	userSettings.subscribe((value) => {
		// Only changes after the first sync count (not loading the settings from disk)
		if (!ready || lastSynced === null) return;
		if (JSON.stringify(shared(value.settings)) === lastSynced) return;
		if (!value.sync?.dirty) setSync({ dirty: true });
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, SAVE_AFTER);
	});
	window.addEventListener('focus', () => {
		if (ready) pullSettings();
	});
}
