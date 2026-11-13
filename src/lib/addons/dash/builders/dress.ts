// What hand-built levels have in their flying parts and ours didn't (measured, docs/dash.md §29):
// walls lined with spikes, and obstacles floating in the middle of the room, on the beat, that
// the way weaves around (a saw, a block with spikes on it), so the room isn't an empty tube.
//
// It's laid around the way that's already built and checked: the part is played as a person
// plays it (on time, all presses early and late, each a bit off on its own, each alone by the
// whole tolerance), and nothing comes near where any of those goes (with room to spare). Then
// it's all played again; whatever is in the way goes, and if it doesn't work out, nothing stays.

import { hash, jittered, random, type Context } from '../build';
import { musicalRest } from '../composition';
import {
	STEP,
	hitbox,
	simulate,
	type Hazard,
	type InputEvent,
	type PlayerState,
	type Section,
	type Solid,
	type World,
	wallAt
} from '../physics';

/** Columns of this width (blocks) */
const BIN = 0.25;

/** How much of each a part gets, by difficulty: the walls' spikes, the obstacles on the beats */
const LINING = [0, 0.4, 0.65, 0.8, 0.9];
const FLOATING = [0, 0.18, 0.32, 0.42, 0.5];

interface Way {
	from: PlayerState;
	inputs: InputEvent[];
	until: number;
}

/**
 * The ways a stretch is played: on time, all early, all late, each a bit off; and each press
 * alone early and late by the whole tolerance (played from just before it to a while after the
 * next one, the rest on time)
 */
function ways(
	world: World,
	entry: PlayerState,
	end: number,
	events: InputEvent[],
	tolerance: number,
	seed: number
): Way[] {
	const runs: Way[] = [events, ...jittered(events, tolerance * 0.75, seed, 6)].map((inputs) => ({
		from: entry,
		inputs,
		until: end
	}));
	let state = entry;
	events.forEach((e, k) => {
		if (!e.down) return;
		const release = events.findIndex((u, n) => n > k && !u.down);
		const after = events.find((u, n) => n > k && u.down);
		const until = Math.min(end, (after?.time ?? e.time + 800) + 450);
		state = simulate(world, state, Math.max(state.time, e.time - tolerance - 2 * STEP), events);
		if (state.dead) return;
		for (const shift of [-tolerance, tolerance])
			runs.push({
				from: state,
				inputs: events
					.map((u, n) => (n === k || n === release ? { ...u, time: u.time + shift } : u))
					.sort((p, q) => p.time - q.time),
				until
			});
	});
	return runs;
}

