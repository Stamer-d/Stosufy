// The wave parts: a corridor of slopes the wave zigzags through, turning on the notes. The
// turns are on the grid of half blocks (a few ms off the note at most), so the slopes meet at
// clean corners; the corridor is sometimes even on both sides, sometimes flat above or below
// the zigzag, wider where it goes straight and narrow in quick runs.

import {
	hitbox,
	press,
	simulate,
	step,
	STEP,
	type InputEvent,
	type PlayerState,
	type Section,
	type Walls
} from '../physics';
import { clamp, gravityIn, half, used, type Context } from '../build';
import type { DashNote } from '../chart';
import { musicalPosition, musicalRest } from '../composition';
import { hash } from '../build';

export function buildWave(ctx: Context, section: Section, notes: DashNote[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const top = section.ceil!;
	const floor = section.floor;
	const slope = section.mini ? 2 : 1;
	const box = hitbox('wave', section.mini);
	// The small wave is steeper already (twice as far up or down for a moment late): a bit
	// wider, and fewer turns
	// (and the faster, the wider: the same mistake is further off there)
	const fast = 1 + Math.max(0, section.speedIndex - 1) * 0.1;
	const width = preset.wave * (section.mini ? 1.55 : 1) * fast;
	const gap = preset.waveGap * (section.mini ? 2.2 : 1) * (section.speedIndex >= 3 ? 1.15 : 1);

	// The turns: notes far enough apart, put on the grid
	const turns: number[] = [];
	for (const note of notes) {
		if (
			note.time < section.start + 200 ||
			note.time > section.end - 300 ||
			musicalRest(ctx.chart, note.time)
		)
			continue;
		const x = half(world.xAt(note.time));
		const last = turns[turns.length - 1];
		if (last !== undefined && (x - last) / section.speed < gap) continue;
		if (last !== undefined && x - last < 0.5) continue;
		turns.push(x);
	}

	// The way: 45° (63° small) up or down, inside a band that keeps off the floor and ceiling
	// (they're safe to slide on: a corridor side there would be no wall at all). The band rises
	// and falls over four bars, so the corridor climbs and dives. A turn on every note; where
	// the way to the next one is longer than the band is high, it turns on the beat (the
	// quarter beats) on the way, at the band's edge.
	const low = floor + box.h;
	const high = top - box.h;
	// (and a band high enough that it needn't turn at its edges all the time: the corridor's
	// walls may come down to the floor at the lowest corners, not along it)
	const room = Math.max(
		0.6,
		Math.min(width + 0.45, (top - floor - (section.mini ? 5.5 : 4.5)) / 2 - box.h)
	);
	const bandLow = Math.min(low + room, (floor + top) / 2 - 0.6);
	const bandHigh = Math.max(high - room, (floor + top) / 2 + 0.6);
	const sway =
		Math.max(0, (bandHigh - bandLow - 2.5) / 2) *
		(section.mini ? 0.3 : preset.level >= 2 ? 0.7 : 0.4);
	const bar = (x: number) => {
		const pos = musicalPosition(ctx.chart, world.timeAt(x));
		return pos.point.beatLength * pos.point.meter;
	};
	const swayLength = Math.max(8, (bar(entry.x) / 1000) * 4 * section.speed);
	const swayPhase = rng() * Math.PI * 2;
	const band = (px: number) => {
		const shift = Math.sin(swayPhase + ((px - section.x0) / swayLength) * Math.PI * 2) * sway;
		// (it moves inside the band's limits, never closer to the floor or ceiling)
		return { lo: bandLow + sway + shift, hi: bandHigh - sway + shift };
	};
	/** The quarter beats between two places (where a turn on the way may go) */
	const quarters = (from: number, to: number) => {
		const result: number[] = [];
		for (const point of ctx.chart.timing) {
			const span = point.beatLength / 4;
			const t0 = world.timeAt(from);
			const t1 = world.timeAt(to);
			const until = Math.min(
				t1,
				ctx.chart.timing.find((q) => q.time > point.time)?.time ?? Infinity
			);
			for (let t = point.time + Math.ceil((t0 - point.time) / span) * span; t <= until; t += span)
				if (t >= point.time) result.push(half(world.xAt(t)));
		}
		return result.filter((q) => q > from && q <= to).sort((a, b) => a - b);
	};
	const points: { x: number; y: number }[] = [];
	const events: InputEvent[] = [];
	let x = entry.x;
	let y = clamp(entry.y, low, high);
	// (as it comes in: let go, down; the first turn is on the first note)
	let up = false;
	let lastTurn = -Infinity;
	let inBand = false;
	points.push({ x, y });
	/**
	 * A place on the physics' steps: a turn there is where the wave turns, exactly (between two
	 * steps it would turn at the next one, and over many turns the way would drift off)
	 */
	const onStep = (px: number) => {
		const t = world.timeAt(px);
		return world.xAt(entry.time + Math.round((t - entry.time) / STEP) * STEP);
	};
	/**
	 * Upside down (a gravity portal): holding takes it down then, letting go up. Only for a
	 * bar or two, then a portal back, and the corridor a bit wider meanwhile
	 */
	let gravity: 1 | -1 = 1;
	let lastPortal = -Infinity;
	// (the intense parts of the hardest levels: twice as many, on any bar, a bar and a half apart)
	const busy = preset.level >= 3 && (section.intensity ?? 0.5) >= 0.72;
	let portalsLeft = !gravityIn(ctx, 'wave')
		? 0
		: (preset.level >= 4 ? 2 : preset.level >= 2 ? 1 : 0) * (busy ? 2 : 1);
	const upsideDown: [number, number][] = [];
	const turn = (at: number, portal = false) => {
		up = !up;
		lastTurn = at;
		if (portal) {
			// A gravity portal turns it without a press (just before the step it turns from)
			gravity = gravity > 0 ? -1 : 1;
			if (gravity < 0) {
				portalsLeft--;
				upsideDown.push([at, Infinity]);
			} else upsideDown[upsideDown.length - 1][1] = at;
			lastPortal = at;
			world.gravityPortals.add({ x: at - 0.001, y, gravity, x0: at - 0.6, x1: at + 0.6 });
			used(ctx, 'wave-gravity');
			return;
		}
		// (just after the step it turns from: the press counts for the step after it)
		events.push({ time: world.timeAt(at) + 0.001, down: gravity > 0 ? up : !up });
	};
	/** A turn on a note that's a strong downbeat may be a gravity portal (now and then) */
	const portalHere = (at: number) => {
		const time = world.timeAt(at);
		const pos = musicalPosition(ctx.chart, time);
		const barX = ((pos.point.beatLength * pos.point.meter) / 1000) * section.speed;
		// Upside down: back after a bar, on a downbeat, or after two bars at the latest
		if (gravity < 0)
			return at - lastPortal >= barX && (at - lastPortal >= 2 * barX || pos.inBar < 0.1);
		if (portalsLeft <= 0 || at - lastPortal < (busy ? 1.5 : 3) * barX) return false;
		if ((!busy && pos.bar % 2 !== 0) || pos.inBar > 0.1 || musicalRest(ctx.chart, time))
			return false;
		return rng() < (busy ? 0.8 : preset.flips * (0.35 + (section.intensity ?? 0.5) * 0.4));
	};
	/** Straight on to a place: turning at the band's edge (on a quarter beat) on the way */
	const advance = (toX: number) => {
		for (let guard = 0; inBand && guard < 64 && x < toX - 1e-6; guard++) {
			// Where it leaves the band going on like this
			let out = Infinity;
			for (let px = x + 0.25; px <= toX + 1e-6; px += 0.25) {
				const py = y + (px - x) * slope * (up ? 1 : -1);
				const b = band(px);
				if ((up && py > b.hi) || (!up && py < b.lo)) {
					out = px - 0.25;
					break;
				}
			}
			if (out >= toX) break;
			// (a turn at the band's edge only needs the plain gap, also for the small wave: else it
			// would run out of the band before it may turn)
			const minGap = preset.waveGap * section.speed;
			const options = quarters(x, out).filter((q) => q - lastTurn >= minGap);
			const at = onStep(
				options.length
					? options[options.length - 1]
					: Math.max(x + 0.5, Math.min(out, lastTurn + minGap))
			);
			if (at >= toX - 0.25) break;
			const ny = clamp(y + (at - x) * slope * (up ? 1 : -1), low, high);
			x = at;
			y = ny;
			points.push({ x, y });
			turn(at);
		}
		const ny = y + (toX - x) * slope * (up ? 1 : -1);
		if (ny > high || ny < low) {
			// (only where the band can't hold it: along the edge to there)
			const limit = up ? high : low;
			const reach = x + Math.abs(limit - y) / slope;
			if (reach > x + 1e-6) points.push({ x: reach, y: limit });
			y = limit;
		} else y = ny;
		x = toX;
		points.push({ x, y });
	};
	for (let k = 0; k < turns.length; k++) {
		const tx = onStep(turns[k]);
		if (tx - lastTurn < gap * section.speed) continue;
		advance(tx);
		// A turn on every note (now and then one goes by, for a longer stroke)
		const b = band(tx);
		const towardEdge = up ? y >= b.hi - 0.3 : y <= b.lo + 0.3;
		if (!inBand || towardEdge || rng() > 0.08) turn(tx, inBand && portalHere(tx));
		inBand = true;
	}
	// (out to the end: no more turns of its own, none past the end into the next part)
	const lastInBand = lastTurn;
	inBand = false;
	advance(world.xAt(section.end) + 1);
	// (let go at the end, whichever way that is)
	if (gravity > 0 ? up : !up) events.push({ time: section.end - 1, down: false });

	if (turns.length < 2) {
		plan.push(...events);
		return simulate(world, entry, section.end, plan);
	}

	// The corridor: even, or flat above or below, changing at musical phrase boundaries
	const first = turns[0];
	const walls: Walls = { xs: [], lo: [], hi: [], x0: first - 3, x1: world.xAt(section.end - 150) };
	const extra = new Map<number, number>();
	const pathAt = (px: number) => {
		for (let k = 1; k < points.length; k++)
			if (px <= points[k].x) {
				const a = points[k - 1];
				const b = points[k];
				return a.y + ((b.y - a.y) * (px - a.x)) / (b.x - a.x || 1);
			}
		return points[points.length - 1].y;
	};
	const xs = [
		walls.x0,
		...points.map((p) => p.x).filter((px) => px > walls.x0 + 0.01 && px < walls.x1 - 0.01),
		walls.x1
	];
	// One architectural treatment per musical phrase, independent of how many turns fit.
	for (const rest of ctx.chart.breaks) {
		for (const time of [rest.start + 100, rest.end - 100]) {
			const x = world.xAt(time);
			if (x > walls.x0 && x < walls.x1) xs.push(x);
		}
	}
	xs.sort((a, b) => a - b);
	const styles = xs.map((x) => {
		const pos = musicalPosition(ctx.chart, world.timeAt(x));
		const slot = hash(`${ctx.seed ?? 0}:${pos.point.meter}:${Math.floor(pos.bar / 2) % 2}`) % 4;
		return preset.level >= 4 && (section.intensity ?? 0.5) > 0.6
			? ['even', 'narrow', 'flatTop', 'flatBottom'][slot]
			: ['even', 'even', 'flatTop', 'flatBottom'][slot];
	});
	const build = () => {
		walls.xs = [];
		walls.lo = [];
		walls.hi = [];
		xs.forEach((px, k) => {
			const opening =
				clamp((walls.x0 + 3.5 - px) / 3.5, 0, 1) + clamp((px - (walls.x1 - 3)) / 3, 0, 1);
			// (a chokepoint: narrower for a phrase, as tight as the wave allows)
			const narrow = styles[k] === 'narrow' ? Math.min(0.25, width - box.h * 1.35 - 0.6) : 0;
			const flipped = upsideDown.some(([a, b]) => px >= a - 1.5 && px <= b + 1.5) ? 0.45 : 0;
			const w = width - Math.max(0, narrow) + flipped + (extra.get(k) ?? 0) + opening * 4;
			// Straight stretches (long gaps) get a bit more room
			const gapLeft = k > 0 ? px - xs[k - 1] : 0;
			const roomy = gapLeft > 4 ? 0.25 : 0;
			const py = pathAt(px);
			let lo = py - w - roomy;
			let hi = py + w + roomy;
			// Flat sides: the highest (lowest) of the stretch
			if (styles[k] === 'flatTop' || styles[k] === 'flatBottom') {
				let a = k;
				let b = k;
				while (a > 0 && styles[a - 1] === styles[k]) a--;
				while (b < xs.length - 1 && styles[b + 1] === styles[k]) b++;
				// (from the first turn on: before it, it's still coming in along the floor)
				const ys = xs
					.slice(a, b + 1)
					.filter((px) => px >= first && px <= lastInBand)
					.map(pathAt);
				if (!ys.length) ys.push(pathAt(px));
				// (flat at the way's highest or lowest there; a place that needed more room keeps it)
				if (styles[k] === 'flatTop')
					hi = Math.max(hi, Math.min(top - 0.3, Math.max(...ys) + width));
				else lo = Math.min(lo, Math.max(floor + 0.3, Math.min(...ys) - width));
			}
			if (musicalRest(ctx.chart, world.timeAt(px))) {
				lo = floor - 0.5;
				hi = top + 0.5;
			}
			walls.xs.push(px);
			walls.lo.push(lo);
			walls.hi.push(hi);
		});
	};
	build();
	world.walls.add(walls);

	// Checked: on time, and played like a person, who turns a bit early or late at every
	// corner (by up to half a block of the way: twice as high for the steeper small wave) but
	// sees where the corridor goes (so the errors don't add up); where it crashes, wider
	// (a player of the harder levels is less sloppy: the corridor isn't widened for as much)
	const SLOPPY = (0.6 - preset.level * 0.02) * slope;
	const person = (seed: number) => {
		let r = seed * 7919 + 17;
		const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
		const s = { ...entry, used: [...entry.used] };
		let k = 1;
		let error = rnd() * SLOPPY;
		while (s.time + STEP <= section.end + 1e-6 && !s.dead) {
			const next = s.time + STEP;
			while (k < points.length - 1) {
				const a = points[k - 1];
				const b = points[k];
				const before = Math.sign(b.y - a.y);
				const reached =
					before > 0
						? s.y >= b.y + error
						: before < 0
							? s.y <= b.y - error
							: s.x >= b.x + error / slope;
				if (reached || s.x > b.x + 1.2) {
					k++;
					error = rnd() * SLOPPY;
				} else break;
			}
			const a = points[k - 1];
			const b = points[k];
			const dir = Math.sign(b.y - a.y);
			const rise = dir > 0 ? true : dir < 0 ? false : b.y > (floor + top) / 2;
			// (upside down, holding takes it down)
			const hold = s.gravity > 0 ? rise : !rise;
			if (hold !== s.held) press(s, hold);
			step(world, s, next);
		}
		return s;
	};
	for (let attempt = 0; attempt < 50; attempt++) {
		let failed: PlayerState | null = null;
		const exact = simulate(world, entry, section.end, events);
		if (exact.dead) failed = exact;
		for (let seed = 1; seed <= 6 && !failed; seed++) {
			const run = person(seed);
			if (run.dead) failed = run;
		}
		if (!failed) break;
		const at = failed.x;
		const k = Math.max(
			1,
			walls.xs.findIndex((v) => v > at)
		);
		xs.forEach((px, i) => {
			if (Math.abs(px - at) < 2.5 || i === k || i === k - 1)
				extra.set(i, (extra.get(i) ?? 0) + 0.25);
		});
		build();
		world.walls.touch();
	}
	if (simulate(world, entry, section.end, events).dead) world.walls.remove(walls);
	plan.push(...events);
	used(ctx, section.mini ? 'miniwave' : 'wave');
	return simulate(world, entry, section.end, plan);
}
