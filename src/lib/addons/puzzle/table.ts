// What the puzzle lies on: the picture blurred behind it, or a table of its own colour, so
// dark (or light) pieces don't vanish into it. Kept on this computer.

import { writable } from 'svelte/store';

export type TableStyle = 'picture' | 'dark' | 'slate' | 'light' | 'felt' | 'wood';

export const TABLES: { id: TableStyle; label: string; css: string }[] = [
	{ id: 'picture', label: 'The picture, blurred', css: '#111' },
	{ id: 'dark', label: 'Dark', css: '#0e0d12' },
	{ id: 'slate', label: 'Slate', css: 'linear-gradient(160deg, #3a4150, #252a35)' },
	{ id: 'light', label: 'Light', css: 'linear-gradient(160deg, #e7e3dc, #c9c4ba)' },
	{
		id: 'felt',
		label: 'Green felt',
		css: 'radial-gradient(ellipse at center, #2f7a52 0%, #1d5238 60%, #123524 100%)'
	},
	{
		id: 'wood',
		label: 'Wood',
		css: 'repeating-linear-gradient(92deg, rgba(0,0,0,0.07) 0 3px, transparent 3px 22px), linear-gradient(170deg, #8a5a36, #5e3a20)'
	}
];

const KEY = 'puzzleTable';

function read(): TableStyle {
	try {
		const saved = localStorage.getItem(KEY) as TableStyle | null;
		return saved && TABLES.some((table) => table.id === saved) ? saved : 'picture';
	} catch {
		return 'picture';
	}
}

export const tableStyle = writable<TableStyle>(read());
tableStyle.subscribe((style) => {
	try {
		localStorage.setItem(KEY, style);
	} catch {
		// (not remembered)
	}
});
