// The parts between a floor and a ceiling: ship, UFO, swing, ball and spider. Gravity portals
// on strong downbeats turn some of them upside down for a while, and some clicks take an orb
// (blue and green turn gravity around, the others jump). The way through is played first
// (the clicks on the notes; the ship flies along the notes' heights, the swing turns around on
// the notes and beats), on time, early and late; then blocks are built around that way, a bit
// away from it (less the harder), column by column on the grid, and spikes go on their
// surfaces where there's room, in rows that start on the strong notes. So the structures
// follow the music, and the way they leave always works.

import {
	copyState,
	hitbox,
	press,
	simulate,
	step,
	STEP,
	type Hazard,
	type InputEvent,
	type OrbKind,
	type PlayerState,
	type Section,
	type Solid
} from '../physics';
import { clamp, freshness, legalAround, shuffleByWeight, tap, used, type Context } from '../build';
import { beatStrength, type DashNote } from '../chart';

interface Column {
	x: number;
	low: number;
	high: number;
	spike: 0 | 1 | -1;
}

/** The times the swing turns around on: its part's notes and the beats' halves */
function onTheMusic(ctx: Context, section: Section, notes: DashNote[]) {
	const times = notes.map((n) => n.time);
	const timing = ctx.chart.timing;
	for (let i = 0; i < timing.length; i++) {
		const point = timing[i];
		const until = Math.min(timing[i + 1]?.time ?? Infinity, section.end);
		const half = point.beatLength / 2;
		const first = Math.max(0, Math.ceil((section.start - point.time) / half));
		for (let k = first; point.time + k * half < until; k++) times.push(point.time + k * half);
	}
	return times.sort((a, b) => a - b);
}

/**
 * The ship's way: holds while below where it should be (as a person flies, roughly). The
 * swing turns toward it, on the music (`music`: the times it may turn on) unless it must;
 * with a `delay` (ms) it turns that much after it sees it should, as a person reacts.
 */
