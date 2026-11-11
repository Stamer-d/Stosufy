// An add-on: a part of Stosufy that isn't there until it's installed (from the add-on store,
// /addons). Each one is a folder here, with what it is in its `addon.ts`; the rest of the
// folder is only loaded once it's installed and opened.
//
// A new add-on: a folder with an `addon.ts` (see the ones here), added to `registry.ts`.
// What it gives the app is what it names below; the app itself never imports from its folder.

import type { Component } from 'svelte';
import type { WidgetDefinition } from '../widgets';

type Loaded<T> = Promise<{ default: T }>;

export type AddonCategory = 'music' | 'games' | 'world';

export interface Addon {
	/** Its folder's name; what the settings keep of an installed add-on */
	id: string;
	name: string;
	/** One line, under its name in the store */
	summary: string;
	/** What it does, in a few sentences */
	description: string;
	/** What stands out, as a short list */
	highlights: string[];
	category: AddonCategory;
	/** Its icon (in the store, on its title bar button): a whole class, like `icon-[mingcute--disc-line]` */
	icon: string;
	/** The two colours of its picture in the store (CSS colours) */
	colors: [string, string];

	/**
	 * A view that fills the window, opened and closed with its title bar button (one at a
	 * time, see overlay.ts)
	 */
	overlay?: {
		load: () => Loaded<Component<any>>;
		/** It covers everything: the app under it isn't drawn, and its beat effects rest */
		hidesApp?: boolean;
	};
	/** A page of its own, at /addons/<id>, opened with its title bar button */
	page?: () => Loaded<Component<any>>;
	/** Widgets for the home screen */
	widgets?: {
		/** What they are, for the widget store while the add-on isn't installed */
		summary: string;
		count: number;
		load: () => Loaded<Record<string, WidgetDefinition>>;
	};
	/** A tab in the gameplay menu (next to Watch, Play and Replays) that opens the add-on */
	gameplayTab?: {
		label: string;
		description: string;
		/** On the button that opens it */
		action: string;
		/** Colours of its icon (classes) */
		tint: string;
	};
}
