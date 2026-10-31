// The parts between a floor and a ceiling: ship, UFO, swing, ball and spider. The way
// through is played first (the clicks on the notes; the ship flies along the notes'
// heights), on time, early and late; then blocks are built around that way, a bit away from
// it, column by column on the grid, and spikes go on their surfaces where there's room. So
// the structures follow the music, and the way they leave always works.

import {
	copyState,
	hitbox,
	press,
	simulate,
	step,
	STEP,
	type InputEvent,
	type PlayerState,
	type Section,
	type Solid
} from '../physics';
import { clamp, legalAround, shuffleByWeight, tap, used, type Context } from '../build';
import type { DashNote } from '../chart';

interface Column {
	x: number;
	low: number;
	high: number;
	spike: 0 | 1 | -1;
}

/** The ship's way: holds while below where it should be (as a person flies, roughly) */
function flyShip(ctx: Context, from: PlayerState, until: number, target: (x: number) => number) {
	const { world } = ctx;
	const s = copyState(from);
	const events: InputEvent[] = [];
	let lastChange = -1e9;
	while (s.time + STEP <= until + 1e-6 && !s.dead) {
		const next = s.time + STEP;
		const speed = world.sectionAt(s.time).speed;
		const ahead = target(s.x + speed * 0.18);
		const wanted = clamp((ahead - s.y) * 6, -7, 7);
		const hold = s.vy < wanted;
		if (hold !== s.held && next - lastChange > 30) {
			press(s, hold);
			events.push({ time: next, down: hold });
			lastChange = next;
		}
		step(world, s, next);
	}
	if (s.held) events.push({ time: until, down: false });
	return { end: s, events };
}

