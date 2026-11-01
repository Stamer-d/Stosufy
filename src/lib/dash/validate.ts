// Checks a Dash level with its own physics, the way a player meets it: the presses that finish
// it (the plan) get to the end; around every click, how much earlier or later the press may
// come and still get through; how closely the clicks follow each other; and how long each
// obstacle can be seen before it has to be clicked. The generator makes sure of the first
// (generate.ts); the rest says how fair the level is (the tests hold it to that).

import {
	STEP,
	simulate,
	startState,
	type InputEvent,
	type Mode,
	type PlayerState
} from './physics';
import type { Level } from './generate';

/** The parts that are steered by holding, not clicked: their presses have no window of their own */
const STEERED: Mode[] = ['ship', 'wave'];

/** How far ahead of the player the screen shows at least (blocks; a 4:3 window, see render.ts) */
export const SIGHT = 10.5;

export interface ClickWindow {
	/** The planned press (song ms) and the kind of part it's in */
	time: number;
	mode: Mode;
	/** How much earlier and later (ms) it may come, the rest on time, and still get through */
	early: number;
	late: number;
}

export interface LevelReport {
	/** The plan gets to the end */
	finishes: boolean;
	/** Where it crashes if not (song ms) */
	crash: number | null;
	clicks: ClickWindow[];
	/** The narrowest window of all clicks (early + late) and the median one (ms) */
	narrowest: number;
	median: number;
	/** The shortest time between two clicks (ms) */
	closest: number;
	/** The shortest time an obstacle is on the screen before it's reached (ms) */
	sight: number;
}

/** How far a window is looked for (ms each way) */
const MAX = 160;

export function checkLevel(level: Level, options: { windows?: boolean } = {}): LevelReport {
	const { world, plan, start, end } = level;
	// The game completes on the first fixed tick that reaches the finish line. Songs
	// need not end on a tick: stopping at `end` could leave a living player 1-4 ms short.
	const finishTick = start + Math.ceil((end - start) / STEP - 1e-8) * STEP;
	const run = simulate(world, startState(world, start), finishTick, plan);
	const finishes = !run.dead && run.x >= level.xEnd - 1e-6;

	// The planned run every quarter second, to start from there
	const states: PlayerState[] = [];
	let state = startState(world, start);
	for (let t = start; t <= end; t += 250) {
		state = simulate(world, state, t, plan);
		states.push(state);
	}
	const before = (time: number) => {
		const k = Math.max(0, Math.min(states.length - 1, Math.floor((time - start) / 250) - 1));
		return states[k];
	};

	const presses = plan.filter((e) => e.down);
	const clicks: ClickWindow[] = [];
	let closest = Infinity;
	let last = -Infinity;
	for (let i = 0; i < plan.length; i++) {
		const press = plan[i];
		if (!press.down) continue;
		const mode = world.sectionAt(press.time).mode;
		if (STEERED.includes(mode)) continue;
		closest = Math.min(closest, press.time - last);
		last = press.time;
		if (options.windows === false || !finishes) continue;
		const release = plan.findIndex((e, k) => k > i && !e.down);
		const nextPress = presses.find((e) => e.time > press.time);
		// Through the obstacle after it too: a late landing can be what crashes
		const until = Math.min(end, (nextPress?.time ?? press.time + 1000) + 400);
		const from = before(press.time - MAX);
		const passes = (shift: number) => {
			const inputs: InputEvent[] = plan.map((e, k) =>
				k === i || k === release ? { ...e, time: e.time + shift } : e
			);
			inputs.sort((a, b) => a.time - b.time);
			return !simulate(world, from, until, inputs).dead;
		};
		clicks.push({ time: press.time, mode, early: widest(passes, -1), late: widest(passes, 1) });
	}

	const widths = clicks.map((c) => c.early + c.late).sort((a, b) => a - b);
	let sight = Infinity;
	for (const section of world.sections) sight = Math.min(sight, (SIGHT / section.speed) * 1000);
	return {
		finishes,
		crash: finishes ? null : run.time,
		clicks,
		narrowest: widths[0] ?? 0,
		median: widths[widths.length >> 1] ?? 0,
		closest: isFinite(closest) ? closest : 0,
		sight
	};
}

/**
 * How far a press may be moved one way (ms) and still pass: in whole physics steps, up to the
 * first that fails (so a window is one piece, not passes with holes in it)
 */
function widest(passes: (shift: number) => boolean, way: 1 | -1) {
	let ok = 0;
	for (let shift = STEP; shift <= MAX; shift += STEP) {
		if (!passes(shift * way)) break;
		ok = shift;
	}
	return ok;
}
