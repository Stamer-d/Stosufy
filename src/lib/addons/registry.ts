// Every add-on there is, in the store's order. Only what each one is (its addon.ts): their
// code is loaded when they're installed and opened.

import type { Addon, AddonCategory } from './types';
import dj from './dj/addon';
import dash from './dash/addon';
import puzzle from './puzzle/addon';
import world from './world/addon';
import convert from './convert/addon';
import edit from './edit/addon';

export const ADDONS: Addon[] = [dj, dash, puzzle, world, convert, edit];

export const ADDON_CATEGORIES: { id: AddonCategory; label: string }[] = [
	{ id: 'music', label: 'Music' },
	{ id: 'games', label: 'Games' },
	{ id: 'world', label: 'World' },
	{ id: 'tools', label: 'Tools' }
];

export function addonById(id: string | null | undefined) {
	return ADDONS.find((addon) => addon.id === id) ?? null;
}