export function buildFlight(
	ctx: Context,
	section: Section,
	notes: DashNote[],
	clicks: number[],
	entry: PlayerState
) {
	const { world, plan, rng, preset } = ctx;
	const mode = section.mode;
	const top = section.ceil!;
	const floor = section.floor;
	const speed = section.speed;
	const tolerance = preset.tolerance;
	const box = hitbox(mode, section.mini);
	const startX = world.xAt(section.start + 450);
	const endX = world.xAt(section.end - 450);

	// --- The way through ---------------------------------------------------------------
	let events: InputEvent[] = [];
	if (mode === 'ship') {
		// Along the notes' heights, no steeper than a ship climbs
		const keys: { x: number; y: number }[] = [{ x: section.x0, y: clamp(entry.y, 2, top - 2) }];
		const margin = preset.ship + 0.4;
		for (const note of notes) {
			const x = world.xAt(note.time);
			if (x < startX + 2 || x > endX) continue;
			const last = keys[keys.length - 1];
			if (x - last.x < 2.5) continue;
			const y = margin + note.height * (top - 2 * margin);
			const steepest = 0.45 * (x - last.x);
			keys.push({ x, y: clamp(y, last.y - steepest, last.y + steepest) });
		}
		keys.push({ x: section.x1 + 2, y: keys[keys.length - 1].y });
		const path = (x: number) => {
			for (let k = 1; k < keys.length; k++)
				if (x <= keys[k].x) {
					const a = keys[k - 1];
					const b = keys[k];
					const f = clamp((x - a.x) / (b.x - a.x || 1), 0, 1);
					return a.y + (b.y - a.y) * f * f * (3 - 2 * f);
				}
			return keys[keys.length - 1].y;
		};
		events = flyShip(ctx, entry, section.end, path).events;
	} else {
		// The clicks; the ball and the spider only switch on a surface, else a blue orb does it
		const times = clicks.filter((t) => t > section.start + 400 && t < section.end - 400);
		let s = entry;
		for (const time of times) {
			const at = simulate(world, s, time, events);
			if (at.dead) break;
			if ((mode === 'ball' || mode === 'spider') && !at.grounded) {
				if (mode === 'spider') continue;
				const id = world.id();
				world.orbs.add({ id, kind: 'blue', x: at.x, y: at.y, x0: at.x - 0.6, x1: at.x + 0.6 });
			}
			events.push(...tap(time, mode === 'swing' || mode === 'ufo' ? 70 : 90));
			s = at;
		}
	}

	// The ways it may go: on time, and early and late (not for the ship, a person steers it)
	const runs: { x: number; y: number }[][] = [];
	const variants: InputEvent[][] = [events];
	if (mode !== 'ship') {
		for (const [shift, length] of [
			[-tolerance, 60],
			[tolerance, 160],
			[-tolerance * 0.5, 160],
			[tolerance * 0.5, 60]
		]) {
			variants.push(
				events
					.filter((e) => e.down)
					.flatMap((e) => tap(e.time + shift, length))
					.sort((a, b) => a.time - b.time)
			);
		}
	}
	for (const inputs of variants) {
		const trace: { x: number; y: number; time: number }[] = [];
		simulate(world, entry, section.end, inputs, { trace });
		runs.push(trace);
	}

	// --- The blocks around it -------------------------------------------------------------
	const margin =
		mode === 'ship'
			? preset.ship - 0.45
			: mode === 'ball' || mode === 'spider'
				? 0.18
				: mode === 'ufo'
					? 0.55
					: 0.5;
	const cap =
		mode === 'spider' ? 0 : mode === 'ball' ? Math.floor((top - floor) / 2) - 1 : top - floor;
	const group = rng() < 0.5 ? 2 : 1;
	const columns: Column[] = [];
	for (let x = Math.ceil(startX); x + group <= Math.floor(endX); x += group) {
		let lowest = Infinity;
		let highest = -Infinity;
		for (const trace of runs)
			for (const p of trace) {
				if (p.x < x - box.w - 0.3 || p.x > x + group + box.w + 0.3) continue;
				lowest = Math.min(lowest, p.y - box.h);
				highest = Math.max(highest, p.y + box.h);
			}
		if (!isFinite(lowest)) continue;
		const low = clamp(Math.floor(lowest - margin), floor, floor + cap);
		const high = clamp(Math.ceil(highest + margin), top - cap, top);
		for (let k = 0; k < group; k++) columns.push({ x: x + k, low, high, spike: 0 });
	}
	// Not every column: some stretches stay open (a breath), the rest is built
	const open = (x: number) => {
		const phase = Math.floor((x - startX) / 10);
		return phase % 7 === 6;
	};
	for (const c of columns)
		if (open(c.x) && mode !== 'ball' && mode !== 'spider') ((c.low = floor), (c.high = top));

	// Spikes on the surfaces where there's room, in little rows
	const pickSpikes = () => {
		for (const c of columns) c.spike = 0;
		let run = 0;
		for (const c of columns) {
			const lowRoom = roomAbove(c);
			const highRoom = roomBelow(c);
			if (run > 0) {
				run--;
				const side = columns[columns.indexOf(c) - 1]?.spike ?? 0;
				if (side === 1 && lowRoom > 1.05) c.spike = 1;
				else if (side === -1 && highRoom > 1.05) c.spike = -1;
				continue;
			}
			if (rng() > (mode === 'ship' ? 0.14 : mode === 'spider' || mode === 'swing' ? 0.45 : 0.25))
				continue;
			const choices = shuffleByWeight(rng, [
				{ item: 1 as const, weight: lowRoom > 1.05 ? 1 : 0 },
				{ item: -1 as const, weight: highRoom > 1.05 ? 1 : 0 }
			]);
			if (!choices.length) continue;
			c.spike = choices[0];
			run = 1 + Math.floor(rng() * (mode === 'spider' ? 5 : 3));
		}
	};
	function roomAbove(c: Column) {
		let lowest = Infinity;
		for (const trace of runs)
			for (const p of trace)
				if (Math.abs(p.x - (c.x + 0.5)) < box.w + 0.25) lowest = Math.min(lowest, p.y - box.h);
		return lowest - c.low;
	}
	function roomBelow(c: Column) {
		let highest = -Infinity;
		for (const trace of runs)
			for (const p of trace)
				if (Math.abs(p.x - (c.x + 0.5)) < box.w + 0.25) highest = Math.max(highest, p.y + box.h);
		return c.high - highest;
	}
	pickSpikes();

	let made: { solids: Solid[]; spikes: ReturnType<typeof world.spike>[] } = {
		solids: [],
		spikes: []
	};
	const build = () => {
		for (const s of made.solids) world.solids.remove(s);
		for (const s of made.spikes) world.hazards.remove(s);
		world.solids.touch();
		made = { solids: [], spikes: [] };
		for (const side of ['low', 'high'] as const) {
			let run: { x0: number; height: number } | null = null;
			let lastX = -Infinity;
			const flush = (x1: number) => {
				if (!run) return;
				if (side === 'low' && run.height > floor)
					made.solids.push(
						world.solids.add({ x0: run.x0, x1, y0: floor, y1: run.height, style: 2 })
					);
				if (side === 'high' && run.height < top)
					made.solids.push(world.solids.add({ x0: run.x0, x1, y0: run.height, y1: top, style: 2 }));
				run = null;
			};
			for (const c of columns) {
				const height = c[side];
				if (!run || run.height !== height || c.x !== lastX + 1) {
					flush(lastX + 1);
					run = { x0: c.x, height };
				}
				lastX = c.x;
			}
			flush(lastX + 1);
		}
		for (const c of columns) {
			if (c.spike === 1 && c.low > floor - 1) made.spikes.push(world.spike(c.x + 0.5, c.low, 1));
			if (c.spike === -1) made.spikes.push(world.spike(c.x + 0.5, c.high, -1));
		}
	};
	build();

	// --- Checked: on time, early and late; where it crashes, more room -------------------------
	for (let attempt = 0; attempt < 40; attempt++) {
		let failed: PlayerState | null = null;
		if (!legalAround(world, startX - 1, endX + 1)) {
			// A spike broke a rule: the spikes go
			for (const c of columns) c.spike = 0;
			build();
		}
		for (const inputs of mode === 'ship' ? [] : variants) {
			const run = simulate(world, entry, section.end, inputs);
			if (run.dead) {
				failed = run;
				break;
			}
		}
		if (mode === 'ship') {
			const flown = flyShip(ctx, entry, section.end, (x) => {
				const c = columns.find((col) => col.x === Math.floor(x));
				if (!c) return clamp(entry.y, 2, top - 2);
				const low = c.low + (c.spike === 1 ? 1 : 0);
				const high = c.high - (c.spike === -1 ? 1 : 0);
				return (low + high) / 2;
			});
			events = flown.events;
			if (flown.end.dead) failed = flown.end;
		}
		if (!failed) break;
		const near = columns.filter((c) => Math.abs(c.x + 0.5 - failed!.x) < 3);
		if (!near.length) break;
		for (const c of near) {
			c.spike = 0;
			if (attempt > 25) {
				c.low = floor;
				c.high = top;
			} else if (failed.y - c.low < c.high - failed.y) c.low = Math.max(floor, c.low - 1);
			else c.high = Math.min(top, c.high + 1);
		}
		build();
	}
	plan.push(...events);
	used(ctx, mode);
	return simulate(world, entry, section.end, plan);
}
