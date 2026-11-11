// Which kinds of parts the Dash levels have, and in which of them gravity turns around (kept on
// this device). The cube is always there: every level starts and ends with it.

import { writable } from 'svelte/store';
import type { Mode } from './physics';

export const ALL_MODES: Mode[] = [
	'cube',
	'robot',
	'ship',
	'ball',
	'ufo',
	'wave',
	'swing',
	'spider'
];

export interface DashModeSettings {
	/** Kinds of parts left out */
	off: Mode[];
	/** Kinds of parts without gravity portals (the cube and robot: never upside down) */
	noGravity: Mode[];
	/** The cube, robot and ship parts made the older way (from the notes), not from blocks */
	classic?: boolean;
}

/** The kinds a level may have, and those with gravity portals (for the generator) */
export function allowedModes(settings: DashModeSettings) {
	return {
		modes: ALL_MODES.filter((m) => m === 'cube' || !settings.off.includes(m)),
		gravity: ALL_MODES.filter((m) => !settings.noGravity.includes(m)),
		generator: settings.classic ? ('classic' as const) : ('blocks' as const)
	};
}

/**
 * A short mark for settings that aren't the usual ones ('' for those): the levels made with
 * them are other levels, their best progress is kept apart
 */
export function modesMark(settings: DashModeSettings) {
	const off = ALL_MODES.filter((m) => m !== 'cube' && settings.off.includes(m));
	const still = ALL_MODES.filter((m) => settings.noGravity.includes(m));
	const letters = (list: Mode[]) => list.map((m) => ALL_MODES.indexOf(m)).join('');
	return (
		(off.length || still.length ? `m${letters(off)}g${letters(still)}` : '') +
		(settings.classic ? 'c' : '')
	);
}

const KEY = 'stosufy-dash-modes';
const DEFAULTS: DashModeSettings = { off: [], noGravity: [] };

function load(): DashModeSettings {
	try {
		const read = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		const valid = (list: unknown) =>
			Array.isArray(list) ? (list.filter((m) => ALL_MODES.includes(m)) as Mode[]) : [];
		return {
			off: valid(read.off).filter((m) => m !== 'cube'),
			noGravity: valid(read.noGravity),
			classic: read.classic === true
		};
	} catch {
		return { ...DEFAULTS };
	}
}

export const dashModes = writable<DashModeSettings>(
	typeof window === 'undefined' ? { ...DEFAULTS } : load()
);

dashModes.subscribe((value) => {
	try {
		if (typeof window !== 'undefined') localStorage.setItem(KEY, JSON.stringify(value));
	} catch {
		// Only for now then
	}
});
