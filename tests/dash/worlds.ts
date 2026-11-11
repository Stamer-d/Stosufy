// Small worlds for the Dash tests: parts of one kind on a flat floor, built by hand, and the
// level around them that the game needs.

import { SPEEDS, World, type InputEvent, type Mode } from '../../src/lib/addons/dash/physics';
import type { Level } from '../../src/lib/addons/dash/generate';

export interface PartOptions {
	mode?: Mode;
	speedIndex?: number;
	mini?: boolean;
	/** ms */
	length?: number;
	/** The ceiling (not for the cube): 10 by default */
	ceil?: number;
}

/** A world of parts one after another from time 0, each on a floor at 0 */
export function world(...parts: PartOptions[]) {
	const w = new World();
	let time = 0;
	let x = 0;
	if (!parts.length) parts = [{}];
	parts.forEach((part, index) => {
		const mode = part.mode ?? 'cube';
		const speedIndex = part.speedIndex ?? 1;
		const speed = SPEEDS[speedIndex];
		const length = part.length ?? 10000;
		w.segments.push({ time, x, speed });
		w.sections.push({
			index,
			mode,
			mini: !!part.mini,
			start: time,
			end: time + length,
			x0: x,
			x1: x + (length / 1000) * speed,
			speed,
			speedIndex,
			floor: 0,
			ceil: mode === 'cube' ? null : (part.ceil ?? 10),
			palette: 0,
			kiai: false
		});
		time += length;
		x += (length / 1000) * speed;
	});
	w.segments.push({ time, x, speed: w.sections[w.sections.length - 1].speed });
	return w;
}

/** A tap: pressed at a time, let go a bit later */
export const tap = (time: number, length = 80): InputEvent[] => [
	{ time, down: true },
	{ time: time + length, down: false }
];

/** The level the game plays, around a world */
export function levelOf(w: World, plan: InputEvent[] = []): Level {
	const end = w.sections[w.sections.length - 1].end;
	return {
		world: w,
		plan,
		start: 0,
		end,
		xEnd: w.xAt(end),
		portals: [],
		beats: [],
		kiai: [],
		difficulty: 'normal',
		clicks: plan.filter((e) => e.down).length,
		kicks: null,
		title: 'Test',
		artist: 'Tests',
		creator: 'tests',
		version: 'test'
	};
}