function flyShip(
	ctx: Context,
	from: PlayerState,
	until: number,
	target: (x: number) => number,
	music: number[] = [],
	delay = 0
) {
	const { world } = ctx;
	const s = copyState(from);
	const events: InputEvent[] = [];
	let lastChange = -1e9;
	let beat = 0;
	/** A turn it decided on, when it comes (-1: none) */
	let pending = -1;
	while (s.time + STEP <= until + 1e-6 && !s.dead) {
		const next = s.time + STEP;
		const speed = world.sectionAt(s.time).speed;
		const ahead = target(s.x + speed * 0.18);
		if (s.mode === 'swing') {
			// Flips the gravity toward where it should be (a tap), on a note or beat when it can
			while (beat < music.length && music[beat] <= s.time) beat++;
			const onBeat = beat < music.length && music[beat] <= next;
			const off = ahead - (s.y + s.vy * 0.22);
			const want = off > 0.25 ? -1 : off < -0.25 ? 1 : s.gravity;
			const must = Math.abs(off) > 1.5;
			if (s.held && next - lastChange > 60) {
				press(s, false);
				events.push({ time: next, down: false });
			} else if (pending < 0 && !s.held && want !== s.gravity && next - lastChange > 130) {
				if (onBeat || must || !music.length) pending = next + delay;
			}
			if (pending >= 0 && next >= pending && !s.held) {
				press(s, true);
				events.push({ time: next, down: true });
				lastChange = next;
				pending = -1;
			}
		} else {
			// (upside down, holding pulls it down)
			const wanted = clamp((ahead - s.y) * 6, -7, 7);
			const hold = s.gravity > 0 ? s.vy < wanted : s.vy > wanted;
			if (hold !== s.held && next - lastChange > 30) {
				press(s, hold);
				events.push({ time: next, down: hold });
				lastChange = next;
			}
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

	// How hard: room around the way, spikes, breathers
	const tight = [1.25, 1.1, 1, 0.82, 0.65][preset.level];
	const spiky = [0.7, 0.85, 1, 1.3, 1.6][preset.level];

	// --- Gravity portals: on strong downbeats, upside down and back -------------------------
	// (not near a click: pressed a moment before or after the portal would go another way)
	if (mode !== 'swing' && preset.level >= 1 && rng() < [0, 0.5, 0.75, 0.85, 0.95][preset.level]) {
		let gravity: 1 | -1 = -1;
		let last = -Infinity;
		let count = 0;
		for (const note of notes) {
			if (count >= preset.level) break;
			const x = world.xAt(note.time);
			if (x < startX + 4 || x > endX - 6 || note.time - last < 2400) continue;
			if (beatStrength(ctx.chart.timing, note.time) < 1 && !(note.sound & 4)) continue;
			if (clicks.some((c) => Math.abs(c - note.time) < 280) || rng() < 0.35) continue;
			world.gravityPortals.add({ x, y: (floor + top) / 2, gravity, x0: x - 0.6, x1: x + 0.6 });
			gravity = gravity > 0 ? -1 : 1;
			last = note.time;
			count++;
		}
		if (count) used(ctx, 'gravity');
	}

	// --- The way through ---------------------------------------------------------------
	let events: InputEvent[] = [];
	let follow: (x: number) => number = () => top / 2;
	const steered = mode === 'ship' || mode === 'swing';
	const music = mode === 'swing' ? onTheMusic(ctx, section, notes) : [];
	if (steered) {
		// Along the notes' heights, no steeper than a ship climbs
		const keys: { x: number; y: number }[] = [{ x: section.x0, y: clamp(entry.y, 2, top - 2) }];
		const margin = preset.ship + 0.4;
		for (const note of notes) {
			const x = world.xAt(note.time);
			if (x < startX + 2 || x > endX) continue;
			const last = keys[keys.length - 1];
			if (x - last.x < 2.5) continue;
			// (the swing in a narrower band: it swings around its way)
			const band = mode === 'swing' ? 0.28 : 1;
			const y = top / 2 + (note.height - 0.5) * (top - 2 * margin) * band;
			const steepest = (mode === 'swing' ? 0.3 : 0.45) * (x - last.x);
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
		follow = path;
		events = flyShip(ctx, entry, section.end, path, music).events;
	} else {
		// The clicks; the ball and the spider only switch on a surface, else a blue orb does it.
		// Some clicks take an orb, for what the music does there (see musicalOrb)
		const times = clicks.filter((t) => t > section.start + 400 && t < section.end - 400);
		const noteAt = new Map(notes.map((n) => [n.time, n]));
		const most = [0, 2, 4, 6, 8][preset.level];
		let placed = 0;
		let lastOrb = -Infinity;
		let previous: DashNote | null = null;
		let s = entry;
		for (const time of times) {
			const at = simulate(world, s, time, events);
			if (at.dead) break;
			const note = noteAt.get(time) ?? null;
			const add = (kind: OrbKind, dir?: number) => {
				const id = world.id();
				world.orbs.add({ id, kind, x: at.x, y: at.y, dir, x0: at.x - 0.6, x1: at.x + 0.6 });
				used(ctx, `orb-${kind}`);
			};
			let hold = mode === 'ufo' ? 70 : 90;
			if ((mode === 'ball' || mode === 'spider') && !at.grounded) {
				if (mode === 'spider') continue;
				// (green on an accent: it flips and jumps)
				add(note && strongAt(note) ? 'green' : 'blue');
			} else if (note && preset.level >= 1 && placed < most && time - lastOrb > 1100) {
				const orb = musicalOrb(note, previous, at.y);
				if (orb) {
					add(orb.kind, orb.dir);
					if (orb.hold) hold = orb.hold;
					placed++;
					lastOrb = time;
				}
			}
			events.push(...tap(time, hold));
			previous = note ?? previous;
			s = at;
		}
	}

	// The ways it may go: on time, and early and late (not for the ship, a person steers it)
	const runs: { x: number; y: number }[][] = [];
	const variants: InputEvent[][] = [events];
	if (!steered) {
		// (each press held about as long as planned: a tap shorter or longer, a dash let go a
		// bit early or late)
		const presses = events.flatMap((e, k) => {
			if (!e.down) return [];
			const up = events.slice(k + 1).find((u) => !u.down);
			return [{ at: e.time, length: (up?.time ?? e.time + 90) - e.time }];
		});
		for (const [shift, longer] of [
			[-tolerance, -30],
			[tolerance, 70],
			[-tolerance * 0.5, 70],
			[tolerance * 0.5, -30]
		]) {
			variants.push(
				presses
					.flatMap((p) =>
						tap(
							p.at + shift,
							p.length > 150
								? p.length + Math.sign(longer) * tolerance
								: Math.max(50, p.length + longer)
						)
					)
					.sort((a, b) => a.time - b.time)
			);
		}
	}
	for (const inputs of variants) {
		const trace: { x: number; y: number; time: number }[] = [];
		simulate(world, entry, section.end, inputs, { trace });
		runs.push(trace);
	}

	/** A strong moment: the bar's first beat, or a finish */
	function strongAt(note: DashNote) {
		return beatStrength(ctx.chart.timing, note.time) >= 1 || !!(note.sound & 4);
	}

	/**
	 * The orb a click takes, for what the music does there (or none): a held note a dash orb,
	 * held as long (up or down with the melody); a finish on a strong beat turns gravity around
	 * (blue, green; on the harder ones a spider orb jumps to the other side), and so does any
	 * strong beat; a leap of the melody up a yellow orb (a big one red), down a pink one (a
	 * very big one black). Not too close to the floor or ceiling.
	 */
	function musicalOrb(
		note: DashNote,
		previous: DashNote | null,
		y: number
	): { kind: OrbKind; dir?: number; hold?: number } | null {
		if (y < floor + 1.2 || y > top - 1.2) return null;
		const leap = previous ? note.height - previous.height : 0;
		const length = note.end - note.time;
		if (length >= 250 && mode !== 'spider') {
			// (straight on near the ceiling or floor: there's no room up or down there)
			const way = leap > 0.15 && y < top - 3 ? 1 : leap < -0.15 && y > floor + 3 ? -1 : 0;
			return { kind: 'dash', dir: way, hold: Math.min(700, length) };
		}
		if (strongAt(note) && note.sound & 4 && preset.level >= 2) {
			if (preset.level >= 3 && rng() < 0.35) return { kind: 'spider' };
			return { kind: rng() < 0.5 ? 'blue' : 'green' };
		}
		if (mode === 'spider') return null;
		if (strongAt(note) && preset.level >= 1) return { kind: rng() < 0.6 ? 'blue' : 'green' };
		if (leap > 0.35) return { kind: preset.level >= 2 ? 'red' : 'yellow' };
		if (leap > 0.2) return { kind: 'yellow' };
		if (leap < -0.2) return { kind: leap < -0.45 && preset.level >= 3 ? 'black' : 'pink' };
		return null;
	}

	// --- The blocks around it -------------------------------------------------------------
	// How far from the way the blocks stay: the swing and UFO drift (a person steers them back)
	const margin =
		mode === 'swing'
			? 1.1 * Math.max(0.85, tight)
			: steered
				? preset.ship - 0.45
				: mode === 'ball' || mode === 'spider'
					? 0.18
					: mode === 'ufo'
						? 0.85 * tight
						: 1.3 * tight;
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
		return phase % (preset.level >= 3 ? 12 : 7) === 6;
	};
	for (const c of columns)
		if (open(c.x) && mode !== 'ball' && mode !== 'spider') ((c.low = floor), (c.high = top));
	// A person turns the swing a moment after seeing a step in the walls: they step back around
	// each one (every column as open as the two on each side), so there's time to
	if (mode === 'swing') {
		const lows = columns.map((c) => c.low);
		const highs = columns.map((c) => c.high);
		columns.forEach((c, i) => {
			for (let k = Math.max(0, i - 2); k <= Math.min(columns.length - 1, i + 2); k++) {
				if (Math.abs(columns[k].x - c.x) > 2) continue;
				c.low = Math.min(c.low, lows[k]);
				c.high = Math.max(c.high, highs[k]);
			}
		});
	}

	// How the part is built, each its own: a tunnel around the way, pillars (the tunnel with
	// gaps), or open (nothing but spikes on the floor and ceiling, and saws in the air on the
	// strong notes, away from the way)
	const style =
		mode === 'ball' || mode === 'spider' || mode === 'swing'
			? 'tunnel'
			: shuffleByWeight(rng, [
					{ item: 'tunnel', weight: 1.2 * freshness(ctx, `${mode}-tunnel`) },
					{ item: 'pillars', weight: freshness(ctx, `${mode}-pillars`) },
					{
						item: 'open',
						weight: (preset.level >= 2 ? 0.8 : 0.35) * freshness(ctx, `${mode}-open`)
					}
				])[0];
	used(ctx, `${mode}-${style}`);
	for (const c of columns)
		if (style === 'open' || (style === 'pillars' && Math.floor((c.x - startX) / 3) % 2 === 1)) {
			c.low = floor;
			c.high = top;
		}

	// Spikes on the surfaces where there's room, in little rows that start on the strong notes
	// (the beats in between now and then)
	const strong = new Set<number>();
	for (const note of notes) {
		const accent = beatStrength(ctx.chart.timing, note.time) + (note.sound & 4 ? 0.5 : 0);
		if (accent >= 0.65) strong.add(Math.floor(world.xAt(note.time)));
	}
	// (the swing's spikes only where there's a lot of room: a person turns it a bit late)
	const spikeRoom = mode === 'swing' ? 1.6 : 1.05;
	const pickSpikes = () => {
		for (const c of columns) c.spike = 0;
		let run = 0;
		for (const c of columns) {
			const lowRoom = roomAbove(c);
			const highRoom = roomBelow(c);
			if (run > 0) {
				run--;
				const side = columns[columns.indexOf(c) - 1]?.spike ?? 0;
				if (side === 1 && lowRoom > spikeRoom) c.spike = 1;
				else if (side === -1 && highRoom > spikeRoom) c.spike = -1;
				continue;
			}
			const chance = mode === 'swing' ? 0.2 : steered ? 0.14 : mode === 'spider' ? 0.45 : 0.25;
			const often = chance * spiky;
			if (rng() > (strong.has(c.x) ? Math.min(0.9, often * 3) : often * 0.3)) continue;
			const choices = shuffleByWeight(rng, [
				{ item: 1 as const, weight: lowRoom > spikeRoom ? 1 : 0 },
				{ item: -1 as const, weight: highRoom > spikeRoom ? 1 : 0 }
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
	const saws: Hazard[] = [];
	if (style === 'open')
		for (const note of notes) {
			const x = world.xAt(note.time);
			if (!strongAt(note) || x < startX + 2 || x > endX - 2) continue;
			if (saws.some((saw) => Math.abs(saw.x - x) < 4)) continue;
			// In the larger room above or below the way there (off the floor's and ceiling's spikes)
			let low = Infinity;
			let high = -Infinity;
			for (const trace of runs)
				for (const p of trace)
					if (Math.abs(p.x - x) < box.w + 1.2) {
						low = Math.min(low, p.y - box.h);
						high = Math.max(high, p.y + box.h);
					}
			if (!isFinite(low)) continue;
			const radius = 0.7;
			const reach = radius * 0.72 + 0.6 * tight;
			const below = low - reach - (floor + 1.2);
			const above = top - 1.2 - (high + reach);
			const y =
				above >= below && above > 0
					? high + reach + above / 2
					: below > 0
						? floor + 1.2 + below / 2
						: null;
			if (y !== null) saws.push(world.saw(x, y, radius));
		}
	if (saws.length) used(ctx, 'saws');

	// --- Checked: on time, early and late; where it crashes, more room -------------------------
	for (let attempt = 0; attempt < 40; attempt++) {
		let failed: PlayerState | null = null;
		if (!legalAround(world, startX - 1, endX + 1)) {
			// A spike broke a rule: the spikes go
			for (const c of columns) c.spike = 0;
			build();
		}
		for (const inputs of steered ? [] : variants) {
			const run = simulate(world, entry, section.end, inputs);
			if (run.dead) {
				failed = run;
				break;
			}
		}
		if (steered) {
			// The way it was built around first; where that crashes, the middle of the room
			const flown = flyShip(
				ctx,
				entry,
				section.end,
				(x) => {
					const c = columns.find((col) => col.x === Math.floor(x));
					if (!c || attempt === 0) return follow(x);
					const low = c.low + (c.spike === 1 ? 1 : 0);
					const high = c.high - (c.spike === -1 ? 1 : 0);
					return clamp(follow(x), low + 1.2, high - 1.2);
				},
				music
			);
			events = flown.events;
			if (flown.end.dead) failed = flown.end;
			// The swing as a person flies it: turning a moment after seeing it should, wherever
			// the room is (where that crashes, more room too)
			if (!failed && mode === 'swing') {
				const person = flyShip(
					ctx,
					entry,
					section.end,
					(x) => {
						const c = columns.find((col) => col.x === Math.floor(x));
						if (!c) return follow(x);
						return (c.low + (c.spike === 1 ? 1 : 0) + c.high - (c.spike === -1 ? 1 : 0)) / 2;
					},
					[],
					60
				);
				if (person.end.dead) failed = person.end;
			}
		}
		if (!failed) break;
		for (const saw of saws.filter((s) => Math.abs(s.x - failed!.x) < 3)) {
			world.hazards.remove(saw);
			saws.splice(saws.indexOf(saw), 1);
		}
		const near = columns.filter((c) => Math.abs(c.x + 0.5 - failed!.x) < 3);
		if (!near.length) break;
		for (const c of near) {
			c.spike = 0;
			if (attempt > 30 && !steered) {
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
