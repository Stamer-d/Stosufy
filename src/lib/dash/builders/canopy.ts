// What's built over a cube's or robot's way: ceilings, overhangs and hanging spikes above its
// jumps, phrase by phrase (a jump is always as high: a block of room over it is enough). A part made of ground, blocks and spikes alone runs through open
// sky; made levels are places with something over the way too. It only goes where no way that's
// played comes near (the planned one a block or more around, and room above for a jump made
// early, late or held longer), so the part plays as it was built.

import type { DashChart } from '../chart';
import { hash, random } from '../build';
import { musicalPosition, musicalRest } from '../composition';
import { STEP, hitbox, press, startState, step, type InputEvent, type World } from '../physics';

/** How far over the played way it stays (blocks): the cube's jumps, the robot's held longer */
const ROOM = { cube: 1, robot: 2 };
/** How high over the ground a ceiling still is one (above that it's out of sight) */
const HIGHEST = 8.5;

type Style = 'open' | 'ceiling' | 'teeth' | 'islands';

export function buildCanopy(
	world: World,
	plan: InputEvent[],
	chart: DashChart,
	start: number,
	end: number,
	seed: string,
	level: number,
	/** How much a press may be off on this difficulty (ms) */
	tolerance: number
) {
	// The planned way: per block column the highest the player gets, and where it's upside down
	const top = new Map<number, number>();
	const upside = new Set<number>();
	const s = startState(world, start);
	let k = 0;
	while (s.time + STEP <= end && !s.dead) {
		const next = s.time + STEP;
		while (k < plan.length && plan[k].time <= next) press(s, plan[k++].down);
		step(world, s, next);
		if (s.mode !== 'cube' && s.mode !== 'robot') continue;
		const column = Math.floor(s.x);
		const high = s.y + hitbox(s.mode, s.mini).h;
		if (high > (top.get(column) ?? -Infinity)) top.set(column, high);
		if (s.gravity < 0) upside.add(column);
	}
	if (s.dead) return;

	const added: { solids: object[]; hazards: object[]; x0: number; x1: number }[] = [];
	for (const sec of world.sections) {
		if (sec.mode !== 'cube' && sec.mode !== 'robot') continue;
		const rng = random(hash(`${seed}:canopy:${sec.index}`));
		const room = ROOM[sec.mode];
		const from = Math.ceil(sec.x0 + 3);
		const to = Math.floor(sec.x1 - 3);
		if (to - from < 8) continue;
		// How high the way gets around each column (a jump made early or late is the same one a
		// bit further left or right)
		const reach = (c: number) => {
			let most = -Infinity;
			for (let d = -2; d <= 2; d++) most = Math.max(most, top.get(c + d) ?? -Infinity);
			return most;
		};
		const free = (c: number) => {
			for (let d = -5; d <= 5; d++) if (upside.has(c + d)) return false;
			if (!isFinite(reach(c))) return false;
			// (nothing there already over the way: a slab it runs under, an orb, a portal)
			const over = reach(c) - 0.3;
			if (
				world.solids
					.near(c - 1, c + 2)
					.some((o) => o.y1 > over + 0.3 && o.x1 > c - 1 && o.x0 < c + 2)
			)
				return false;
			if (world.orbs.near(c - 1, c + 2).some((o) => o.y > over)) return false;
			if (world.gravityPortals.near(c - 3, c + 4).length) return false;
			if (world.pads.near(c - 2, c + 3).some((p) => p.kind === 'blue')) return false;
			return true;
		};
		// Phrase by phrase (two bars), each its own kind; the same again where it was liked
		let c = from;
		let last: Style = 'open';
		const group = { solids: [] as object[], hazards: [] as object[], x0: sec.x0, x1: sec.x1 };
		while (c < to) {
			const time = world.timeAt(c + 0.5);
			const phrase = musicalPosition(chart, time);
			const until = Math.min(to, Math.floor(world.xAt(Math.min(phrase.end, sec.end))));
			const stop = Math.max(c + 1, until);
			const roll = rng();
			const calm = (sec.intensity ?? 0.5) < 0.4;
			let style: Style =
				roll < (calm ? 0.4 : 0.25)
					? 'open'
					: roll < 0.62
						? 'ceiling'
						: roll < 0.78
							? 'islands'
							: 'teeth';
			if (style === 'teeth' && level < 1) style = 'ceiling';
			if (style === 'open' && last === 'open') style = 'islands';
			last = style;
			if (style !== 'open' && stop - c >= 4) lay(style, c, stop);
			c = stop;
		}
		if (group.solids.length) added.push(group);

		function lay(style: Style, a: number, b: number) {
			// In runs of a few columns, each as low as its way allows (whole blocks)
			const run = style === 'islands' ? 3 : 4;
			const gap = style === 'islands' ? 3 : 0;
			// (one height through the phrase, unless that's far over a run)
			let flat = -Infinity;
			for (let x = a; x < b; x++) if (free(x)) flat = Math.max(flat, reach(x));
			for (let x = a; x + run <= b; x += run + gap) {
				let ok = true;
				let most = -Infinity;
				for (let i = x; i < x + run; i++) {
					if (!free(i)) ok = false;
					most = Math.max(most, reach(i));
				}
				if (!ok) continue;
				// (a flat ceiling at the phrase's highest, unless that's far over this run)
				const over = Math.max(most, flat - 2);
				const y0 = Math.ceil(sec.floor + (over - sec.floor) + room - 1e-6);
				if (y0 - sec.floor > HIGHEST) continue;
				const thick = style === 'islands' ? 1 : 3;
				const solid = { x0: x, x1: x + run, y0, y1: y0 + thick, style: 0 };
				world.solids.add(solid);
				group.solids.push(solid);
				if (style === 'teeth' || (style === 'islands' && level >= 2 && rng() < 0.5)) {
					// Spikes under it, where the way stays a block and more below their tips
					for (let i = x; i < x + run; i++) {
						if (y0 - 1 - reach(i) < 0.6) continue;
						// (where the music rests nothing threatens)
						if (musicalRest(chart, world.timeAt(i + 0.5))) continue;
						if (style === 'teeth' && (i - a) % 4 >= 2) continue;
						group.hazards.push(world.spike(i + 0.5, y0, -1));
					}
				}
			}
		}
	}
	world.solids.touch();
	world.hazards.touch();
	if (!added.length) return;

	// Played once more: on time, and every press a bit early and a bit late. Where that's
	// stopped in a part, what was built over that part goes again
	const off = Math.round(tolerance * 0.75);
	const ways = [0, -off, off].map((shift) =>
		shift ? plan.map((e) => ({ ...e, time: e.time + shift })) : plan
	);
	for (let guard = 0; guard < added.length + 1; guard++) {
		let stoppedAt: number | null = null;
		for (const inputs of ways) {
			const run = startState(world, start);
			let i = 0;
			while (run.time + STEP <= end && !run.dead) {
				const next = run.time + STEP;
				while (i < inputs.length && inputs[i].time <= next) press(run, inputs[i++].down);
				step(world, run, next);
			}
			// (the shifted ways may crash where the part's own obstacles are tighter than that: only
			// what's built here counts, so the on-time way decides, and a shifted one only inside
			// what was added)
			if (run.dead && (inputs === plan || nearAdded(run.x))) {
				stoppedAt = run.x;
				break;
			}
		}
		if (stoppedAt === null) break;
		const at = stoppedAt;
		const group = added.find((g) => at >= g.x0 - 2 && at <= g.x1 + 2) ?? added[added.length - 1];
		const solids = new Set(group.solids);
		const hazards = new Set(group.hazards);
		world.solids.removeIf((o) => solids.has(o));
		world.hazards.removeIf((h) => hazards.has(h));
		added.splice(added.indexOf(group), 1);
		if (!added.length) break;
	}

	function nearAdded(x: number) {
		return added.some((g) =>
			(g.solids as { x0: number; x1: number }[]).some((o) => x > o.x0 - 1.5 && x < o.x1 + 1.5)
		);
	}
}
