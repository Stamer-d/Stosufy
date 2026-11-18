// Links that open an add-on, from another app or a web page (stosufynew://download?…, the
// downloader's): handed to the add-on whose host it is, and its page opened, once the app is
// started (logged in, its pages shown: a link that starts the app waits for that). An add-on
// that isn't installed is offered there, its link kept for it meanwhile.

import { goto } from '$app/navigation';
import { ADDONS } from './registry';
import { openOverlay } from './overlay';
import type { Addon } from './types';

const SCHEME = 'stosufynew:';

let started = false;
/** The add-on whose page is to be opened once the app is started */
let waiting: Addon | null = null;

/** stosufynew://download?… → "download" (null: not one of ours) */
function hostOf(text: string) {
	try {
		const address = new URL(text.trim());
		if (address.protocol.toLowerCase() !== SCHEME) return null;
		return (address.host + address.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
	} catch {
		return null;
	}
}

function show(addon: Addon) {
	openOverlay.set(null);
	void goto(`/addons/${addon.id}`);
}

/** Links opened (the app started with them, or handed them while it runs) */
export async function openAddonLinks(urls: string[] | null | undefined) {
	for (const url of urls ?? []) {
		const host = hostOf(url);
		const addon = host ? ADDONS.find((addon) => addon.link?.host === host) : undefined;
		if (!addon?.link) continue;
		let taken = false;
		try {
			taken = await addon.link.open(url);
		} catch (error) {
			console.error(`Could not open the link for ${addon.id}:`, error);
		}
		if (!taken || !addon.page) continue;
		if (started) show(addon);
		else waiting = addon;
	}
}

/** The app is started (its pages shown): an add-on a link waits for, opened now */
export function appStarted() {
	if (started) return;
	started = true;
	if (waiting) show(waiting);
	waiting = null;
}
