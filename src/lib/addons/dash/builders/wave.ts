// The wave parts, as they're built by hand: phrase by phrase an even zigzag on the beat grid
// (every two beats where it's calm, every beat, half beat or quarter beat where it's busier),
// as one of a few figures (even, climbing, diving, a spam of the quickest turns), in a corridor
// as wide all through the phrase: along the zigzag, or a straight tunnel around it (or straight
// on one side). The turns are on the physics' steps, so the slopes meet at clean corners.

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
import { clamp, gravityIn, used, type Context } from '../build';
import type { DashNote } from '../chart';
import { musicalPosition, musicalRest } from '../composition';

export function buildWave(ctx: Context, section: Section, notes: DashNote[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const top = section.ceil!;
	const floor = section.floor;
	const slope = section.mini ? 2 : 1;
	const box = hitbox('wave', section.mini);
	// The small wave is steeper already (twice as far up or down for a moment late): a bit
	// wider, and fewer turns
	// (and the faster, the wider: the same mistake is further off there)
	// (from hard on as roomy as at 3x at least: the levels go slower in their usual parts now, the
	// wave keeps the room it had there)
	const fast =
		1 +
		Math.max(0, (preset.level >= 2 ? Math.max(3, section.speedIndex) : section.speedIndex) - 1) *
			0.1;
	const width = preset.wave * (section.mini ? 1.55 : 1) * fast;
	const gap = preset.waveGap * (section.mini ? 2.2 : 1) * (section.speedIndex >= 3 ? 1.15 : 1);

	// --- Its phrases: a rhythm each -----------------------------------------------------------
	// As wave parts are built by hand: in each phrase (two bars) the wave turns on the beat grid,
	// every so many beats, so its zigzag is even; how often goes with how busy the music is there
	// (a stream: quick little turns), and the zigzag is one of a few figures: even, climbing (long
	// up, short down), diving, or a spam (the quickest turns in a narrow straight tunnel)
	const low = floor + box.h;
	const high = top - box.h;
	const from = section.start + 200;
	const until = section.end - 300;
	type Figure = 'zigzag' | 'climb' | 'dive' | 'spam';
	type Shape = 'even' | 'tunnel' | 'flatTop' | 'flatBottom';
	const phrases: {
		from: number;
		to: number;
		/** Beats between two turns */
		unit: number;
		figure: Figure;
		shape: Shape;
		/** Its corridor's half height (blocks) */
		width: number;
		/** How much wider it had to be made (checked below) */
		extra: number;
		/** Where its zigzag is around the middle (before, it climbs or dives to it) */
		settled: number;
	}[] = [];
	for (let t = from; t < until - 1;) {
		const pos = musicalPosition(ctx.chart, t + 1);
		let to = Math.min(until, pos.end);
		if (to <= t + 1) to = Math.min(until, t + pos.point.beatLength * 8);
		phrases.push({
			from: t,
			to,
			unit: 1,
			figure: 'zigzag',
			shape: 'even',
			width,
			extra: 0,
			settled: Infinity
		});
		t = to;
	}
	// (a short last piece goes with the phrase before)
	const lastPhrase = phrases[phrases.length - 1];
	if (phrases.length > 1 && lastPhrase.to - lastPhrase.from < 1500) {
		phrases[phrases.length - 2].to = lastPhrase.to;
		phrases.pop();
	}
	/** A spam's corridor next to the others: narrow, its quick small turns close to its sides */
	const SPAM = 0.6;
	/** How far up or down it goes in a time (ms): the zigzag's height for it */
	const rise = (ms: number) => (ms / 1000) * section.speed * slope;
	const intense = section.intensity ?? 0.5;
	for (const phrase of phrases) {
		const beat = musicalPosition(ctx.chart, phrase.from + 1).point.beatLength;
		const inside = notes.filter(
			(n) => n.time >= phrase.from && n.time < phrase.to && !musicalRest(ctx.chart, n.time)
		);
		// (notes a beat: a stream is 3 and more)
		const busy =
			(inside.length / Math.max(1, (phrase.to - phrase.from) / beat)) * (0.8 + intense * 0.4);
		// The units it may turn on: not quicker than the difficulty allows, not higher than the
		// room (the zigzag and the corridor around it fit between floor and ceiling)
		const tallest = Math.max(1, (high - low - 2 * width) * 0.85);
		const quick = (u: number) => u * beat >= gap * 1000 - 1;
		let units = [2, 1, 0.5, 0.25].filter((u) => quick(u) && rise(u * beat) <= tallest);
		// (else dotted ones; else the quickest allowed, in a narrower corridor: as even as
		// can be, not turns at odd places)
		if (!units.length) units = [1.5, 0.75].filter((u) => quick(u) && rise(u * beat) <= tallest);
		if (!units.length) {
			const least = [0.25, 0.5, 0.75, 1, 1.5, 2].find(quick) ?? 2;
			units = [least];
			const narrowest = box.h * 1.35 + 0.6;
			phrase.width = clamp((high - low - rise(least * beat)) / 2 / 0.85, narrowest, width);
		}
		// (busier, quicker: two beats where it's calm, one, a half, a quarter in a stream)
		const wanted = busy >= 3 ? 0.25 : busy >= 1.6 ? 0.5 : busy >= 0.7 ? 1 : 2;
		phrase.unit = units.reduce((best, u) =>
			Math.abs(Math.log2(u / wanted)) < Math.abs(Math.log2(best / wanted)) ? u : best
		);
		// The figure: the same again where the rhythm repeats (a motif), else by chance
		const pos = musicalPosition(ctx.chart, phrase.from + 1);
		const motif = `wave:${section.mini ? 1 : 0}:${pos.point.meter}:${Math.round(busy * 2)}`;
		const remembered = ctx.motifs.get(motif)?.[0] as Figure | undefined;
		const spam = phrase.unit <= 0.5 && busy >= 1.6 && preset.level >= 2;
		const roll = rng();
		phrase.figure =
			remembered && roll < 0.6
				? remembered
				: spam && roll < 0.55
					? 'spam'
					: roll < 0.7
						? 'zigzag'
						: roll < 0.85
							? 'climb'
							: 'dive';
		if (phrase.figure === 'spam' && !spam) phrase.figure = 'zigzag';
		if (!ctx.motifs.has(motif)) ctx.motifs.set(motif, [phrase.figure]);
		// The corridor: along the zigzag, or a straight tunnel (flat on both sides, on one)
		const shapes: Shape[] = ['even', 'even', 'even', 'tunnel', 'tunnel', 'flatTop', 'flatBottom'];
		// (a straight one only around a zigzag that stays where it is: one that climbs or dives
		// would make it as high as the room)
		phrase.shape =
			phrase.figure === 'spam'
				? 'tunnel'
				: phrase.figure === 'zigzag'
					? shapes[Math.floor(rng() * shapes.length)]
					: 'even';
		used(ctx, `wave-${phrase.figure}`);
	}

	// --- The way ------------------------------------------------------------------------------
	const points: { x: number; y: number }[] = [];
	const events: InputEvent[] = [];
	let x = entry.x;
	let y = clamp(entry.y, low, high);
	// (as it comes in: let go, down)
	let up = false;
	let lastTurn = -Infinity;
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
	const busy = preset.level >= 3 && intense >= 0.72;
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
	/** A turn on a strong downbeat may be a gravity portal (now and then) */
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
		return rng() < (busy ? 0.8 : preset.flips * (0.35 + intense * 0.4));
	};
	/** Straight on to a place (along the floor or ceiling where it would go past them) */
	const go = (toX: number) => {
		const ny = y + (toX - x) * slope * (up ? 1 : -1);
		if (ny > high || ny < low) {
			const limit = up ? high : low;
			const reach = x + Math.abs(limit - y) / slope;
			if (reach > x + 1e-6) points.push({ x: reach, y: limit });
			y = limit;
		} else y = ny;
		x = toX;
		points.push({ x, y });
	};
	const turns: number[] = [];
	for (const phrase of phrases) {
		const beat = musicalPosition(ctx.chart, phrase.from + 1).point.beatLength;
		/** The time between two turns (ms) */
		const every = phrase.unit * beat;
		// (the beat grid of its unit, from the phrase's bar line)
		const origin = musicalPosition(ctx.chart, phrase.from + 1).start;
		let t = origin + Math.ceil((phrase.from - origin) / every - 1e-6) * every;
		let figure = phrase.figure;
		/** How far up or down a stroke goes */
		const span = rise(every);
		// (kept off the floor and ceiling by its corridor's half and a little)
		const margin = phrase.width * (figure === 'spam' ? SPAM : 1) + 0.2;
		for (let guard = 0; guard < 256 && t < phrase.to - 1; guard++) {
			const at = onStep(world.xAt(t));
			if (at <= x + 0.25 || at - lastTurn < gap * section.speed - 1e-6) {
				t += every;
				continue;
			}
			go(at);
			turn(at, portalHere(at));
			turns.push(at);
			// The next stroke: one unit; climbing, two up and one down, diving the other way
			// round (and turned into the other where two more would leave the room). A zigzag far
			// from the room's middle climbs (dives) to it first: it zigzags around the middle
			const middle = (low + high) / 2;
			const toward =
				phrase.figure !== 'zigzag' && phrase.figure !== 'spam'
					? null
					: y < middle - span
						? 'climb'
						: y > middle + span
							? 'dive'
							: null;
			if (!toward && phrase.settled === Infinity) phrase.settled = at;
			const strokes = () =>
				(toward ?? figure) === 'climb'
					? up
						? 2
						: 1
					: (toward ?? figure) === 'dive'
						? up
							? 1
							: 2
						: 1;
			const edge = up ? high - margin : low + margin;
			const room = Math.max(0, up ? edge - y : y - edge) / rise(1);
			if (figure === 'climb' && up && room < 2 * every) figure = 'dive';
			else if (figure === 'dive' && !up && room < 2 * every) figure = 'climb';
			let next = strokes() * every;
			// (where even that leaves the room: the turn at the edge, on the quarter beat before)
			if (room < next) {
				const quarter = beat / 4;
				next = Math.max(
					Math.ceil((gap * 1000) / quarter) * quarter,
					Math.floor(room / quarter) * quarter
				);
			}
			t += next;
		}
	}
	// (out to the end: no more turns, none past the end into the next part)
	const first = turns[0];
	const lastInBand = lastTurn;
	go(world.xAt(section.end) + 1);
	// (let go at the end, whichever way that is)
	if (gravity > 0 ? up : !up) events.push({ time: section.end - 1, down: false });

	if (turns.length < 2) {
		plan.push(...events);
		return simulate(world, entry, section.end, plan);
	}

	// --- The corridor: as wide all through a phrase -----------------------------------------
	const walls: Walls = { xs: [], lo: [], hi: [], x0: first - 3, x1: world.xAt(section.end - 150) };
	const pathAt = (px: number) => {
		for (let k = 1; k < points.length; k++)
			if (px <= points[k].x) {
				const a = points[k - 1];
				const b = points[k];
				return a.y + ((b.y - a.y) * (px - a.x)) / (b.x - a.x || 1);
			}
		return points[points.length - 1].y;
	};
	const phraseAt = (px: number) => {
		const t = world.timeAt(px);
		let k = 0;
		while (k + 1 < phrases.length && phrases[k + 1].from <= t) k++;
		return k;
	};
	// (the corners of the way, the phrases' ends (both sides of each), and the rests' edges)
	const xs = points.map((p) => p.x).filter((px) => px > walls.x0 + 0.01 && px < walls.x1 - 0.01);
	xs.push(walls.x0, walls.x1);
	for (const phrase of phrases) {
		const px = world.xAt(phrase.from);
		if (px > walls.x0 && px < walls.x1) xs.push(px - 0.01, px);
	}
	for (const rest of ctx.chart.breaks)
		for (const time of [rest.start + 100, rest.end - 100]) {
			const px = world.xAt(time);
			if (px > walls.x0 && px < walls.x1) xs.push(px);
		}
	xs.sort((a, b) => a - b);
	/** The way's highest and lowest in a phrase (for its straight sides) */
	const reach = phrases.map((phrase) => {
		const a = Math.max(world.xAt(phrase.from), first, phrase.settled);
		const b = Math.min(world.xAt(phrase.to), lastInBand);
		const ys = points.filter((p) => p.x >= a && p.x <= b).map((p) => p.y);
		if (!ys.length) ys.push(pathAt((a + b) / 2));
		return { lo: Math.min(...ys), hi: Math.max(...ys) };
	});
	const build = () => {
		walls.xs = [];
		walls.lo = [];
		walls.hi = [];
		for (const px of xs) {
			const k = phraseAt(px);
			const phrase = phrases[k];
			// (wider into the part and out of it, a bit wider upside down)
			const opening =
				clamp((walls.x0 + 3.5 - px) / 3.5, 0, 1) + clamp((px - (walls.x1 - 3)) / 3, 0, 1);
			const flipped = upsideDown.some(([a, b]) => px >= a - 1.5 && px <= b + 1.5) ? 0.45 : 0;
			const w =
				phrase.width * (phrase.figure === 'spam' ? SPAM : 1) + flipped + phrase.extra + opening * 4;
			const py = pathAt(px);
			let lo = py - w;
			let hi = py + w;
			// (straight sides from where its zigzag is around the middle on)
			const shape = px >= phrase.settled - 0.01 ? phrase.shape : 'even';
			if (shape === 'tunnel' || shape === 'flatTop')
				hi = Math.max(hi, Math.min(top - 0.3, reach[k].hi + w));
			if (shape === 'tunnel' || shape === 'flatBottom')
				lo = Math.min(lo, Math.max(floor + 0.3, reach[k].lo - w));
			if (musicalRest(ctx.chart, world.timeAt(px))) {
				lo = floor - 0.5;
				hi = top + 0.5;
			}
			walls.xs.push(px);
			walls.lo.push(lo);
			walls.hi.push(hi);
		}
	};
	build();
	world.walls.add(walls);

	// Checked: on time, and played like a person: they follow the zigzag they see, each stroke a
	// bit off it (up to half a block: twice that for the steeper small wave) and turning only once
	// they're clearly off; they keep to the corridor, so the errors don't add up from corner to
	// corner. Where one crashes, the phrase a bit wider (a player of the harder levels is less
	// sloppy: it isn't widened for as much)
	const SLOPPY = (0.6 - preset.level * 0.02) * slope;
	/** How far off the way a person is before turning (blocks) */
	const SLACK = 0.15 * slope;
	const person = (seed: number) => {
		let r = seed * 7919 + 17;
		const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
		const s = { ...entry, used: [...entry.used] };
		let k = 1;
		let off = rnd() * SLOPPY;
		while (s.time + STEP <= section.end + 1e-6 && !s.dead) {
			const next = s.time + STEP;
			// (another error from each corner on)
			while (k < points.length - 1 && s.x >= points[k].x) {
				k++;
				off = rnd() * SLOPPY;
			}
			const want = pathAt(s.x + section.speed * STEP * 0.001) + off;
			// (going up now: held, or let go upside down)
			const rising = s.held === s.gravity > 0;
			let up = rising;
			if (rising && s.y > want + SLACK) up = false;
			else if (!rising && s.y < want - SLACK) up = true;
			const hold = s.gravity > 0 ? up : !up;
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
		// (the whole phrase where it crashed a little wider: its corridor stays even)
		phrases[phraseAt(failed.x)].extra += 0.15;
		build();
		world.walls.touch();
	}
	if (simulate(world, entry, section.end, events).dead) world.walls.remove(walls);
	plan.push(...events);
	used(ctx, section.mini ? 'miniwave' : 'wave');
	return simulate(world, entry, section.end, plan);
}
