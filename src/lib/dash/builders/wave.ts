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
import { clamp, half, used, type Context } from '../build';
import type { DashNote } from '../chart';

export function buildWave(ctx: Context, section: Section, notes: DashNote[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const top = section.ceil!;
	const floor = section.floor;
	const slope = section.mini ? 2 : 1;
	const box = hitbox('wave', section.mini);
	// The small wave is steeper already: hardly narrower, and fewer turns
	const width = preset.wave * (section.mini ? 0.9 : 1);
	const gap = preset.waveGap * (section.mini ? 1.35 : 1);

	// The turns: notes far enough apart, put on the grid
	const turns: number[] = [];
	for (const note of notes) {
		if (note.time < section.start + 650 || note.time > section.end - 500) continue;
		const x = half(world.xAt(note.time));
		const last = turns[turns.length - 1];
		if (last !== undefined && (x - last) / section.speed < gap) continue;
		if (last !== undefined && x - last < 0.5) continue;
		turns.push(x);
	}

	// The way: 45° (63° small) up or down, along the floor or ceiling at the ends
	const low = floor + box.h;
	const high = top - box.h;
	const points: { x: number; y: number }[] = [];
	const events: InputEvent[] = [];
	let x = entry.x;
	let y = clamp(entry.y, low, high);
	let up = false;
	points.push({ x, y });
	const advance = (toX: number) => {
		const dy = (toX - x) * slope * (up ? 1 : -1);
		const target = y + dy;
		if (target > high || target < low) {
			const limit = up ? high : low;
			const reach = x + Math.abs(limit - y) / slope;
			if (reach > x + 1e-6) points.push({ x: reach, y: limit });
			y = limit;
		} else y = target;
		x = toX;
		points.push({ x, y });
	};
	const margin = width + 0.4;
	for (let k = 0; k < turns.length; k++) {
		const tx = turns[k];
		advance(tx);
		const nextX = turns[k + 1] ?? world.xAt(section.end);
		const dy = (nextX - tx) * slope;
		const wouldBe = y + (up ? -dy : dy);
		// A turn on every note, unless it runs into the floor or ceiling for long
		if (
			(wouldBe >= floor + margin - dy * 0.4 && wouldBe <= top - margin + dy * 0.4) ||
			rng() < 0.12
		) {
			up = !up;
			events.push({ time: world.timeAt(tx), down: up });
		}
	}
	advance(world.xAt(section.end) + 1);
	if (up) events.push({ time: section.end - 1, down: false });

	if (turns.length < 2) {
		plan.push(...events);
		return simulate(world, entry, section.end, plan);
	}

	// The corridor: even, or flat above or below, changing every few turns
	const first = turns[0];
	const walls: Walls = { xs: [], lo: [], hi: [], x0: first - 3, x1: world.xAt(section.end - 350) };
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
	const styles = xs.map(() => 'even');
	let style = 'even';
	let left = 0;
	for (let k = 0; k < xs.length; k++) {
		if (left-- <= 0) {
			style = ['even', 'even', 'flatTop', 'flatBottom'][Math.floor(rng() * 4)];
			left = 5 + Math.floor(rng() * 6);
		}
		styles[k] = style;
	}
	const build = () => {
		walls.xs = [];
		walls.lo = [];
		walls.hi = [];
		xs.forEach((px, k) => {
			const opening =
				clamp((walls.x0 + 3.5 - px) / 3.5, 0, 1) + clamp((px - (walls.x1 - 3)) / 3, 0, 1);
			const w = width + (extra.get(k) ?? 0) + opening * 4;
			// Straight stretches (long gaps) get a bit more room
			const gapLeft = k > 0 ? px - xs[k - 1] : 0;
			const roomy = gapLeft > 4 ? 0.25 : 0;
			const py = pathAt(px);
			let lo = py - w - roomy;
			let hi = py + w + roomy;
			// Flat sides: the highest (lowest) of the stretch
			if (styles[k] !== 'even') {
				let a = k;
				let b = k;
				while (a > 0 && styles[a - 1] === styles[k]) a--;
				while (b < xs.length - 1 && styles[b + 1] === styles[k]) b++;
				const ys = xs.slice(a, b + 1).map(pathAt);
				if (styles[k] === 'flatTop') hi = Math.min(top + 0.5, Math.max(...ys) + w);
				else lo = Math.max(floor - 0.5, Math.min(...ys) - w);
			}
			walls.xs.push(px);
			walls.lo.push(lo);
			walls.hi.push(hi);
		});
	};
	build();
	world.walls.add(walls);

	// Checked: on time, and played like a person, who turns a bit early or late at every
	// corner (by up to half a block) but sees where the corridor goes (so the errors don't add
	// up); where it crashes, wider
	const SLOPPY = 0.5;
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
			const hold = dir > 0 ? true : dir < 0 ? false : b.y > (floor + top) / 2;
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
