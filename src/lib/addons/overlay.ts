// The add-on view that fills the window (the DJ mode, Dash): one at a time, by its add-on's
// id. Apart from the rest (store.ts), so an add-on's own code can use it without the list of
// all add-ons.

import { derived, writable, type Writable } from 'svelte/store';

/** The id of the add-on whose view is open, or null */
export const openOverlay = writable<string | null>(null);

/** Whether an add-on's view is open, to read and to set (opening it closes another one) */
export function overlayOpen(id: string): Writable<boolean> {
	const change = (open: boolean) =>
		openOverlay.update((current) => (open ? id : current === id ? null : current));
	return {
		subscribe: derived(openOverlay, ($open) => $open === id).subscribe,
		set: change,
		update: (fn) =>
			openOverlay.update((current) => (fn(current === id) ? id : current === id ? null : current))
	};
}
