// The parts between a floor and a ceiling: ship, UFO, swing, ball and spider. Gravity portals
// on strong downbeats turn some of them upside down for a while, and some clicks take an orb
// (blue and green turn gravity around, the others jump). The way through is played first
// (the clicks on the notes; the ship follows phrases and audio energy, the swing turns around on
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
	type GravityPortal,
	type Hazard,
	type InputEvent,
	type Orb,
	type OrbKind,
	type PlayerState,
	type Section,
	type Solid
} from '../physics';
import {
	byIntensity,
	clamp,
	gravityIn,
	jittered,
	legalAround,
	shuffleByWeight,
	tap,
	used,
	type Context
} from '../build';
import { beatStrength, type DashNote } from '../chart';
import { composePhrases, musicalPosition, musicalRest } from '../composition';
import { hitAt, loudness } from '../audio';

interface Column {
	x: number;
	low: number;
	high: number;
	spike: 0 | 1 | -1;
	/** A small spike (in a tight tunnel: only what slides along the surface touches it) */
	small?: boolean;
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
	delay = 0,
	/** The ship's orbs: a fresh press there (and the first time, the orb put where it is then) */
	orbAt: ShipOrb[] = []
) {
	const { world } = ctx;
	const s = copyState(from);
	const events: InputEvent[] = [];
	let lastChange = ctx.plan.filter((e) => e.down).at(-1)?.time ?? -1e9;
	let beat = 0;
	/** A turn it decided on, when it comes (-1: none) */
	let pending = -1;
	let orb = 0;
	while (orb < orbAt.length && orbAt[orb].time < s.time) orb++;
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
		} else if (orb < orbAt.length && next >= orbAt[orb].time - (s.held ? STEP : 0)) {
			// An orb: let go a step before if held, then pressed on it
			if (s.held) {
				press(s, false);
				events.push({ time: next, down: false });
			} else {
				orbAt[orb].place?.(world.xAt(next), s.y);
				press(s, true);
				events.push({ time: next, down: true });
				lastChange = next;
				orb++;
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

/** An orb on the ship's way: when, and (the first flight) how to put it there */
interface ShipOrb {
	time: number;
	place?: (x: number, y: number) => void;
	orb?: Orb;
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
	const startX = world.xAt(section.start + 300);
	const endX = world.xAt(section.end - 300);

	// How hard: room around the way, spikes, breathers
	const intensity = section.intensity ?? 0.5;
	const tight = preset.tight * (1.15 - intensity * 0.3);
	// How much the hard levels close the parts in where it's intense (0 on easy and normal):
	// narrower walls, straighter flying, fewer open stretches
	const close = Math.max(0, (preset.level - 1) / 3) * (0.4 + intensity * 0.6);

	// --- Gravity portals: on strong downbeats, upside down and back -------------------------
	const flips: GravityPortal[] = [];
	// (not right at a click: pressed a moment before or after the portal would go another way)
	if (
		preset.level >= 1 &&
		gravityIn(ctx, mode) &&
		rng() < preset.flips * (mode === 'swing' ? 0.7 : 1)
	) {
		let gravity: 1 | -1 = -1;
		let last = -Infinity;
		let count = 0;
		// On the downbeats of every other bar (a note there, or the beat itself), the strong ones
		// first
		const downbeats: number[] = [];
		for (const point of ctx.chart.timing) {
			const bar = point.beatLength * point.meter;
			const until = Math.min(
				section.end,
				ctx.chart.timing.find((p) => p.time > point.time)?.time ?? Infinity
			);
			for (
				let t = point.time + Math.max(0, Math.ceil((section.start - point.time) / bar)) * bar;
				t < until;
				t += bar
			)
				downbeats.push(t);
		}
		for (const t of downbeats.sort((p, q) => p - q)) {
			if (count >= preset.level) break;
			const x = world.xAt(t);
			if (x < startX + 4 || x > endX - 6 || t - last < 2400) continue;
			const pos = musicalPosition(ctx.chart, t + 1);
			if (
				pos.bar % 2 !== 0 ||
				musicalRest(ctx.chart, t) ||
				clicks.some((c) => Math.abs(c - t) < 160) ||
				rng() < 0.25
			)
				continue;
			flips.push(
				world.gravityPortals.add({ x, y: (floor + top) / 2, gravity, x0: x - 0.6, x1: x + 0.6 })
			);
			gravity = gravity > 0 ? -1 : 1;
			last = t;
			count++;
		}
		if (count) used(ctx, 'gravity');
	}

	// --- The way through ---------------------------------------------------------------
	let events: InputEvent[] = [];
	const orbs: Orb[] = [];
	const shipOrbs: ShipOrb[] = [];
	/** The spider's jumps on an orb (from the ground) */
	const jumpOrbs: { time: number; x: number; y: number; gravity: 1 | -1; orb: Orb }[] = [];
	let follow: (x: number) => number = () => top / 2;
	const steered = mode === 'ship' || mode === 'swing';
	const music = mode === 'swing' ? onTheMusic(ctx, section, notes) : [];
	if (steered) {
		// A two-bar contour follows the measured energy envelope, never osu! playfield height
		const keys: { x: number; y: number }[] = [{ x: section.x0, y: clamp(entry.y, 2, top - 2) }];
		const margin = preset.ship + 0.4;
		for (const note of notes) {
			const x = world.xAt(note.time);
			if (x < startX + 2 || x > endX) continue;
			const last = keys[keys.length - 1];
			if (x - last.x < 2.5) continue;
			// (the swing in a narrower band: it swings around its way; the ship straighter, in a
			// tight corridor, the harder it is)
			const band = mode === 'swing' ? 0.28 + close * 0.3 : 1 - close * 0.55;
			const pos = musicalPosition(ctx.chart, note.time);
			const phase = clamp((note.time - pos.start) / (pos.end - pos.start), 0, 1);
			const energy = ctx.chart.sound
				? clamp(loudness(ctx.chart.sound, note.time - 250, note.time + 250) - 0.5, -0.5, 0.5)
				: 0;
			const contour = Math.sin(phase * Math.PI * 2) * 0.25 + energy * 0.5;
			const y = (floor + top) / 2 + contour * (top - floor - 2 * margin) * band;
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
		// Orbs on the ship's way, on strong notes: a yellow one throws it up at once, a black one
		// down, and the way goes with it (holding alone isn't that fast: without the orb it's
		// into the wall)
		if (mode === 'ship' && preset.level >= 1) {
			const most = Math.min(4, Math.round(preset.orbs * (0.4 + intensity * 0.5)));
			let last = -Infinity;
			let shift = 0;
			const jumps: { x: number; by: number }[] = [];
			for (const note of notes) {
				if (shipOrbs.length >= most) break;
				const x = world.xAt(note.time);
				if (x < startX + 4 || x > endX - 6 || note.time - last < 1500) continue;
				if (!strongAt(note) || musicalRest(ctx.chart, note.time) || rng() < 0.35) continue;
				const y = path(x) + shift;
				const size = preset.level >= 2 ? 2.5 : 2;
				const up = y + size < top - 2 && (y < (floor + top) / 2 || y - size < floor + 2);
				if (!up && y - size < floor + 2) continue;
				const kind: OrbKind = up ? 'yellow' : 'black';
				const by = up ? size : -size;
				shift += by;
				jumps.push({ x, by });
				last = note.time;
				const so: ShipOrb = { time: note.time };
				so.place = (ox, oy) => {
					const id = world.id();
					so.orb = world.orbs.add({
						id,
						kind,
						x: ox,
						y: Math.round(oy * 2) / 2,
						x0: ox - 0.6,
						x1: ox + 0.6
					});
					used(ctx, `ship-orb-${kind}`);
				};
				shipOrbs.push(so);
			}
			if (jumps.length)
				follow = (x: number) => {
					let y = path(x);
					// (each jump in a moment: a fifth of a block on)
					for (const j of jumps) y += j.by * clamp((x - j.x) / (speed * 0.12), 0, 1);
					return clamp(y, floor + 1.6, top - 1.6);
				};
			else follow = path;
		} else follow = path;
		events = flyShip(ctx, entry, section.end, follow, music, 0, shipOrbs).events;
		for (const o of shipOrbs) o.place = undefined;
	} else {
		// The clicks; the ball and the spider only switch on a surface, else a blue orb does it.
		// Some clicks take an orb, for what the music does there (see musicalOrb)
		const times = clicks.filter(
			// (not right at the end: a click a bit off would land in the next part's first obstacle)
			(t) =>
				t > section.start + 250 &&
				t < section.end - (mode === 'ball' || mode === 'spider' ? 700 : 450) &&
				!musicalRest(ctx.chart, t)
		);
		const noteAt = new Map(notes.map((n) => [n.time, n]));
		const most = Math.round(preset.orbs * (0.6 + intensity * 0.6));
		let placed = 0;
		let lastOrb = -Infinity;
		let previous: DashNote | null = null;
		let airborneUntil = -Infinity;
		let s = entry;
		for (const time of times) {
			const at = simulate(world, s, time, events);
			if (at.dead) break;
			const note = noteAt.get(time) ?? null;
			const add = (kind: OrbKind, dir?: number) => {
				const id = world.id();
				orbs.push(
					world.orbs.add({ id, kind, x: at.x, y: at.y, dir, x0: at.x - 0.6, x1: at.x + 0.6 })
				);
				used(ctx, `orb-${kind}`);
			};
			let hold = mode === 'ufo' ? 70 : 90;
			// (the notes while it's in the air after an orb jump go by)
			if (time < airborneUntil) continue;
			if (
				mode === 'spider' &&
				at.grounded &&
				preset.level >= 1 &&
				placed < most &&
				time - lastOrb > 900 &&
				section.end - time > 1500 &&
				rng() < 0.35 + intensity * 0.3
			) {
				// An orb on the ground: a jump over spikes on its side, where switching sides
				// would land it on a spike (the orb must be used)
				const room = top - floor;
				const red = !!note && strongAt(note) && room >= 6 && rng() < 0.4;
				add(red ? 'red' : 'yellow');
				airborneUntil = time + (red ? 820 : 660);
				jumpOrbs.push({ time, x: at.x, y: at.y, gravity: at.gravity, orb: orbs[orbs.length - 1] });
				placed++;
				lastOrb = time;
			} else if ((mode === 'ball' || mode === 'spider') && !at.grounded) {
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
	const runs: { x: number; y: number; time: number }[][] = [];
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
	// (and each press a bit early or late on its own, as a person plays it)
	if (!steered)
		variants.push(...jittered(events, tolerance * 0.75, section.index * 31 + 7, 4).slice(2));
	for (const inputs of variants) {
		const trace: { x: number; y: number; time: number }[] = [];
		simulate(world, entry, section.end, inputs, { trace });
		runs.push(trace);
	}
	// The gravity portals where the player goes through them (not in the walls)
	for (const portal of flips) {
		const near = runs[0].reduce(
			(best, p) => (Math.abs(p.x - portal.x) < Math.abs(best.x - portal.x) ? p : best),
			runs[0][0] ?? { x: portal.x, y: portal.y }
		);
		portal.y = clamp(near.y, floor + 1.6, top - 1.6);
	}

	/** A strong moment: the bar's first beat, or a finish */
	function strongAt(note: DashNote) {
		return beatStrength(ctx.chart.timing, note.time) >= 1 || !!(note.sound & 4);
	}

	/** Held notes sustain a dash; transient changes select accent impulses. No pitch is inferred. */
	function musicalOrb(
		note: DashNote,
		previous: DashNote | null,
		y: number
	): { kind: OrbKind; dir?: number; hold?: number } | null {
		if (y < floor + 1.2 || y > top - 1.2) return null;
		const strength = (n: DashNote) =>
			ctx.chart.sound ? hitAt(ctx.chart.sound, n.time) : n.volume + (n.sound & 4 ? 0.3 : 0);
		const leap = previous ? strength(note) - strength(previous) : 0;
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
	// Architectural spans follow whole musical beats (half beats where it's built closer). A wall
	// is planned across the whole span before rendering blocks, not fitted independently to each
	// pixel of flight.
	const division = close > 0.5 ? 2 : 1;
	const narrowest = close > 0.3 ? 1 : 2;
	const anchors = new Set<number>([Math.ceil(startX)]);
	for (const point of ctx.chart.timing) {
		const from = Math.max(section.start + 450, point.time);
		const until = Math.min(
			section.end - 450,
			ctx.chart.timing.find((p) => p.time > point.time)?.time ?? Infinity
		);
		const span = point.beatLength / division;
		for (let t = point.time + Math.ceil((from - point.time) / span) * span; t < until; t += span)
			anchors.add(Math.round(world.xAt(t)));
	}
	const boundaries: number[] = [];
	for (const x of [...anchors].sort((a, b) => a - b))
		if (
			x >= Math.ceil(startX) &&
			x <= Math.floor(endX) - narrowest &&
			(!boundaries.length || x - boundaries[boundaries.length - 1] >= narrowest)
		)
			boundaries.push(x);
	boundaries.push(Math.floor(endX));
	const columns: Column[] = [];
	for (let n = 1; n < boundaries.length; n++) {
		const x = boundaries[n - 1],
			end = boundaries[n];
		let lowest = Infinity,
			highest = -Infinity;
		for (const trace of runs)
			for (const p of trace) {
				if (p.x < x - box.w - 0.3 || p.x > end + box.w + 0.3) continue;
				lowest = Math.min(lowest, p.y - box.h);
				highest = Math.max(highest, p.y + box.h);
			}
		if (!isFinite(lowest)) continue;
		// (on the grid of half blocks where it's built closer)
		const grid = close > 0.3 ? 2 : 1;
		const low = clamp(Math.floor((lowest - margin) * grid) / grid, floor, floor + cap),
			high = clamp(Math.ceil((highest + margin) * grid) / grid, top - cap, top);
		for (let cell = x; cell < end; cell++) columns.push({ x: cell, low, high, spike: 0 });
	}

	// Give the end of each two-bar phrase room (each four-bar one where it's built closer: a
	// breath, not a gap every few seconds); declared rests are completely open.
	const every = close > 0.45 ? 4 : 2;
	const open = (x: number) => {
		const time = world.timeAt(x + 0.5);
		const pos = musicalPosition(ctx.chart, time);
		return (
			musicalRest(ctx.chart, time) ||
			(pos.bar % every === every - 1 && pos.inBar > pos.point.meter - 0.75)
		);
	};
	for (const c of columns)
		if (
			musicalRest(ctx.chart, world.timeAt(c.x)) ||
			(open(c.x) && mode !== 'ball' && mode !== 'spider')
		) {
			c.low = floor;
			c.high = top;
		}
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
	const themes = composePhrases(
		ctx.chart,
		notes.map((n) => n.time)
	);
	const style =
		mode === 'ball' || mode === 'spider' || mode === 'swing'
			? 'tunnel'
			: themes.filter((p) => p.theme === 'steps').length > themes.length / 2
				? 'pillars'
				: themes.length > 0 && themes.every((p) => p.theme === 'pulse') && close < 0.5
					? 'open'
					: 'tunnel';
	used(ctx, `${mode}-${style}`);
	for (const c of columns)
		if (
			style === 'open' ||
			(style === 'pillars' &&
				((musicalPosition(ctx.chart, world.timeAt(c.x)).beat % 2) + 2) % 2 > 1.1 + close * 0.6)
		) {
			c.low = floor;
			c.high = top;
		}
	// The ship between a tight tunnel and a slalom, phrase by phrase: in a slalom the tunnel is
	// wide but for pillars on the accents, from the floor and from the ceiling by turns, up to near
	// the way (around them it flies)
	if (mode === 'ship' && style === 'tunnel' && preset.level >= 1) {
		const accents = notes
			.filter((n) => strongAt(n) || beatStrength(ctx.chart.timing, n.time) >= 0.65)
			.map((n) => world.xAt(n.time));
		const slalom = new Map<string, boolean>();
		let pillar = rng() < 0.5 ? 1 : -1;
		let lastPillar = -Infinity;
		for (const c of columns) {
			const pos = musicalPosition(ctx.chart, world.timeAt(c.x + 0.5));
			if (!slalom.has(pos.key))
				slalom.set(
					pos.key,
					rng() < (0.25 + (1 - intensity) * 0.25) * (preset.level >= 3 ? 0.6 : 1)
				);
			if (!slalom.get(pos.key)) continue;
			const accent = accents.some((ax) => Math.abs(ax - (c.x + 0.5)) < 1.1);
			if (accent && c.x - lastPillar >= 3) {
				// (a pillar here, the other side open; the next one from the other side)
				if (pillar > 0) c.high = top;
				else c.low = floor;
				pillar = -pillar;
				lastPillar = c.x;
			} else if (!accent || c.x - lastPillar > 1) {
				// (between the pillars a wide tunnel: two blocks more room each way)
				c.low = Math.max(floor, c.low - 2);
				c.high = Math.min(top, c.high + 2);
			} else if (pillar < 0) c.high = top;
			else c.low = floor;
		}
		if ([...slalom.values()].some(Boolean)) used(ctx, 'ship-slalom');
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
		for (let i = 0; i < columns.length; i++) {
			const c = columns[i];
			if (musicalRest(ctx.chart, world.timeAt(c.x + 0.5))) {
				run = 0;
				continue;
			}
			const lowRoom = roomAbove(c),
				highRoom = roomBelow(c);
			if (run > 0) {
				run--;
				const side = columns[i - 1]?.spike ?? 0;
				if (side === 1 && lowRoom > spikeRoom) c.spike = 1;
				else if (side === -1 && highRoom > spikeRoom) c.spike = -1;
				continue;
			}
			if (!strong.has(c.x)) continue;
			if (lowRoom >= highRoom && lowRoom > spikeRoom) c.spike = 1;
			else if (highRoom > spikeRoom) c.spike = -1;
			// (rows of one to three, by chance)
			if (c.spike) run = Math.floor(rng() * (preset.level >= 2 ? 3 : 2));
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
	timingSpikes();
	orbJumpSpikes();

	/**
	 * The rules of a clean level, kept by what breaks them going (not every spike: one orb in a
	 * step of the stairs used to take all the spikes of the part with it)
	 */
	function keepRules() {
		for (let round = 0; round < 4 && !legalAround(world, startX - 1, endX + 1); round++) {
			for (const c of columns)
				if (c.spike && !legalAround(world, c.x - 0.5, c.x + 1.5)) {
					c.spike = 0;
					c.small = false;
				}
			// An orb in a block, or right at a spike: the orb goes
			for (const orb of orbs)
				if (world.orbs.items.includes(orb) && !legalAround(world, orb.x - 0.6, orb.x + 0.6))
					world.orbs.remove(orb);
			build();
		}
		if (!legalAround(world, startX - 1, endX + 1)) {
			// (still: the spikes go after all)
			for (const c of columns) c.spike = 0;
			build();
		}
	}

	/**
	 * The spider's orb jumps: spikes on its side under the jump (without the press it runs into
	 * them), and one on the other side just past where it is then (a plain switch lands on it)
	 */
	function orbJumpSpikes() {
		for (const j of jumpOrbs) {
			const trace = runs[0];
			const k = trace.findIndex((p) => p.time >= j.time + 100);
			if (k < 0) continue;
			// Where it's down on its side again
			let land = -1;
			for (let n = k; n < trace.length && trace[n].time < j.time + 1500; n++)
				if (Math.abs(trace[n].y - j.y) < 0.05) {
					land = n;
					break;
				}
			if (land < 0) continue;
			const side: 1 | -1 = j.gravity > 0 ? 1 : -1;
			const from = Math.floor(j.x + 1.3);
			const to = Math.floor(trace[land].x - 1.5);
			let put = 0;
			for (let cx = from; cx <= to && put < 3; cx++) {
				const c = columns.find((col) => col.x === cx);
				if (!c || c.spike) continue;
				// (in the middle of the jump, two or three)
				if (cx < (from + to) / 2 - 1.5 || cx > (from + to) / 2 + 1.5) continue;
				c.spike = side;
				put++;
			}
			const other = columns.find((col) => col.x === Math.floor(j.x + 0.8));
			if (other && !other.spike) other.spike = side > 0 ? -1 : 1;
		}
		if (jumpOrbs.length) used(ctx, 'spider-orb-jump');
	}

	/**
	 * Stairs for the spider and the ball: while it's on one side, the other side moves up or down
	 * a step or a few (in the middle of its stay there, away from where it got there and where it
	 * leaves), so the switches go different distances and the surfaces climb and fall like
	 * stairs, with the music (up where it gets more intense). False when nothing was changed.
	 */
	function stairs() {
		if ((mode !== 'spider' && mode !== 'ball') || preset.level < 1 || !columns.length) return false;
		const middle = (floor + top) / 2;
		// Where it is on which side (the ball's way across counts to the side it's going to)
		const stays: { x0: number; x1: number; ceiling: boolean }[] = [];
		for (const p of runs[0]) {
			if (p.x < startX || p.x > endX) continue;
			const ceiling = p.y > middle;
			const last = stays[stays.length - 1];
			if (last && last.ceiling === ceiling) last.x1 = p.x;
			else stays.push({ x0: p.x, x1: p.x, ceiling });
		}
		const gapMin = mode === 'spider' ? 3 : 3.5;
		const most = preset.level >= 3 ? 3 : 2;
		const reach = Math.min(4, Math.floor((top - floor - gapMin) / 2));
		const margin = 1.2 + (speed * tolerance * 1.5) / 1000;
		let low = floor;
		let high = top;
		let changed = false;
		for (const stay of stays) {
			const from = stay.x0 + margin + (mode === 'ball' ? speed * 0.25 : 0);
			const to = stay.x1 - margin;
			if (to - from < 2 || musicalRest(ctx.chart, world.timeAt((from + to) / 2))) continue;
			// (now and then the same height again: not every stay a step)
			if (rng() < 0.25) continue;
			const at = Math.round((from + to) / 2);
			const energy = ctx.chart.sound
				? loudness(ctx.chart.sound, world.timeAt(at) - 400, world.timeAt(at) + 400) - 0.5
				: 0;
			const size = 1 + Math.floor(rng() * most);
			const way = rng() < 0.5 + energy * 0.6 ? 1 : -1;
			// (up or down a step; where that's past how far it may go, the other way)
			const move = (now: number, lowest: number, highest: number, by: number) => {
				const next = clamp(now + by, lowest, highest);
				return next !== now ? next : clamp(now - by, lowest, highest);
			};
			if (stay.ceiling) {
				// On the ceiling: the floor moves
				const next = move(low, floor, Math.min(floor + reach, high - gapMin), way * size);
				if (next === low) continue;
				low = next;
				for (const c of columns) if (c.x >= at) c.low = low;
			} else {
				const next = move(high, Math.max(top - reach, low + gapMin), top, -way * size);
				if (next === high) continue;
				high = next;
				for (const c of columns) if (c.x >= at) c.high = high;
			}
			changed = true;
		}
		if (changed) used(ctx, `${mode}-stairs`);
		return changed;
	}

	/**
	 * The ball and the spider switch from one side to the other on a click: a spike on the side it
	 * leaves, as far after where it leaves as a late click may come, and one on the side it gets
	 * to, as far before where it gets there as an early click may come. So each click has about
	 * the room the difficulty asks for there, not the whole stretch between two spikes.
	 */
	function timingSpikes() {
		if ((mode !== 'ball' && mode !== 'spider') || preset.level < 1) return;
		const aim = Math.max(2 * tolerance + 12, byIntensity(preset.window, intensity));
		const trace = runs[0];
		const cell = (x: number) => columns.find((c) => c.x === Math.floor(x));
		const brush = 0.6 + speed * (mode === 'ball' ? 0.04 : 0.01);
		for (const e of events) {
			if (!e.down) continue;
			const k = trace.findIndex((p) => p.time >= e.time);
			if (k < 1) continue;
			const from = trace[k - 1];
			// Where it gets to the other side: the next point it's on a surface again
			let land = -1;
			for (let n = k; n < trace.length && trace[n].time < e.time + 900; n++) {
				const moved = Math.abs(trace[n].y - from.y) > 1;
				const still = n + 1 < trace.length && Math.abs(trace[n + 1].y - trace[n].y) < 1e-6;
				if (moved && still) {
					land = n;
					break;
				}
			}
			if (land < 0) continue;
			const up = trace[land].y > from.y;
			const share = 0.35 + rng() * 0.3;
			const spare = Math.max(0, aim - 2 * tolerance - 30);
			const late = (speed * (tolerance + spare * share)) / 1000;
			const early = (speed * (tolerance + spare * (1 - share))) / 1000;
			const leave = cell(from.x + late + brush);
			const reach = cell(trace[land].x - early - brush);
			// (on the surface it's on, if there's nothing on that column yet)
			if (leave && !leave.spike && !musicalRest(ctx.chart, world.timeAt(leave.x + 0.5)))
				leave.spike = up ? 1 : -1;
			if (reach && !reach.spike && reach.x > from.x + 1) reach.spike = up ? -1 : 1;
		}
	}

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
			const kind = c.small ? 'small' : 'spike';
			if (c.spike === 1 && c.low > floor - 1)
				made.spikes.push(world.spike(c.x + 0.5, c.low, 1, kind));
			if (c.spike === -1) made.spikes.push(world.spike(c.x + 0.5, c.high, -1, kind));
		}
	};
	build();
	if (stairs()) {
		// The ways again, over the stairs, and the spikes for them (the orbs on the ground on the
		// surface where it is now)
		build();
		for (const j of jumpOrbs) {
			const c = columns.find((col) => col.x === Math.floor(j.x));
			if (!c) continue;
			j.y = j.gravity > 0 ? c.low + box.h : c.high - box.h;
			j.orb.y = j.y;
		}
		runs.length = 0;
		for (const inputs of variants) {
			const trace: { x: number; y: number; time: number }[] = [];
			simulate(world, entry, section.end, inputs, { trace });
			runs.push(trace);
		}
		pickSpikes();
		timingSpikes();
		orbJumpSpikes();
		build();
	}
	const saws: Hazard[] = [];
	if (style === 'open' || (close > 0.35 && mode !== 'spider' && mode !== 'swing'))
		for (const note of notes) {
			const x = world.xAt(note.time);
			if (!strongAt(note) || x < startX + 2 || x > endX - 2 || musicalRest(ctx.chart, note.time))
				continue;
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
			let y: number | null = null;
			if (style === 'open') {
				const below = low - reach - (floor + 1.2);
				const above = top - 1.2 - (high + reach);
				y =
					above >= below && above > 0
						? high + reach + above / 2
						: below > 0
							? floor + 1.2 + below / 2
							: null;
			} else {
				// Half sunk into the wall on the side with more room, its blade toward the way
				const here = columns.filter((c) => Math.abs(c.x + 0.5 - x) <= 1);
				if (!here.length) continue;
				const wallLow = Math.max(...here.map((c) => c.low));
				const wallHigh = Math.min(...here.map((c) => c.high));
				const up = wallHigh < top && wallHigh - (high + reach) >= 0;
				const down = wallLow > floor && low - reach - wallLow >= 0;
				y = up && (!down || wallHigh - high >= low - wallLow) ? wallHigh : down ? wallLow : null;
				if (y !== null && here.some((c) => c.spike)) y = null;
			}
			if (y !== null) saws.push(world.saw(x, y, radius));
		}
	if (saws.length) used(ctx, 'saws');

	// --- Checked: on time, early and late; where it crashes, more room -------------------------
	/** Played the ways it may be played (steered: flown again); where it crashes, if it does */
	const verify = (attempt: number) => {
		let failed: PlayerState | null = null;
		if (!legalAround(world, startX - 1, endX + 1)) keepRules();
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
				music,
				0,
				shipOrbs
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
			// Clicked on the music like the other parts: each turn a bit early or late (the rest on
			// time), and all of them early or late (where that crashes, more room too)
			if (!failed && mode === 'swing')
				for (const inputs of jittered(events, tolerance * 0.75, section.index)) {
					const run = simulate(world, entry, section.end, inputs);
					if (run.dead) {
						failed = run;
						break;
					}
				}
		}
		// Each press alone a bit early or late, the others on time (as a click's room is measured:
		// see validate.ts), through the obstacle after the next press
		if (!failed && !steered) {
			let state = entry;
			for (let k = 0; k < events.length && !failed; k++) {
				const e = events[k];
				if (!e.down) continue;
				const release = events.findIndex((u, n) => n > k && !u.down);
				const after = events.find((u, n) => n > k && u.down);
				const until = Math.min(section.end, (after?.time ?? e.time + 1000) + 400);
				state = simulate(world, state, Math.max(state.time, e.time - tolerance - 20), events);
				if (state.dead) break;
				// (half the tolerance and three quarters of it; every step in between is checked once
				// more on the finished level: see generate.ts, clickRoom)
				for (const shift of [0.5, 0.75].flatMap((f) => [-f * tolerance, f * tolerance])) {
					const inputs = events
						.map((u, n) => (n === k || n === release ? { ...u, time: u.time + shift } : u))
						.sort((p, q) => p.time - q.time);
					const run = simulate(world, state, until, inputs);
					if (run.dead) {
						failed = run;
						break;
					}
				}
			}
		}
		return failed;
	};
	/** The attempt whose way was played through (checked again the same way later) */
	let settled = 0;
	for (let attempt = 0; attempt < 40; attempt++) {
		settled = attempt;
		const failed = verify(attempt);
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
	noResting();

	/**
	 * Nowhere to rest, every click needed: from each click on, doing nothing (the ship also:
	 * holding on) must not get it through by riding along a floor, ceiling or wall for long; and
	 * a click of the UFO, ball or spider left out must not either. Where it would, a spike on that
	 * surface, where the way itself keeps clear of it (checked again with all the ways it may be
	 * played; a spike that breaks one goes again).
	 */
	function noResting() {
		if (preset.level < 1 || mode === 'wave') return;
		const trace: { x: number; y: number; time: number }[] = [];
		simulate(world, entry, section.end, events, { trace });
		const ways = [...runs, trace];
		const room = (c: Column, side: 1 | -1) => {
			let near = Infinity;
			for (const way of ways)
				for (const p of way)
					if (Math.abs(p.x - (c.x + 0.5)) < box.w + 0.35)
						near = Math.min(near, side > 0 ? p.y - box.h - c.low : c.high - (p.y + box.h));
			return near;
		};
		const need = mode === 'swing' ? 1.25 : 1.05;
		// (where it crashed already before: not a reason to take a spike away again)
		const before = verify(settled);
		const known = (failed: PlayerState) => !!before && Math.abs(failed.x - before.x) < 1.5;
		/** What was changed on a column: a spike, or its surface a half block closer (a bump) */
		const added: { c: Column; spike: boolean; side: 1 | -1 }[] = [];
		const undo = (a: (typeof added)[number]) => {
			if (a.spike) {
				a.c.spike = 0;
				a.c.small = false;
			} else if (a.side > 0) a.c.low -= 0.5;
			else a.c.high += 0.5;
		};
		for (let pass = 0; pass < 4; pass++) {
			let changed = false;
			let state = entry;
			for (let k = 0; k < events.length; k++) {
				const e = events[k];
				if (!e.down || e.time < section.start + 250) continue;
				if (e.time > section.end - (steered ? 1200 : 400)) continue;
				if (steered) {
					state = simulate(world, state, e.time, events);
				} else {
					// (just before this click: the ride is without it)
					state = simulate(world, state, Math.max(state.time, e.time - 20), events);
				}
				if (state.dead) break;
				for (const hold of mode === 'ship' ? [false, true] : [false]) {
					const ride: { x: number; y: number; time: number }[] = [];
					let survived: boolean;
					if (steered) {
						// (the button as it is then: let go, or held on; and nothing more)
						const from = { ...state, used: [...state.used], held: hold, buffered: false };
						const until = Math.min(section.end - 300, e.time + 1600);
						survived = !simulate(world, from, until, [], { trace: ride }).dead;
					} else {
						// This click left out (and its letting go), the others as they are
						const release = events.findIndex((u, n) => n > k && !u.down);
						const after = events.find((u, n) => n > k && u.down);
						const inputs = events.filter((_, n) => n !== k && n !== release);
						const until = Math.min(
							section.end - 250,
							e.time + 1500,
							(after?.time ?? Infinity) + 500
						);
						survived = !simulate(world, state, until, inputs, { trace: ride }).dead;
					}
					if (!survived) continue;
					// Where it rode along a surface, the way well clear of that surface there
					for (const p of ride) {
						const settle = mode === 'spider' || mode === 'ball' ? 120 : 250;
						if (p.time < e.time + settle || musicalRest(ctx.chart, p.time)) continue;
						const c = columns.find((col) => col.x === Math.floor(p.x));
						if (!c || c.spike || added.some((a) => a.c === c)) continue;
						const side: 0 | 1 | -1 =
							p.y - box.h - c.low < 0.05 ? 1 : c.high - (p.y + box.h) < 0.05 ? -1 : 0;
						if (!side) continue;
						const clear = room(c, side);
						if (clear >= need) {
							c.spike = side;
							added.push({ c, spike: true, side });
						} else if (clear >= 0.42) {
							// (little room: a small spike, only what slides along touches it)
							c.spike = side;
							c.small = true;
							added.push({ c, spike: true, side });
						} else if (clear >= 0.85 && c.high - c.low >= 2.5) {
							// (no room for a spike: a step in the surface it slides along)
							if (side > 0) c.low += 0.5;
							else c.high -= 0.5;
							added.push({ c, spike: false, side });
						} else continue;
						changed = true;
						break;
					}
				}
			}
			if (!changed) break;
			build();
			// Still played every way it may be: a spike in the way of one goes again
			for (let k = 0; k < 16; k++) {
				const failed = verify(settled);
				if (!failed || known(failed)) break;
				const gone = added.filter((a) => Math.abs(a.c.x + 0.5 - failed.x) < 3);
				if (!gone.length) {
					for (const a of added) undo(a);
					added.length = 0;
					build();
					verify(settled);
					return;
				}
				for (const a of gone) {
					undo(a);
					added.splice(added.indexOf(a), 1);
				}
				build();
			}
		}
		if (added.length) used(ctx, `${mode}-unrested`);
	}
	// The ship's orbs: each one needed. Flown without it (and without the press for it), it
	// mustn't get through, else it goes
	if (shipOrbs.length) {
		for (const so of [...shipOrbs]) {
			if (!so.orb) {
				shipOrbs.splice(shipOrbs.indexOf(so), 1);
				continue;
			}
			world.orbs.remove(so.orb);
			const others = shipOrbs.filter((o) => o !== so);
			if (!flyShip(ctx, entry, section.end, follow, music, 0, others).end.dead)
				shipOrbs.splice(shipOrbs.indexOf(so), 1);
			else world.orbs.add(so.orb);
		}
		const flown = flyShip(ctx, entry, section.end, follow, music, 0, shipOrbs);
		if (!flown.end.dead) events = flown.events;
		// (one the way it's flown now doesn't touch goes too)
		const touched = simulate(world, entry, section.end, events).used;
		for (const so of shipOrbs)
			if (so.orb && !touched.includes(so.orb.id)) world.orbs.remove(so.orb);
	}
	// Every orb needed: one it gets through without (the press there a plain hop or switch)
	// goes, so none is just in the air; unless a press a bit early or late needs it
	// (the spider's orbs on the ground: needed on time, or they go; what that breaks is mended)
	let dropped = false;
	for (const orb of orbs) {
		world.orbs.remove(orb);
		const needed = simulate(world, entry, section.end, events).dead;
		const jump = mode === 'spider' && jumpOrbs.some((j) => j.orb === orb);
		if (needed || (!jump && verify(settled))) world.orbs.add(orb);
		else if (jump) dropped = true;
	}
	// Orbs the way doesn't touch do nothing: they go
	const touched = simulate(world, entry, section.end, events).used;
	for (const orb of orbs)
		if (world.orbs.items.includes(orb) && !touched.includes(orb.id)) {
			world.orbs.remove(orb);
			dropped = true;
		}
	if (dropped)
		for (let attempt = 0; attempt < 12; attempt++) {
			const failed = verify(settled);
			if (!failed) break;
			const near = columns.filter((c) => Math.abs(c.x + 0.5 - failed.x) < 3);
			if (!near.length) break;
			for (const c of near) {
				c.spike = 0;
				if (failed.y - c.low < c.high - failed.y) c.low = Math.max(floor, c.low - 1);
				else c.high = Math.min(top, c.high + 1);
			}
			build();
		}
	plan.push(...events);
	used(ctx, mode);
	return simulate(world, entry, section.end, plan);
}
