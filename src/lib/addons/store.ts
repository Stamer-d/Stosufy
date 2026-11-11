// Which add-ons are installed (in the settings, so they're the same on every device), and
// installing, removing and opening them.

import type { Component } from 'svelte';
import { derived, get, writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { userSettings, updateUserSettings } from '../stores/user';
import { showToast } from '../stores/toast';
import { ADDONS, addonById } from './registry';
import { openOverlay } from './overlay';
import type { Addon } from './types';

let last: Addon[] = [];
/** The installed add-ons, in the store's order */
export const installedAddons = derived(
	userSettings,
	($user, set) => {
		const ids = $user.settings?.addons ?? [];
		const next = ADDONS.filter((addon) => ids.includes(addon.id));
		// (the same list again when another setting changed: nothing made from it is made anew)
		if (next.length !== last.length || next.some((addon, i) => addon !== last[i])) last = next;
		set(last);
	},
	[] as Addon[]
);

/** The add-ons being installed now (their code is being loaded) */
export const installing = writable<string[]>([]);

/** The add-on whose view fills the window, or null */
export const activeOverlay = derived([openOverlay, installedAddons], ([$open, $installed]) =>
	$open ? ($installed.find((addon) => addon.id === $open && addon.overlay) ?? null) : null
);

interface OverlayView {
	id: string;
	component: Component<any>;
	hidesApp: boolean;
}
const views = new Map<string, Component<any>>();

/**
 * The view to show over the app: none, or the open add-on's once its code is loaded (the
 * first time it's opened). A list, so the layout shows it in an each block and the view's own
 * transition plays when it comes, goes or makes way for another one.
 */
export const overlayViews = derived(
	activeOverlay,
	($active, set: (views: OverlayView[]) => void) => {
		if (!$active?.overlay) return set([]);
		const { id, name, overlay } = $active;
		const show = (component: Component<any>) =>
			set([{ id, component, hidesApp: !!overlay.hidesApp }]);
		const ready = views.get(id);
		if (ready) return show(ready);
		set([]);
		let current = true;
		overlay
			.load()
			.then((module) => {
				views.set(id, module.default);
				if (current) show(module.default);
			})
			.catch((error) => {
				console.error(`Could not open ${id}:`, error);
				if (!current) return;
				showToast(`Couldn't open ${name}, try again`, 'icon-[mingcute--warning-line]');
				openOverlay.set(null);
			});
		return () => {
			current = false;
		};
	},
	[] as OverlayView[]
);

/** A view is open that covers the whole app (which isn't drawn under it) */
export const appHidden = derived(overlayViews, ($views) => $views.some((view) => view.hidesApp));

/** Everything an add-on is made of, loaded (so it opens at once, also without a connection) */
function load(addon: Addon) {
	return Promise.all([addon.overlay?.load(), addon.page?.(), addon.widgets?.load()]);
}

export async function installAddon(id: string) {
	const addon = addonById(id);
	const installed = get(userSettings).settings?.addons ?? [];
	if (!addon || installed.includes(id) || get(installing).includes(id)) return;
	installing.update((ids) => [...ids, id]);
	try {
		await load(addon);
		// (the settings as they are now: another one may have been installed meanwhile)
		const now = get(userSettings).settings?.addons ?? [];
		if (!now.includes(id)) updateUserSettings({ addons: [...now, id] });
		showToast(`${addon.name} installed`, 'icon-[mingcute--check-circle-line]');
	} catch (error) {
		console.error(`Could not install ${id}:`, error);
		showToast(`Couldn't install ${addon.name}, try again`, 'icon-[mingcute--warning-line]');
	} finally {
		installing.update((ids) => ids.filter((other) => other !== id));
	}
}

/**
 * Takes an add-on out of the app. What it kept (records, settings, placed widgets) stays, and
 * is there again when it's installed again.
 */
export function uninstallAddon(id: string) {
	const addon = addonById(id);
	const installed = get(userSettings).settings?.addons ?? [];
	if (!addon || !installed.includes(id)) return;
	openOverlay.update((open) => (open === id ? null : open));
	updateUserSettings({ addons: installed.filter((other) => other !== id) });
	showToast(`${addon.name} removed`, 'icon-[mingcute--delete-2-line]');
}

/** Opens an installed add-on: its view over the app (closed again if it's open), or its page */
export function openAddon(addon: Addon, { toggle = false } = {}) {
	if (addon.overlay) {
		openOverlay.update((open) => (open === addon.id && toggle ? null : addon.id));
	} else if (addon.page) {
		openOverlay.set(null);
		goto(`/addons/${addon.id}`);
	}
}