export function dressFlight(ctx: Context, sec: Section, entry: PlayerState) {
	const { world, preset, chart } = ctx;
	const level = preset.level;
	if (level < 1 || sec.ceil === null) return;
	const mode = sec.mode;
	if (mode === 'cube' || mode === 'robot' || mode === 'wave') return;
	const rng = random(hash(`dress:${ctx.seed ?? 0}:${sec.index}`));
	const intensity = sec.intensity ?? 0.5;
	const tolerance = preset.tolerance;
	const end = sec.end - STEP;
	const events = ctx.plan.filter((e) => e.time >= sec.start - 1 && e.time < sec.end);
	const box = hitbox(mode, sec.mini);
	const runs = ways(world, entry, end, events, tolerance, hash(`dress-ways:${sec.index}`));

	// --- Where the ways go -------------------------------------------------------------------
	const x0 = sec.x0;
	const bins = Math.ceil((sec.x1 - x0) / BIN) + 1;
	const reserved: [number, number][][] = Array.from({ length: bins }, () => []);
	// (room to spare: the ship, steered by holding, more; the ball and spider roll on surfaces)
	const spareY = mode === 'ship' ? 0.9 : mode === 'ball' || mode === 'spider' ? 0.5 : 0.55;
	const spareX = 0.6;
	/** The ways that get through as the builder left it: they must after this too */
	const alive: Way[] = [];
	for (const way of runs) {
		const trace: { x: number; y: number; time: number }[] = [];
		const run = simulate(world, way.from, way.until, way.inputs, { trace });
		// (the on-time way must get through as it is; the others as the builder left them)
		if (run.dead && way === runs[0]) return;
		if (run.dead) continue;
		alive.push(way);
		trace.forEach((p, n) => {
			// (the spider's jump to the other side: all of the way between)
			const before = trace[n - 1];
			const y0 = before && Math.abs(before.y - p.y) > 1 ? Math.min(before.y, p.y) : p.y;
			const y1 = before && Math.abs(before.y - p.y) > 1 ? Math.max(before.y, p.y) : p.y;
			const a = Math.max(0, Math.floor((p.x - box.w - spareX - x0) / BIN));
			const b = Math.min(bins - 1, Math.floor((p.x + box.w + spareX - x0) / BIN));
			for (let k = a; k <= b; k++) reserved[k].push([y0 - box.h - spareY, y1 + box.h + spareY]);
		});
	}
	// (each column's taken stretches, merged)
	const taken = reserved.map((list) => {
		list.sort((p, q) => p[0] - q[0]);
		const out: [number, number][] = [];
		for (const [a, b] of list) {
			const last = out[out.length - 1];
			if (last && a <= last[1]) last[1] = Math.max(last[1], b);
			else out.push([a, b]);
		}
		return out;
	});
	/** Where sloped walls (a corridor of slopes) leave room between some places: lowest top,
	 * highest bottom */
	const between = (rx0: number, rx1: number) => {
		let lo = -Infinity;
		let hi = Infinity;
		for (const w of world.walls.near(rx0, rx1))
			for (let x = Math.max(rx0, w.x0); x <= Math.min(rx1, w.x1) + 1e-6; x += 0.25) {
				const at = wallAt(w, x);
				lo = Math.max(lo, at.lo);
				hi = Math.min(hi, at.hi);
			}
		return { lo, hi };
	};
	const sloped = world.walls.near(sec.x0, sec.x1).length > 0;
	const binOf = (x: number) => Math.max(0, Math.min(bins - 1, Math.floor((x - x0) / BIN)));
	/** Whether a rectangle is clear of every way */
	const clear = (rx0: number, rx1: number, ry0: number, ry1: number) => {
		for (let k = binOf(rx0); k <= binOf(rx1 - 1e-6); k++)
			for (const [a, b] of taken[k]) if (a < ry1 && b > ry0) return false;
		return true;
	};
	/** Whether a rectangle is clear of the world's blocks and hazards (and orbs, portals) */
	const empty = (rx0: number, rx1: number, ry0: number, ry1: number, spare = 0.1) => {
		const room = between(rx0 - spare, rx1 + spare);
		if (ry0 - spare < room.lo || ry1 + spare > room.hi) return false;
		if (world.solidAt(rx0 - spare, rx1 + spare, ry0 - spare, ry1 + spare)) return false;
		for (const h of world.hazards.near(rx0 - 1, rx1 + 1)) {
			const hb =
				h.kind === 'saw'
					? { x0: h.x - h.size, x1: h.x + h.size, y0: h.y - h.size, y1: h.y + h.size }
					: {
							x0: h.x - 0.5,
							x1: h.x + 0.5,
							y0: h.dir === 1 ? h.y : h.y - 1,
							y1: h.dir === 1 ? h.y + 1 : h.y
						};
			if (hb.x0 < rx1 + spare && hb.x1 > rx0 - spare && hb.y0 < ry1 + spare && hb.y1 > ry0 - spare)
				return false;
		}
		for (const o of world.orbs.near(rx0 - 1.2, rx1 + 1.2))
			if (o.y > ry0 - 1.5 && o.y < ry1 + 1.5) return false;
		if (world.gravityPortals.near(rx0 - 1.5, rx1 + 1.5).length) return false;
		if (world.pads.near(rx0 - 1, rx1 + 1).length) return false;
		return true;
	};
	const floor = sec.floor;
	const top = sec.ceil;
	const from = sec.x0 + 1.5;
	const to = sec.x1 - 1.5;
	if (to - from < 3) return;

	const added: { hazards: Hazard[]; solids: Solid[] } = { hazards: [], solids: [] };
	const legalSpike = (x: number, y: number, dir: 1 | -1) => {
		for (const o of world.hazards.near(x - 1, x + 1)) {
			if (o.kind === 'saw') continue;
			if (Math.abs(o.x - x) < 0.9 && Math.abs(o.y - y) < 0.9 && o.dir === dir) return false;
			if (o.dir !== dir && Math.abs(o.x - x) < 0.9 && Math.abs(o.y - y) < 1.8) return false;
		}
		return true;
	};
	const spike = (x: number, y: number, dir: 1 | -1, kind: 'spike' | 'small') => {
		const h = world.spike(x, y, dir, kind);
		added.hazards.push(h);
		return h;
	};

	// --- The walls: spikes on the surfaces the room faces, where no way comes ----------------
	// (a corridor of slopes is deadly to touch already: no spikes on it)
	const lining = sloped ? 0 : LINING[level] * (0.75 + intensity * 0.35);
	if (lining > 0) {
		/** The surfaces facing into the room, block by block: tops of floor blocks, undersides of
		 * ceiling blocks, and the floor and ceiling themselves */
		for (let cx = Math.ceil(from) + 0.5; cx < to; cx += 1) {
			if (musicalRest(chart, world.timeAt(cx))) continue;
			for (const dir of [1, -1] as const) {
				if (rng() > lining) continue;
				// (the surface: the highest block top under the room's middle, or the lowest underside)
				let y = dir === 1 ? floor : top;
				for (const s of world.solids.near(cx - 0.5, cx + 0.5)) {
					if (s.x0 > cx - 0.5 + 1e-6 || s.x1 < cx + 0.5 - 1e-6) continue;
					if (dir === 1 && s.y1 > y && s.y1 < (floor + top) / 2 + 1) y = s.y1;
					if (dir === -1 && s.y0 < y && s.y0 > (floor + top) / 2 - 1) y = s.y0;
				}
				if (!world.surfaceAt(cx - 0.45, cx + 0.45, y, dir)) continue;
				for (const kind of ['spike', 'small'] as const) {
					const h = kind === 'spike' ? 1 : 0.5;
					const [y0, y1] = dir === 1 ? [y, y + h] : [y - h, y];
					if (!clear(cx - 0.5, cx + 0.5, y0, y1)) continue;
					if (!empty(cx - 0.45, cx + 0.45, y0 + 0.02, y1, 0)) continue;
					if (!legalSpike(cx, y, dir)) continue;
					spike(cx, y, dir, kind);
					break;
				}
			}
		}
	}

	// --- In the room: on the beats, a saw or a block with spikes, beside the way ------------
	const floating = FLOATING[level] * (0.6 + intensity * 0.7);
	const { point } = (() => {
		let p = chart.timing[0];
		for (const t of chart.timing) if (t.time <= sec.start + 1) p = t;
		return { point: p };
	})();
	const beat = point.beatLength;
	let last = -Infinity;
	for (
		let t = point.time + Math.ceil((sec.start + 250 - point.time) / beat) * beat;
		t < sec.end - 250;
		t += beat
	) {
		const cx = world.xAt(t);
		if (cx < from || cx > to || cx - last < 2.5) continue;
		if (musicalRest(chart, t) || rng() > floating) continue;
		// What can go: a saw (small or big), a block with a spike on the side the way passes
		const kinds: ('saw' | 'block')[] = rng() < 0.5 ? ['saw', 'block'] : ['block', 'saw'];
		let placed = false;
		for (const kind of kinds) {
			if (placed) break;
			if (kind === 'saw') {
				for (const r of [1, 0.75, 0.55]) {
					// (the column's free stretches, nearest the way first)
					const spots = freeSpots(cx - r, cx + r, 2 * r);
					for (const s of spots) {
						const y = s.below ? s.hi - r - 0.05 : s.lo + r + 0.05;
						if (!empty(cx - r, cx + r, y - r, y + r, 0.15)) continue;
						const saw = world.saw(cx, y, r);
						added.hazards.push(saw);
						placed = true;
						break;
					}
					if (placed) break;
				}
			} else {
				const w = rng() < 0.6 ? 1 : 2;
				const bx0 = Math.round(cx - w / 2);
				const bx1 = bx0 + w;
				const spots = freeSpots(bx0, bx1, 1);
				for (const s of spots) {
					// (the block on the far side, its spike toward the way, if there's room for one)
					const room = s.hi - s.lo;
					const y0 = s.below ? Math.floor(s.hi - 1) : Math.ceil(s.lo);
					if (y0 < s.lo - 1e-6 || y0 + 1 > s.hi + 1e-6) continue;
					if (y0 <= floor + 0.5 || y0 + 1 >= top - 0.5) continue;
					if (!empty(bx0, bx1, y0, y0 + 1, 0.1)) continue;
					const solid: Solid = { x0: bx0, x1: bx1, y0, y1: y0 + 1, style: 1 };
					world.solids.add(solid);
					added.solids.push(solid);
					// (a spike on its side toward the way: below it when it's above the way)
					const dir: 1 | -1 = s.below ? -1 : 1;
					const sy = dir === 1 ? y0 + 1 : y0;
					for (let x = bx0 + 0.5; x < bx1; x += 1)
						for (const k of ['spike', 'small'] as const) {
							const h = k === 'spike' ? 1 : 0.5;
							const [a, b] = dir === 1 ? [sy, sy + h] : [sy - h, sy];
							if (room < 1 + h || !clear(x - 0.5, x + 0.5, a, b) || !legalSpike(x, sy, dir))
								continue;
							if (!empty(x - 0.45, x + 0.45, a + 0.02, b, 0)) continue;
							spike(x, sy, dir, k);
							break;
						}
					placed = true;
					break;
				}
			}
		}
		if (placed) last = cx;
	}

	/**
	 * The stretches of a column (from x0 to x1) where nothing is and no way goes, at least `size`
	 * high; `below` when it's under the way (then the obstacle goes at its top, near the way)
	 */
	function freeSpots(fx0: number, fx1: number, size: number) {
		const blocked: [number, number][] = [];
		for (let k = binOf(fx0); k <= binOf(fx1 - 1e-6); k++) blocked.push(...taken[k]);
		for (const s of world.solids.near(fx0, fx1))
			if (s.x0 < fx1 && s.x1 > fx0) blocked.push([s.y0, s.y1]);
		for (const h of world.hazards.near(fx0 - 1, fx1 + 1)) {
			if (h.x1 < fx0 || h.x0 > fx1) continue;
			if (h.kind === 'saw') blocked.push([h.y - h.size, h.y + h.size]);
			else blocked.push(h.dir === 1 ? [h.y, h.y + 1] : [h.y - 1, h.y]);
		}
		const room = between(fx0, fx1);
		if (isFinite(room.lo)) blocked.push([floor - 100, room.lo]);
		if (isFinite(room.hi)) blocked.push([room.hi, top + 100]);
		blocked.sort((p, q) => p[0] - q[0]);
		const way = taken[binOf((fx0 + fx1) / 2)];
		const spots: { lo: number; hi: number; below: boolean; gap: number }[] = [];
		let at = floor + 0.5;
		for (const [a, b] of [...blocked, [top - 0.5, top + 100] as [number, number]]) {
			if (a - at >= size + 0.2) {
				// (is the way above it or below it, and how far)
				const above = way.find(([p]) => p >= a - 1e-6);
				const under = [...way].reverse().find(([, q]) => q <= at + 1e-6);
				const gapAbove = above ? above[0] - a : Infinity;
				const gapUnder = under ? at - under[1] : Infinity;
				const below = gapAbove <= gapUnder;
				const gap = Math.min(gapAbove, gapUnder);
				if (gap < 0.6) spots.push({ lo: at, hi: a, below, gap });
			}
			at = Math.max(at, b);
		}
		return spots.sort((p, q) => p.gap - q.gap);
	}

	if (!added.hazards.length && !added.solids.length) return;

	// --- Played again: whatever is in the way goes ------------------------------------------
	const remove = (near: number) => {
		const hz = added.hazards.filter((h) => Math.abs(h.x - near) < 2.5);
		const sd = added.solids.filter((s) => s.x0 < near + 2.5 && s.x1 > near - 2.5);
		if (!hz.length && !sd.length) return false;
		const hs = new Set<object>(hz);
		const ss = new Set<object>(sd);
		world.hazards.removeIf((h) => hs.has(h));
		world.solids.removeIf((s) => ss.has(s));
		// (a spike that stood on a removed block goes with it)
		const loose = added.hazards.filter(
			(h) => h.kind !== 'saw' && !world.surfaceAt(h.x - 0.45, h.x + 0.45, h.y, h.dir)
		);
		const ls = new Set<object>(loose);
		world.hazards.removeIf((h) => ls.has(h));
		added.hazards = added.hazards.filter((h) => !hs.has(h) && !ls.has(h));
		added.solids = added.solids.filter((s) => !ss.has(s));
		return true;
	};
	for (let round = 0; round < 24; round++) {
		let dead: PlayerState | null = null;
		for (const way of alive) {
			const run = simulate(world, way.from, way.until, way.inputs);
			if (run.dead) {
				dead = run;
				break;
			}
		}
		if (!dead) return;
		if (!remove(dead.x)) break;
	}
	// (it didn't work out: none of it)
	const hs = new Set<object>(added.hazards);
	const ss = new Set<object>(added.solids);
	world.hazards.removeIf((h) => hs.has(h));
	world.solids.removeIf((s) => ss.has(s));
}
