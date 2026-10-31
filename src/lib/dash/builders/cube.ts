// The cube parts: a library of the genre's building blocks (spikes, stairs, blocks to hop
// onto, gaps over spike pits, pads up, an orb over a pit, low ceilings), picked for each click
// by what fits the time to the next one, how high the level is and what was used lately.
// Everything stands on the grid; every pick is played early and late before it stays, and a
// click whose obstacle could be passed without it is no click.

import { cubeAt, simulate, STEP, type PlayerState, type Section, type Solid } from '../physics';
import {
	legalAround,
	Attempt,
	clickChecks,
	freshness,
	half,
	passes,
	shuffleByWeight,
	survivesWithout,
	tap,
	used,
	type Check,
	type Context
} from '../build';

interface Pattern {
	id: string;
	weight: number;
	/** Builds it; false when it doesn't fit */
	build: (a: Attempt) => boolean;
	/** Uses the next click too (an orb) */
	pair?: boolean;
	/** No press (a pad does it) */
	noPress?: boolean;
}

export function buildCube(ctx: Context, section: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, rng, preset } = ctx;
	const speed = section.speed;
	const tolerance = preset.tolerance;
	const cube = cubeAt(section.speedIndex);
	const air = (2 * cube.jump) / cube.gravity;
	const noteTimes = ctx.chart.notes.map((n) => n.time);
	let state = entry;
	/** The structure the cube runs on (none: the ground) */
	let platform: Solid | null = null;
	let level = 0;
	let recent: Check[] = [];
	let chain = 0;
	const limit = section.x1 - 2;
	const times = clicks.filter((t) => t > section.start + 350 && t < section.end - 400);
	// How high the level wants to be: higher where the music is busier
	const busy = (t: number) => noteTimes.filter((n) => n > t - 2000 && n < t + 2000).length / 4;

	const extend = (until: number) => {
		if (platform) {
			platform.x1 = Math.max(platform.x1, world.xAt(until) + 30);
			world.solids.touch();
		}
	};

	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		const next = times[i + 1] ?? section.end - 250;
		const after = times[i + 2] ?? section.end - 250;
		extend(after);
		const before = state;
		state = simulate(world, before, time - tolerance - STEP * 3, plan);
		// Something before stops it (a click that found nothing to do): what's in the way goes
		for (let k = 0; k < 8 && state.dead; k++) {
			const dead = state;
			world.hazards.removeIf((h) => h.x1 > dead.x - 1.8 && h.x0 < dead.x + 1.3);
			world.hazards.removeIf(
				(h) => h.x1 > dead.x - 4 && h.x0 < dead.x + 4 && !legalAround(world, h.x0, h.x1)
			);
			state = simulate(world, before, time - tolerance - STEP * 3, plan);
		}
		if (state.dead) break;
		const at = simulate(world, state, time, []);
		const x = at.x;
		const grounded = at.grounded && at.gravity > 0;
		if (grounded) level = Math.round(at.y - 0.5);
		chain = grounded ? 0 : chain + 1;
		if (!grounded && chain > preset.chain) continue;
		const room = (next - time) / 1000;
		// Checked until the next click, and at least until it has landed again
		const until = Math.max(next - 2, time + air * 1000 + 150);
		const target = Math.min(preset.height, Math.round(busy(time) * 0.6 + (section.kiai ? 1 : 0)));
		const patterns: Pattern[] = [];
		const add = (p: Pattern) => patterns.push({ ...p, weight: p.weight * freshness(ctx, p.id) });
		const land = x + speed * air;
		const middle = x + (speed * air) / 2;

		if (grounded) {
			// Spikes on the surface, under the jump
			for (let count = 1; count <= preset.spikes; count++) {
				if (count === 3 && section.speedIndex > 1) continue;
				const center = count % 2 ? Math.floor(middle) + 0.5 : Math.round(middle);
				for (const shift of [0, count === 1 ? 1 : -1, count === 1 ? -1 : 1]) {
					add({
						id: `spikes${count}`,
						weight: [0, 1, 1.1, 0.7][count] * (shift ? 0.3 : 1),
						build: (a) => {
							const small = count === 1 && rng() < 0.25;
							for (let k = 0; k < count; k++)
								a.spike(center + shift + k - (count - 1) / 2, level, 1, small ? 'small' : 'spike');
							return true;
						}
					});
				}
			}
			// A step up (stairs, over clicks)
			if (level < preset.height && room > 0.36) {
				for (const nudge of [0, 0.5]) {
					add({
						id: 'stairs',
						weight: (level < target ? 1.6 : 0.6) * (nudge ? 0.4 : 1),
						build: (a) => stepUp(a, half(x + speed * (0.05 + tolerance / 1000) + 0.3) + nudge, 60)
					});
				}
			}
			// A block to hop onto and drop off again
			if (level < preset.height && room > air + 0.25) {
				const length = 2 + Math.floor(rng() * 3);
				add({
					id: 'hop',
					weight: 1.1,
					build: (a) => {
						const edge = half(x + speed * (0.05 + tolerance / 1000) + 0.3);
						const end = Math.max(edge + length, half(land + 0.5));
						if (world.xAt(next) < end + speed * 0.12) return false;
						return stepUp(a, edge, end - edge, true);
					}
				});
			}
			// A gap over a spike pit (to the same height, or down)
			if (platform && level >= 1 && room > air * 0.9) {
				for (const down of level >= 2 ? [0, 1, 2] : [0, 1]) {
					add({
						id: `gap${down}`,
						weight: (level > target ? 1.4 : 0.9) * (down === 2 ? 0.6 : 1),
						build: (a) => gap(a, x, down)
					});
				}
			}
			// A pad up onto a higher structure, or over a long pit
			if (room > 0.65 && level + 2 <= preset.height && preset.level >= 1) {
				add({ id: 'padUp', weight: 0.55, noPress: true, build: (a) => padUp(a, x) });
			}
			if (room > 0.7) {
				add({ id: 'padOver', weight: 0.4, noPress: true, build: (a) => padOver(a, x) });
			}
			// Jump, then an orb on the next note over a pit
			const second = times[i + 1];
			if (second !== undefined && preset.chain > 0) {
				const gapS = (second - time) / 1000;
				if (gapS > 0.16 && gapS < air - 0.05) {
					add({
						id: 'orbPit',
						weight: 1.7,
						pair: true,
						build: (a) => orbPit(a, x, time, second, times[i + 2] ?? section.end)
					});
				}
			}
		} else {
			// In the air: an orb, and spikes where it would land without it
			add({ id: 'orb', weight: 1, build: (a) => airOrb(a, at) });
		}

		const ordered = shuffleByWeight(
			rng,
			patterns.map((p) => ({ item: p, weight: p.weight }))
		);
		let done: Pattern | null = null;
		for (const pattern of ordered) {
			const attempt = new Attempt(world, limit);
			if (!pattern.build(attempt)) {
				attempt.revert();
				continue;
			}
			if (!attempt.legal()) {
				attempt.revert();
				continue;
			}
			const second = times[i + 1];
			let checks: Check[];
			if (pattern.noPress) {
				const from = simulate(world, state, time - tolerance - STEP * 2, []);
				checks = [{ from, inputs: [], until }];
			} else if (pattern.pair && second !== undefined) {
				const third = times[i + 2] ?? section.end - 250;
				checks = [
					...clickChecks(world, state, time, third - 2, tolerance, tap(second)),
					...clickChecks(world, state, second, third - 2, tolerance, tap(time)).map((c) => ({
						...c,
						from: simulate(world, state, second - tolerance - STEP * 2, tap(time))
					}))
				];
			} else checks = clickChecks(world, state, time, until, tolerance);
			const ok = [...checks, ...recent].every((c) => passes(world, c));
			// Every press needed: without it, it must not get through
			let needed = true;
			if (!pattern.noPress) {
				const end = Math.max(pattern.pair ? (times[i + 2] ?? section.end) - 2 : until, time + 900);
				needed = !survivesWithout(world, checks[0].from, end);
				if (needed && pattern.pair) needed = simulate(world, checks[0].from, end, tap(time)).dead;
			}
			if (ok && needed) {
				if (!pattern.noPress) plan.push(...tap(time));
				if (pattern.pair && second !== undefined) {
					plan.push(...tap(second));
					i++;
				}
				recent = checks;
				used(ctx, pattern.id);
				done = pattern;
				break;
			}
			attempt.revert();
		}
		if (!done) continue;
		// A long run after it: down to the ground, or a low ceiling over it
		runway(time, done.pair ? (times[i + 1] ?? section.end - 250) : next);
	}
	if (platform) {
		(platform as Solid).x1 = Math.max((platform as Solid).x0 + 1, Math.floor(section.x1 - 1));
		world.solids.touch();
	}
	return simulate(world, state, section.end, plan);

	// --- The patterns ------------------------------------------------------------------------

	/** A structure one higher from `edge` on (a block to hop onto ends after `length`) */
	function stepUp(a: Attempt, edge: number, length: number, hop = false) {
		const old = platform;
		const oldEnd = old?.x1 ?? 0;
		const solid = a.solid({ x0: edge, x1: edge + length, y0: 0, y1: level + 1, style: 0 });
		if (old)
			a.change(
				() => (old.x1 = Math.max(old.x0 + 0.5, edge)),
				() => (old.x1 = oldEnd)
			);
		if (hop) {
			// The structure below goes on after the block
			if (old) {
				const rest = a.solid({
					x0: edge + length,
					x1: edge + length + 60,
					y0: 0,
					y1: level,
					style: 0
				});
				const before = platform;
				a.change(
					() => (platform = rest),
					() => (platform = before)
				);
			} else {
				const before = platform;
				a.change(
					() => (platform = null),
					() => (platform = before)
				);
			}
		} else {
			const before = platform;
			a.change(
				() => (platform = solid),
				() => (platform = before)
			);
		}
		return true;
	}

	function gap(a: Attempt, x: number, down: number) {
		const targetLevel = level - down;
		const fall = (cube.jump + Math.sqrt(cube.jump ** 2 + 2 * cube.gravity * down)) / cube.gravity;
		const edge = half(x + speed * (tolerance / 1000) - 0.2);
		const resume = half(x + speed * (fall - tolerance / 1000) + 0.15);
		if (resume - edge < 1.5) return false;
		const old = platform!;
		const oldEnd = old.x1;
		a.change(
			() => (old.x1 = edge),
			() => (old.x1 = oldEnd)
		);
		const before = platform;
		if (targetLevel > 0) {
			const solid = a.solid({ x0: resume, x1: resume + 60, y0: 0, y1: targetLevel, style: 0 });
			a.change(
				() => (platform = solid),
				() => (platform = before)
			);
			a.spikes(Math.ceil(edge), Math.floor(resume), 0, 1, 'small');
		} else {
			a.change(
				() => (platform = null),
				() => (platform = before)
			);
			a.spikes(Math.ceil(edge), Math.floor(resume - speed * 0.12), 0, 1);
		}
		return true;
	}

	function padUp(a: Attempt, x: number) {
		const padX = Math.floor(x + 0.85) + 0.5;
		a.pad('yellow', padX, level);
		const height = level + 2 + (level + 3 <= preset.height && rng() < 0.4 ? 1 : 0);
		const edge = half(padX + speed * 0.22 + 0.5);
		const old = platform;
		const oldEnd = old?.x1 ?? 0;
		if (old)
			a.change(
				() => (old.x1 = Math.max(old.x0 + 0.5, padX + 1)),
				() => (old.x1 = oldEnd)
			);
		// A pit between the pad and the structure
		const solid = a.solid({ x0: edge, x1: edge + 60, y0: 0, y1: height, style: 0 });
		if (old) a.spikes(Math.ceil(padX + 1), Math.floor(edge), 0, 1, 'small');
		else a.spikes(Math.ceil(padX + 1), Math.floor(edge), 0, 1);
		const before = platform;
		a.change(
			() => (platform = solid),
			() => (platform = before)
		);
		return true;
	}

	function padOver(a: Attempt, x: number) {
		const padX = Math.floor(x + 0.85) + 0.5;
		a.pad('yellow', padX, level);
		const pad = PHYSICS_PAD / cube.gravity;
		const mid = padX + speed * pad;
		const count = 3 + Math.floor(rng() * 2);
		a.spikes(Math.round(mid - count / 2), Math.round(mid - count / 2) + count, level);
		return true;
	}

	function orbPit(a: Attempt, x: number, first: number, second: number, third: number) {
		const flight = simulate(world, state, second, tap(first));
		if (flight.dead || flight.grounded) return false;
		const kind = rng() < 0.25 && preset.level >= 2 ? 'red' : 'yellow';
		const orbX = flight.x + speed * 0.01;
		a.orb(kind, half(orbX), Math.round(flight.y * 2) / 2);
		// Where it lands with the orb
		const landing = simulate(
			world,
			state,
			third - 1,
			[...tap(first), ...tap(second)].sort((p, q) => p.time - q.time)
		);
		const end = landing.grounded ? landing.x - speed * 0.12 : flight.x + 3;
		const from = Math.ceil(x + 1);
		const to = Math.floor(end);
		if (to - from < 2) return false;
		if (platform && level >= 1) {
			const old = platform;
			const oldEnd = old.x1;
			a.change(
				() => (old.x1 = from),
				() => (old.x1 = oldEnd)
			);
			const rest = a.solid({ x0: to, x1: to + 60, y0: 0, y1: level, style: 0 });
			const before = platform;
			a.change(
				() => (platform = rest),
				() => (platform = before)
			);
			a.spikes(from, to, 0, 1, 'small');
		} else a.spikes(from, Math.min(to, from + 6), level);
		return true;
	}

	function airOrb(a: Attempt, at: PlayerState) {
		const kind = at.y - 0.5 - level > 2.6 ? 'pink' : 'yellow';
		a.orb(kind, half(at.x + speed * 0.01), Math.round(at.y * 2) / 2);
		const fall = simulate(world, at, at.time + 1200, []);
		if (!fall.grounded) return false;
		const ground = Math.round(fall.y - 0.5);
		const c = Math.floor(fall.x) + 0.5;
		a.spike(c, ground);
		a.spike(c + 1, ground);
		return true;
	}

	/** After a click with time to spare: down again, or a low ceiling to stay under */
	function runway(time: number, next: number) {
		const landed = simulate(world, state, Math.min(next - 60, time + air * 1000 + 120), plan);
		if (!landed.grounded || landed.dead) return;
		const runFrom = landed.x;
		const runTo = world.xAt(next) - speed * (tolerance / 1000) - 1;
		if (runTo - runFrom < 3) return;
		const choice = rng();
		if (platform && level >= 1 && choice < 0.45) {
			// Off the edge, down to the ground (or one lower)
			const old = platform;
			const end = old.x1;
			const edge = half(runFrom + 1);
			const attempt = new Attempt(world, limit);
			attempt.change(
				() => (old.x1 = edge),
				() => (old.x1 = end)
			);
			const lower = level >= 2 && rng() < 0.5 ? level - 1 : 0;
			let rest: Solid | null = null;
			if (lower > 0) rest = attempt.solid({ x0: edge, x1: edge + 60, y0: 0, y1: lower, style: 0 });
			const check = { from: landed, inputs: [], until: next - 2 };
			if (attempt.legal() && passes(world, check) && recent.every((c) => passes(world, c))) {
				platform = rest;
				level = lower;
			} else attempt.revert();
		} else if (choice < 0.8 && preset.level >= 1) {
			// A low ceiling with spikes under it: no jumping here (and no note to jump to)
			const x0 = Math.ceil(runFrom + 1);
			const x1 = Math.floor(runTo);
			if (x1 - x0 < 2) return;
			const t0 = world.timeAt(x0 - 1.5);
			const t1 = world.timeAt(x1 + 1);
			if (noteTimes.some((t) => t > t0 && t < t1)) return;
			const attempt = new Attempt(world, limit);
			attempt.solid({ x0, x1, y0: level + 3, y1: level + 4, style: 1 });
			for (let sx = x0 + 0.5; sx < x1; sx += 1) if (rng() < 0.75) attempt.spike(sx, level + 3, -1);
			const check = { from: landed, inputs: [], until: next - 2 };
			if (attempt.legal() && passes(world, check) && recent.every((c) => passes(world, c)))
				used(ctx, 'ceiling');
			else attempt.revert();
		}
	}
}

/** A yellow pad's push (blocks/s) */
const PHYSICS_PAD = 864 / 30;
