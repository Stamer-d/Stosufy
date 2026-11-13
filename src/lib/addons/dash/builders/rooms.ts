// The ball, spider, UFO and swing parts, each built from its presses on the music:
//
// - The ball and the spider go from platform to platform, the floor's and the ceiling's in turn:
//   each press leaves one that ends a moment later and gets onto one that began a moment before,
//   over pits of spikes. What's clean is the way, what's spiked isn't, and a press has its reason
//   in what's seen: the platform runs out.
// - The UFO and the swing fly a way made only of presses on the beat grid, the song's strong
//   moments first (their way is searched for among those, inside a band that climbs and falls
//   with the phrases), and their tunnel is laid closely around it.
//
// Both are played as a person might (every press a bit early and late, all of them and each
// alone) before they're taken; a part that doesn't work out that way is left to the older
// builder (flight.ts).

import { beatStrength, type DashNote } from '../chart';
import { hitAt } from '../audio';
import { musicalPosition, musicalRest } from '../composition';
import { byIntensity, gravityIn, hash, jittered, random, type Context } from '../build';
import {
	STEP,
	copyState,
	hitbox,
	press,
	simulate,
	step,
	type GravityPortal,
	type InputEvent,
	type Orb,
	type OrbKind,
	type Pad,
	type PadKind,
	type PlayerState,
	type Section,
	type Solid,
	type World
} from '../physics';

const floorHalf = (v: number) => Math.floor(v * 2 + 1e-6) / 2;
const ceilHalf = (v: number) => Math.ceil(v * 2 - 1e-6) / 2;

/** Says what the builders did, for looking into a level (only with DASH_DEBUG set, in Node) */
export const roomsDebug = (...a: unknown[]) => {
	if (typeof process !== 'undefined' && process.env?.DASH_DEBUG) console.error(...a);
};
const dbg = (...a: unknown[]) => roomsDebug('  rooms:', ...a);

/** What a builder put into the world (to take it out again if the part doesn't work out) */
class Built {
	solids: Solid[] = [];
	hazards: object[] = [];
	orbs: Orb[] = [];
	constructor(private world: World) {}
	pads: Pad[] = [];
	pad(kind: PadKind, x: number, y: number, dir: 1 | -1) {
		const pad: Pad = { id: this.world.id(), kind, x, y, dir, x0: x - 0.5, x1: x + 0.5 };
		this.world.pads.add(pad);
		this.pads.push(pad);
		return pad;
	}
	orb(kind: OrbKind, x: number, y: number) {
		const orb: Orb = { id: this.world.id(), kind, x, y, x0: x - 0.6, x1: x + 0.6 };
		this.world.orbs.add(orb);
		this.orbs.push(orb);
		return orb;
	}
	solid(s: Solid) {
		this.world.solids.add(s);
		this.solids.push(s);
		return s;
	}
	spike(x: number, y: number, dir: 1 | -1, kind: 'spike' | 'small' = 'spike') {
		const h = this.world.spike(x, y, dir, kind);
		this.hazards.push(h);
		return h;
	}
	clear() {
		const solids = new Set<object>(this.solids);
		const hazards = new Set(this.hazards);
		this.world.solids.removeIf((o) => solids.has(o));
		this.world.hazards.removeIf((h) => hazards.has(h));
		const orbs = new Set<object>(this.orbs);
		if (orbs.size) this.world.orbs.removeIf((o) => orbs.has(o));
		const pads = new Set<object>(this.pads);
		if (pads.size) this.world.pads.removeIf((p) => pads.has(p));
		this.pads = [];
		this.solids = [];
		this.hazards = [];
		this.orbs = [];
	}
}

/** Played from a state with some presses, each step shown; the state it ends in */
function play(
	world: World,
	from: PlayerState,
	until: number,
	events: InputEvent[],
	each?: (s: PlayerState) => void | boolean
) {
	const s = copyState(from);
	let k = 0;
	while (k < events.length && events[k].time < s.time) k++;
	while (s.time + STEP <= until + 1e-6 && !s.dead) {
		const next = s.time + STEP;
		while (k < events.length && events[k].time <= next) press(s, events[k++].down);
		step(world, s, next);
		if (each?.(s) === false) break;
	}
	return s;
}

/** The ways a part is played: on time, all presses early and late, and a few times each a bit off */
function ways(events: InputEvent[], tolerance: number, seed: number, loose = 4) {
	return [events, ...jittered(events, tolerance * 0.75, seed, loose)];
}

/** Each press alone early or late (with its release), the others on time: where that crashes */
function aloneFails(
	world: World,
	entry: PlayerState,
	end: number,
	events: InputEvent[],
	tolerance: number
) {
	let state = entry;
	for (let k = 0; k < events.length; k++) {
		const e = events[k];
		if (!e.down) continue;
		const release = events.findIndex((u, n) => n > k && !u.down);
		const after = events.find((u, n) => n > k && u.down);
		const until = Math.min(end, (after?.time ?? e.time + 1000) + 400);
		state = simulate(world, state, Math.max(state.time, e.time - tolerance - 20), events);
		if (state.dead) return state;
		for (const shift of [-1, -0.5, 0.5, 1].map((f) => f * tolerance)) {
			const inputs = events
				.map((u, n) => (n === k || n === release ? { ...u, time: u.time + shift } : u))
				.sort((p, q) => p.time - q.time);
			const run = simulate(world, state, until, inputs);
			if (run.dead)
				return (
					dbg(
						'  alone',
						shift,
						'press at',
						Math.round(e.time),
						'dies at +',
						Math.round(run.time - e.time),
						'y',
						run.y.toFixed(2),
						'g',
						run.gravity
					),
					run
				);
		}
	}
	return null;
}

function fails(
	world: World,
	entry: PlayerState,
	end: number,
	events: InputEvent[],
	tolerance: number,
	seed: number,
	/** How many times it's played with each press off by its own bit as well */
	loose = 4
) {
	let n = 0;
	for (const inputs of ways(events, tolerance, seed, loose)) {
		const run = simulate(world, entry, end, inputs);
		if (run.dead)
			return (
				dbg(
					'  way',
					n,
					'dies at t',
					Math.round(run.time),
					'y',
					run.y.toFixed(2),
					'g',
					run.gravity,
					'grounded',
					run.grounded,
					'presses near',
					inputs
						.filter((e) => e.down && Math.abs(e.time - run.time) < 700)
						.map((e) => Math.round(e.time - run.time))
						.join(',')
				),
				run
			);
		n++;
	}
	return aloneFails(world, entry, end, events, tolerance);
}

const taps = (times: number[], length: number): InputEvent[] =>
	times.flatMap((t, i) => {
		const next = times[i + 1] ?? Infinity;
		return [
			{ time: t, down: true },
			{ time: t + Math.max(STEP * 2, Math.min(length, next - t - STEP * 3)), down: false }
		];
	});

// --- The ball and the spider: platform to platform ----------------------------------------

interface Visit {
	/** 0 on the floor's side, 1 on the ceiling's */
	side: 0 | 1;
	x0: number;
	x1: number;
	/** How thick its platform is (0: the bare floor or ceiling) */
	d: number;
	solid: Solid | null;
	/** It's got onto by an orb jump from the platform before on its side */
	jump?: boolean;
	/** The latest it may begin and the earliest it may end */
	first: number;
	last: number;
}

export function buildPlatforms(
	ctx: Context,
	sec: Section,
	clicks: number[],
	entry: PlayerState
): PlayerState | null {
	const { world, preset } = ctx;
	const spider = sec.mode === 'spider';
	const top = sec.ceil!;
	const floor = sec.floor;
	const speed = sec.speed;
	const box = hitbox(sec.mode, sec.mini);
	const tolerance = preset.tolerance;
	const intensity = sec.intensity ?? 0.5;
	const seed = hash(`${ctx.seed}:platforms:${sec.index}`);
	if (entry.gravity < 0 || entry.dead) return null;

	// Its presses: once it's down on the floor, and not into the next part
	let landed = sec.end;
	play(world, entry, Math.min(sec.end, entry.time + 1500), [], (s) => {
		if (!s.grounded) return;
		landed = s.time;
		return false;
	});
	const tail = spider ? 260 : 480;
	// (and far enough apart that a pit fits between two platforms of a side: what a press may
	// always be off, each way, and a block of spikes)
	const offAlways = (tolerance / 1000) * speed * 1.2 + 0.1;
	const apart = ((2 * offAlways + box.w * 0.6 + 1.6) / speed) * 1000;
	const times: number[] = [];
	for (const t of clicks) {
		if (t < Math.max(sec.start + 150, landed + 60) || t > sec.end - tail) continue;
		if (times.length && t - times[times.length - 1] < apart) continue;
		times.push(t);
	}
	if (!times.length) return null;

	// Orb jumps: from normal on, some presses keep to their side: an orb over a pit of spikes
	// takes it onto the next platform of that side (as hand-built ball and spider parts have
	// them, about one a second). Without the orb the press would go over to the other side, onto
	// its spikes; without the press it rolls into the pit: every orb is needed. Where the presses
	// come a beat apart, the jump takes two beats: the press between goes
	const hops = new Set<number>();
	/** Of those, the ones a pad takes, without a press (on the beat by itself) */
	const pads = new Set<number>();
	if (preset.level >= 1) {
		const pick = random(seed ^ 0x5bd1);
		const share =
			(spider ? [0, 0.25, 0.36, 0.42, 0.48] : [0, 0.18, 0.28, 0.33, 0.38])[preset.level] *
			(0.7 + intensity * 0.6);
		const air = spider ? 400 : 460;
		// (the ball jumps high: only in a room with space over the jump)
		const space = top - floor >= (spider ? 5 : 6);
		for (let k = 1; k < times.length - 1; k++) {
			if (!space || hops.has(k - 1) || pick() >= share) continue;
			if (times[k + 1] - times[k] >= air) hops.add(k);
			else if (k + 2 < times.length && times[k + 2] - times[k] >= air) {
				if (times[k + 2] - times[k] > 1000) continue;
				times.splice(k + 1, 1);
				hops.add(k);
			}
		}
		// (as hand-built spider parts have them, many pads: the spider's jumps more often by a
		// pad than by an orb, the ball's less often)
		for (const k of hops) if (pick() < (spider ? 0.55 : 0.35)) pads.add(k);
	}
	/** The presses: all but those a pad takes */
	const pressesOf = () =>
		taps(
			times.filter((_, k) => !pads.has(k)),
			90
		);
	let events = pressesOf();

	const room = sec.mini ? 2.4 : 3;
	const built = new Built(world);
	for (let attempt = 0, retries = 0; attempt < 4; attempt++) {
		built.clear();
		// (the last tries without orb jumps)
		if (attempt >= 2) {
			hops.clear();
			pads.clear();
		}
		events = pressesOf();
		const rng = random(seed + attempt);
		/** Each platform's side: the floor's (0) or the ceiling's (1); a press goes over, a jump not */
		const sides: (0 | 1)[] = [0];
		for (let k = 0; k < times.length; k++)
			sides.push(hops.has(k) ? sides[k] : ((1 - sides[k]) as 0 | 1));
		// How long a press may be off and still get there (ms a side): the difficulty's room for a
		// click, more with each try
		const allow =
			Math.max(tolerance * 1.3, byIntensity(preset.window, intensity) / 2) * (1 + attempt * 0.35);
		const reach = (allow / 1000) * speed;
		const late = Math.max((tolerance / 1000) * speed * 1.2, reach - box.w * 0.5) + 0.1;
		const early = reach + box.w * 0.6 + 0.1;

		// How thick each platform is: like stairs, a step up or down from the one before on its side
		const thick: number[] = [0];
		for (let v = 1; v <= times.length; v++) {
			const same = sides.lastIndexOf(sides[v], v - 1);
			const other = sides.lastIndexOf((1 - sides[v]) as 0 | 1, v - 1);
			const before = (same >= 0 ? thick[same] : 1) || 1;
			const turn = rng();
			let d = Math.max(1, Math.min(3, before + (turn < 0.34 ? -1 : turn < 0.62 ? 0 : 1)));
			if (preset.level === 0) d = 1;
			// (a platform an orb jump leaves: room for the jump over it)
			const need = room + (hops.has(v) || hops.has(v - 1) ? 1.5 : 0);
			while (d > 1 && top - floor - d - (other >= 0 ? thick[other] : 0) < need) d--;
			thick.push(d);
		}

		// Platform after platform: where the press before gets onto it, to where the next leaves it
		const least = (tolerance / 1000) * speed * 1.2 + 0.1;
		const visits: Visit[] = [
			{
				side: 0,
				x0: sec.x0,
				x1: ceilHalf(world.xAt(times[0]) + late),
				d: 0,
				solid: null,
				first: sec.x0,
				last: world.xAt(times[0]) + least
			}
		];
		let state = entry;
		let ok = true;
		let hopFailed = -1;
		for (let k = 0; k < times.length && ok; k++) {
			const side = sides[k + 1];
			const hop = hops.has(k);
			const d = thick[k + 1];
			const xc = world.xAt(times[k]);
			const next = times[k + 1];
			const x1 = next === undefined ? sec.x1 : ceilHalf(world.xAt(next) + late);
			const from = spider && !hop ? xc - early : hop ? xc + 1.5 : xc - 0.25;
			if (hop) {
				// (the orb where it rolls, or the pad it rolls over: yellow, pink where the room is
				// low for a full jump)
				const on = visits[k];
				const low = top - floor - on.d - (thick[sides.lastIndexOf((1 - on.side) as 0 | 1, k)] ?? 0);
				const kind = low < 6.5 || rng() < 0.3 ? 'pink' : 'yellow';
				if (pads.has(k)) {
					// (the pad on its platform, whole: the platform goes on under it)
					built.pad(kind, xc, on.side ? top - on.d : floor + on.d, on.side ? -1 : 1);
					on.x1 = Math.max(on.x1, ceilHalf(xc + 0.6));
					on.last = Math.max(on.last, xc + 0.6);
					if (on.solid) on.solid.x1 = on.x1;
				} else built.orb(kind, xc, on.side ? top - on.d - box.h : floor + on.d + box.h);
			}
			const solid: Solid | null = d
				? built.solid(
						side
							? { x0: floorHalf(from), x1, y0: top - d, y1: top, style: 2 }
							: { x0: floorHalf(from), x1, y0: floor, y1: floor + d, style: 2 }
					)
				: null;
			// (where it lands, played)
			state = simulate(world, state, times[k] - STEP, events);
			let landing = -1;
			// (off the bare floor it starts from: its spikes only once it's risen over them)
			let risen = -1;
			const until = Math.min(sec.end, (next ?? times[k] + 900) - 30);
			play(world, state, until, events, (s) => {
				if (k === 0 && risen < 0 && s.time > times[0] && s.y - box.h > floor + 0.9) risen = s.x;
				if (s.time < times[k] + STEP || !s.grounded || (side ? s.gravity > 0 : s.gravity < 0))
					return;
				landing = s.x;
				return false;
			});
			if (k === 0) {
				const clear = ceilHalf((risen < 0 ? landing : risen) + 0.2);
				visits[0].x1 = Math.max(visits[0].x1, clear);
				visits[0].last = Math.max(visits[0].last, clear);
			}
			if (landing < 0) {
				dbg('no landing after press', k, 'of', times.length, hop ? '(jump)' : '');
				if (hop) hopFailed = k;
				ok = false;
				break;
			}
			const x0 = floorHalf(spider && !hop ? from : Math.max(from, landing - early));
			if (solid) solid.x0 = x0;
			visits.push({
				side,
				x0,
				x1,
				d,
				solid,
				jump: hop,
				// (the latest it may begin, the earliest it may end: what a press may always be off)
				first: (spider && !hop ? xc : landing) - least - box.w * 0.6,
				last: next === undefined ? sec.x1 : world.xAt(next) + least
			});
		}
		if (!ok) {
			// (an orb jump that doesn't land: that press goes over as the others, the try again)
			if (hopFailed >= 0 && retries++ < 12) {
				hops.delete(hopFailed);
				pads.delete(hopFailed);
				attempt--;
			}
			continue;
		}
		// Between two platforms of a side there's a pit, a block wide at least: where the presses
		// come close together, the platforms give way (down to what a press may always be off)
		for (let v = 2; v < visits.length; v++) {
			let b = v - 1;
			while (b >= 0 && visits[b].side !== visits[v].side) b--;
			if (b < 0) continue;
			const before = visits[b];
			const after = visits[v];
			let short = before.x1 + 1 - after.x0;
			if (short <= 0) continue;
			const back = Math.min(short, Math.max(0, before.x1 - ceilHalf(before.last)));
			before.x1 -= floorHalf(back);
			short = before.x1 + 1 - after.x0;
			if (short > 0)
				after.x0 += Math.min(ceilHalf(short), Math.max(0, floorHalf(after.first - after.x0)));
			if (before.solid) before.solid.x1 = before.x1;
			if (after.solid) after.solid.x0 = after.x0;
		}
		world.solids.touch();

		// Where no platform of a side is: spikes. Right after a platform on a ledge as high as
		// it was (who doesn't press runs into them; a pit alone it would fall across onto the next
		// platform), then down on the bare floor or ceiling
		const startX = Math.ceil(world.xAt(sec.start + 150));
		const endX = Math.floor(sec.x1 - 0.5);
		for (const side of [0, 1] as const) {
			const own = visits.filter((v) => v.side === side);
			let at = startX;
			let d = 0;
			const gaps: { g0: number; g1: number; d: number; jump?: boolean }[] = [];
			for (const v of own) {
				if (v.x0 > at) gaps.push({ g0: at, g1: v.x0, d, jump: v.jump });
				if (v.x1 >= at) d = v.d;
				at = Math.max(at, v.x1);
			}
			if (endX > at) gaps.push({ g0: at, g1: endX, d });
			for (const { g0, g1, d, jump } of gaps) {
				// (the pit an orb jumps over: no ledge and a block clear after the edge, where it
				// rises, and half a block before the platform it lands on; who doesn't press falls
				// off the edge into the spikes after that)
				const ledge = d && !jump ? Math.min(3, Math.floor(g1 - g0 + 1e-6)) : 0;
				const until = jump ? g1 - 0.5 : g1;
				if (ledge)
					built.solid(
						side
							? { x0: g0, x1: g0 + ledge, y0: top - d, y1: top, style: 2 }
							: { x0: g0, x1: g0 + ledge, y0: floor, y1: floor + d, style: 2 }
					);
				const first = jump
					? Math.ceil(g0 + 1 - 1e-6)
					: ledge || g1 - g0 < 2
						? g0
						: Math.ceil(g0 - 1e-6);
				for (let x = first; x + 1 <= until + 1e-6; x++) {
					// (where the music rests nothing threatens)
					if (musicalRest(ctx.chart, world.timeAt(x + 0.5))) continue;
					const up = x < g0 + ledge ? d : 0;
					built.spike(x + 0.5, side ? top - up : floor + up, side ? -1 : 1);
				}
			}
		}
		world.solids.touch();
		world.hazards.touch();
		const failed = fails(world, entry, sec.end, events, tolerance, seed);
		if (failed) {
			dbg(
				'platforms fail at',
				(failed.x - sec.x0).toFixed(1),
				'of',
				(sec.x1 - sec.x0).toFixed(1),
				'try',
				attempt,
				'ceil',
				top,
				'mini',
				sec.mini
			);
			continue;
		}
		dbg(
			'platforms ok, jumps',
			built.orbs.length,
			'orbs',
			built.pads.length,
			'pads',
			'of presses',
			times.length,
			'try',
			attempt
		);
		ctx.plan.push(...events);
		return simulate(world, entry, sec.end, events);
	}
	built.clear();
	world.solids.touch();
	world.hazards.touch();
	return null;
}

// --- The UFO and the swing: a way of presses on the beat, a tunnel around it ----------------

/** The least time between two presses (ms), by difficulty */
const UFO_APART = [300, 260, 220, 200, 180];
const SWING_APART = [300, 250, 200, 170, 150];
/** How far the tunnel stays from the way (blocks), by difficulty */
const CLEAR = [1.3, 0.95, 0.6, 0.45, 0.35];

interface Slot {
	time: number;
	/** How much the song asks for a press there (below 0: only if the way needs it) */
	weight: number;
}

/** A way being searched: the player, its presses so far (the last one first) and how good it is */
interface Way {
	state: PlayerState;
	score: number;
	last: number;
	taps: { time: number; orb?: Orb; before: Way['taps'] } | null;
	/** When it last took an orb */
	orbAt?: number;
}

export function buildTunnel(
	ctx: Context,
	sec: Section,
	notes: DashNote[],
	/** The presses the song's drums ask for (rhythm.ts) */
	wanted: number[],
	entry: PlayerState
): PlayerState | null {
	const { world, preset, chart } = ctx;
	const swing = sec.mode === 'swing';
	const top = sec.ceil!;
	const floor = sec.floor;
	const box = hitbox(sec.mode, sec.mini);
	const tolerance = preset.tolerance;
	const intensity = sec.intensity ?? 0.5;
	const seed = hash(`${ctx.seed}:tunnel:${sec.index}`);
	const rng = random(seed);
	if (entry.dead) return null;

	// The beat grid's quarters, each with how much the song asks for a press there
	const want = new Set(wanted.map((t) => Math.round(t)));
	const noteNear = (time: number) => notes.some((n) => Math.abs(n.time - time) <= 30);
	const heard = (time: number) =>
		noteNear(time) || (!!chart.sound?.hits && hitAt(chart.sound, time) > 0.35);
	const slots: Slot[] = [];
	const from = sec.start + 140;
	const until = sec.end - 220;
	for (let i = 0; i < chart.timing.length; i++) {
		const point = chart.timing[i];
		const stop = Math.min(until, chart.timing[i + 1]?.time ?? Infinity);
		const quarter = point.beatLength / 4;
		for (let k = Math.max(0, Math.ceil((from - point.time) / quarter)); ; k++) {
			const time = Math.round(point.time + k * quarter);
			if (time >= stop) break;
			if (musicalRest(chart, time)) continue;
			const strong = beatStrength(chart.timing, time);
			let weight: number;
			if ([...want].some((t) => Math.abs(t - time) <= 3)) weight = 1 + strong * 0.6;
			else if (k % 2 === 0 && heard(time)) weight = (swing ? 0.1 : 0.25) + (k % 4 === 0 ? 0.2 : 0);
			else if (k % 2 === 0) weight = -0.5;
			else if (preset.level >= 2 && noteNear(time)) weight = 0.05;
			else continue;
			slots.push({ time, weight });
		}
	}
	slots.sort((a, b) => a.time - b.time);
	if (slots.length < 2) return null;

	// The band the way stays in: around a height that climbs and falls from phrase to phrase
	const levels = [0.32, 0.5, 0.68].map((f) => floor + (top - floor) * f);
	const marks: { x: number; y: number }[] = [];
	{
		let level = 1;
		const startY = Math.max(floor + 2.2, Math.min(top - 2.2, entry.y));
		marks.push({ x: sec.x0, y: startY });
		for (let t = sec.start + 1; t < sec.end;) {
			const phrase = musicalPosition(chart, t);
			const end = Math.min(sec.end, phrase.end);
			const turn = rng();
			level = Math.max(0, Math.min(2, level + (turn < 0.4 ? -1 : turn < 0.8 ? 1 : 0)));
			if (preset.level === 0) level = 1;
			marks.push({ x: world.xAt(end), y: levels[level] });
			t = end + 1;
			if (!(phrase.end > phrase.start)) break;
		}
	}
	const centre = (x: number) => {
		for (let i = 1; i < marks.length; i++)
			if (x <= marks[i].x) {
				const a = marks[i - 1];
				const b = marks[i];
				return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x);
			}
		return marks[marks.length - 1].y;
	};

	const apart = Math.max(preset.gap * 1000, (swing ? SWING_APART : UFO_APART)[preset.level]);
	const idle = chartBeat(ctx, sec) * (preset.level >= 2 ? 1.5 : 2.5);
	const openUntil = world.xAt(slots[0].time) + sec.speed * 0.6;

	// Gravity portals on the bars: each turns it around on the beat, without a press (in the
	// intense parts of the hard levels on every bar, else now and then on every other)
	const turns: number[] = [];
	if (preset.level >= 1 && gravityIn(ctx, sec.mode)) {
		// (the swing's own presses turn it: on every bar only on extreme)
		const dense = preset.level >= (swing ? 4 : 3) && intensity >= 0.5;
		const chance = dense ? 1 : preset.level >= 2 ? 0.55 : 0.3;
		for (let t = sec.start + 1; t < sec.end;) {
			const at = musicalPosition(chart, t);
			const bar = at.point.beatLength * at.point.meter;
			// (a short UFO part of a chain, a bar or two, turns on its half bars too; the swing's own
			// presses turn it already)
			const short = dense && !swing && sec.end - sec.start < 3.2 * bar;
			const unit = short ? bar / 2 : bar;
			const first = at.point.time + Math.ceil((t - at.point.time) / unit - 1e-6) * unit;
			for (let b = first, n = 0; b < Math.min(sec.end, at.end + 1); b += unit, n++) {
				if (b < slots[0].time + (short ? 450 : 700) || b > sec.end - (short ? 750 : 1000)) continue;
				if (!dense && Math.round((b - at.point.time) / bar) % 2 !== 0) continue;
				if (musicalRest(chart, b) || rng() > chance) continue;
				if (turns.length && b - turns[turns.length - 1] < unit * 0.9) continue;
				turns.push(Math.round(b));
			}
			t = Math.max(t + 1, at.end + 1);
			if (!(at.end > at.start) || !isFinite(at.end)) break;
		}
	}
	const portals: GravityPortal[] = [];
	const dropPortals = () => {
		const gone = new Set<object>(portals);
		world.gravityPortals.removeIf((g) => gone.has(g));
		portals.length = 0;
	};
	const search = (reach: number): number[] | null => {
		const inBand = (s: PlayerState) => {
			// (the whole room right after the portal: it comes in wherever the part before left it;
			// and where the music rests, there's nothing to press on)
			const open = s.x < openUntil || musicalRest(chart, s.time);
			const c = centre(s.x);
			// (on the easy levels the UFO hops along the floor: its presses are too far apart to stay
			// up, and it's the hop over something that's asked for)
			const edge = open || (!swing && preset.level <= 1) ? -0.01 : reach > 9 ? 0.4 : 1.1;
			const low = open ? floor + box.h - 0.01 : Math.max(floor + box.h + edge, c - reach);
			const high = open ? top - box.h + 0.01 : Math.min(top - box.h - edge, c + reach);
			return s.y >= low && s.y <= high;
		};
		dropPortals();
		let turn = 0;
		let beam: Way[] = [{ state: copyState(entry), score: 0, last: -1e9, taps: null }];
		// (up to the first slot: nothing pressed)
		const lead = play(world, entry, slots[0].time - STEP, [], (s) => inBand(s));
		if (lead.dead || !inBand(lead)) return (dbg('lead out of band', lead.y), null);
		beam[0].state = lead;
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			const end = i + 1 < slots.length ? slots[i + 1].time - STEP : sec.end;
			const next: Way[] = [];
			for (const way of beam) {
				for (const option of byOrb(slot, way) ? [0, 1, 2] : [0, 1]) {
					const tap = option > 0;
					if (tap && slot.time - way.last < apart) continue;
					// (no press right at a portal: it turns there on its own)
					if (tap && turns.some((t) => Math.abs(t - slot.time) < apart * 0.75)) continue;
					// (an orb there, for this way only while it's played: black where it's high, down at
					// once; yellow where it's low, a big jump)
					let orb: Orb | undefined;
					if (option === 2) {
						const x = world.xAt(slot.time);
						// (black: down at once where a press would go up; yellow low in the room)
						const kind: OrbKind = way.state.y > floor + 3 ? 'black' : 'yellow';
						orb = { id: world.id(), kind, x, y: way.state.y, x0: x - 0.6, x1: x + 0.6 };
						world.orbs.add(orb);
					}
					const events = tap
						? [
								{ time: slot.time, down: true },
								{
									time: slot.time + Math.max(STEP * 2, Math.min(60, end - slot.time - STEP)),
									down: false
								}
							]
						: [];
					let inside = true;
					let edge = 0;
					const state = play(world, way.state, end, events, (s) => {
						if (!inBand(s)) return (inside = false);
						edge = Math.max(edge, Math.abs(s.y - centre(s.x)) / Math.min(reach, 4));
					});
					if (orb) world.orbs.remove(orb);
					if (!inside || state.dead) continue;
					// (an orb that wasn't taken is no orb way)
					if (orb && !state.used.includes(orb.id)) continue;
					const last = tap ? slot.time : way.last;
					let score = way.score + (tap ? slot.weight : 0) + (orb ? 0.3 : 0) - edge * edge * 0.12;
					if (end - last > idle) score -= 0.4;
					next.push({
						state,
						score,
						last,
						orbAt: orb ? slot.time : way.orbAt,
						taps: tap ? { time: slot.time, orb, before: way.taps } : way.taps
					});
				}
			}
			if (!next.length) {
				dbg(
					'no way at slot',
					i,
					'of',
					slots.length,
					'reach',
					reach,
					sec.mode,
					'mini',
					sec.mini,
					'speed',
					sec.speedIndex,
					'ceil',
					top,
					't',
					Math.round(slot.time - sec.start),
					'gap',
					Math.round(end - slot.time),
					'apart',
					apart,
					'best',
					beam
						.slice(0, 3)
						.map(
							(w) =>
								`y${w.state.y.toFixed(1)} vy${w.state.vy.toFixed(1)} g${w.state.gravity} c${centre(w.state.x).toFixed(1)} last${Math.round(slot.time - w.last)}`
						)
						.join(' | '),
					'turns',
					turns.map((t) => Math.round(t - sec.start)).join(',')
				);
				return null;
			}
			// The best of each kind of place it can be in
			const seen = new Map<string, Way>();
			for (const way of next) {
				const s = way.state;
				const key = `${Math.round(s.y * 3)}:${Math.round(s.vy / 2)}:${s.gravity}:${way.last === slot.time}`;
				const known = seen.get(key);
				if (!known || way.score > known.score) seen.set(key, way);
			}
			beam = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 20);
			// A portal before the next slot: it turns the best way so far around (the other ways
			// go through it as they come: turned, or not if they're that way up already)
			while (turn < turns.length && turns[turn] <= end + STEP) {
				if (turns[turn] > slot.time && beam[0].state.time < turns[turn]) {
					const x = world.xAt(turns[turn]);
					const portal: GravityPortal = {
						x,
						y: beam[0].state.y,
						gravity: -beam[0].state.gravity as 1 | -1,
						x0: x - 0.6,
						x1: x + 0.6
					};
					world.gravityPortals.add(portal);
					portals.push(portal);
				}
				turn++;
			}
		}
		const best = beam[0];
		const out: number[] = [];
		found = [];
		for (let t = best.taps; t; t = t.before) {
			out.push(t.time);
			if (t.orb) found.push(t.orb);
		}
		return out.reverse();
	};
	/** The orbs of the way found */
	let found: Orb[] = [];
	/**
	 * Whether a way may take an orb at a slot: the UFO from hard on, on the drums' presses (the
	 * strongest), not two within 1.2 s (hand-built UFO parts have one every three seconds or so)
	 */
	const byOrb = (slot: Slot, way: Way) =>
		!swing &&
		preset.level >= 2 &&
		slot.weight >= 1 &&
		slot.time - (way.orbAt ?? -1e9) >= 1200 &&
		slot.time > sec.start + 400 &&
		slot.time < sec.end - 600;
	let times: number[] | null = null;
	// (a band around the phrase's height, wider if there's no way in it, at last the whole room)
	for (const reach of swing ? [2.1, 2.9, 99] : preset.level <= 1 ? [99] : [2.3, 3.1, 99]) {
		times = search(reach);
		if (times) break;
	}
	if (!times || !times.length) return (dbg('no presses'), null);
	const events = taps(times, 60);
	dbg('tunnel orbs', found.length, 'of presses', times.length);
	// (the way's orbs in the world now: the tunnel is laid around the way that takes them)
	for (const orb of found) world.orbs.add(orb);

	// The room the way takes, per block: played on time, early, late, and each press alone off
	const low = new Map<number, number>();
	const high = new Map<number, number>();
	const note = (s: PlayerState) => {
		for (const c of [Math.floor(s.x - box.w), Math.floor(s.x + box.w)]) {
			low.set(c, Math.min(low.get(c) ?? Infinity, s.y - box.h));
			high.set(c, Math.max(high.get(c) ?? -Infinity, s.y + box.h));
		}
	};
	// (not with every press off by its own bit: a way that's flown drifts further with each one,
	// where a person steers back; the tunnel would have to be a hall)
	for (const inputs of ways(events, tolerance, seed, 0)) play(world, entry, sec.end, inputs, note);
	{
		let state = entry;
		for (let k = 0; k < events.length; k++) {
			if (!events[k].down) continue;
			state = simulate(world, state, Math.max(state.time, events[k].time - tolerance - 20), events);
			const stop = Math.min(sec.end, (events[k + 2]?.time ?? events[k].time + 1000) + 420);
			for (const shift of [-tolerance, tolerance]) {
				const inputs = events
					.map((u, n) => (n === k || n === k + 1 ? { ...u, time: u.time + shift } : u))
					.sort((p, q) => p.time - q.time);
				play(world, state, stop, inputs, note);
			}
		}
	}

	// (a portal the way comes to the right way up already turns nothing: it goes)
	{
		const idle = new Set<object>();
		let before = entry.gravity;
		let x = entry.x;
		play(world, entry, sec.end, events, (s) => {
			for (const portal of portals)
				if (portal.x > x && portal.x <= s.x && portal.gravity === before && s.gravity === before)
					idle.add(portal);
			before = s.gravity;
			x = s.x;
		});
		if (idle.size) {
			world.gravityPortals.removeIf((g) => idle.has(g));
			for (const g of idle) portals.splice(portals.indexOf(g as GravityPortal), 1);
		}
	}
	// (each portal at the height it's flown through)
	play(world, entry, sec.end, events, (s) => {
		for (const portal of portals) if (Math.abs(portal.x - s.x) < 0.3) portal.y = s.y;
	});

	// The tunnel: blocks up to and down to that room, in runs of a few blocks
	const built = new Built(world);
	built.orbs.push(...found);
	const clear = CLEAR[preset.level] * (1.15 - intensity * 0.3) * (sec.mini ? 0.8 : 1);
	const run = preset.level <= 1 ? 3 : 2;
	const x0 = Math.ceil(world.xAt(sec.start + 150));
	const x1 = Math.floor(world.xAt(sec.end - 150));
	const lowest = (a: number, b: number) => {
		let v = Infinity;
		for (let c = a; c <= b; c++) v = Math.min(v, low.get(c) ?? Infinity);
		return v;
	};
	const highest = (a: number, b: number) => {
		let v = -Infinity;
		for (let c = a; c <= b; c++) v = Math.max(v, high.get(c) ?? -Infinity);
		return v;
	};
	const pieces: { a: number; b: number; bottom: number; ceiling: number }[] = [];
	for (let a = x0; a < x1; a += run) {
		const b = Math.min(x1, a + run);
		const under = lowest(a - 1, b);
		const over = highest(a - 1, b);
		if (!isFinite(under) || !isFinite(over)) continue;
		pieces.push({
			a,
			b,
			bottom: Math.max(floor, floorHalf(under - clear)),
			ceiling: Math.min(top, ceilHalf(over + clear))
		});
	}
	const lay = () => {
		built.clear();
		for (const p of pieces) {
			if (p.bottom - floor >= 0.5)
				built.solid({ x0: p.a, x1: p.b, y0: floor, y1: p.bottom, style: 2 });
			if (top - p.ceiling >= 0.5)
				built.solid({ x0: p.a, x1: p.b, y0: p.ceiling, y1: top, style: 2 });
		}
		world.solids.touch();
	};
	lay();
	// Spikes on them where there's room over (under) one: nowhere to rest, a press left out ends
	const spikes = () => {
		for (const p of pieces)
			for (let c = p.a; c < p.b; c++) {
				if (musicalRest(chart, world.timeAt(c + 0.5))) continue;
				const under = lowest(c - 1, c + 1) - p.bottom;
				if (under >= 1.2) built.spike(c + 0.5, p.bottom, 1);
				else if (under >= 0.7) built.spike(c + 0.5, p.bottom, 1, 'small');
				const over = p.ceiling - highest(c - 1, c + 1);
				if (over >= 1.2) built.spike(c + 0.5, p.ceiling, -1);
				else if (over >= 0.7) built.spike(c + 0.5, p.ceiling, -1, 'small');
			}
		world.hazards.touch();
	};
	if (preset.level >= 1 || swing) spikes();

	/**
	 * Each orb of the way needed: where the way without it goes (the same presses, the orb not
	 * there), and no way that's played comes near, a saw; it stays if every way still gets
	 * through. An orb no saw makes needed is left to the end (it goes there if it's not needed)
	 */
	function needOrbs() {
		for (const orb of found) {
			world.orbs.remove(orb);
			const trace: { x: number; y: number; time: number }[] = [];
			const run = simulate(world, entry, sec.end, events, { trace });
			world.orbs.add(orb);
			dbg(
				'orb',
				orb.kind,
				'at',
				(orb.x - sec.x0).toFixed(1),
				'without it',
				run.dead ? 'dead' : 'alive'
			);
			if (run.dead) continue;
			// (a saw just outside the room the ways take, where the way without the orb reaches out of
			// it: it catches that one, none of the others)
			let made = false;
			for (const p of trace) {
				if (made) break;
				if (p.x < orb.x + 1 || p.x > Math.min(sec.x1 - 2, orb.x + 12)) continue;
				for (const r of [0.6, 0.45]) {
					if (made) break;
					const hit = r * 0.72;
					for (const dir of [1, -1]) {
						const y = p.y + dir * (box.h + hit - 0.06);
						let clearOf = true;
						for (let c = Math.floor(p.x - hit - 0.1); c <= Math.floor(p.x + hit + 0.1); c++) {
							const lo = low.get(c);
							const hi = high.get(c);
							if (lo === undefined || hi === undefined) continue;
							if (dir > 0 ? y - hit < hi + 0.06 : y + hit > lo - 0.06) clearOf = false;
						}
						if (!clearOf || y - r < floor + 0.2 || y + r > top - 0.2) continue;
						if (world.solidAt(p.x - r, p.x + r, y - r, y + r)) continue;
						const saw = world.saw(p.x, y, r);
						if (fails(world, entry, sec.end, events, tolerance, seed, 0)) {
							world.hazards.remove(saw);
							continue;
						}
						built.hazards.push(saw);
						dbg('orb made needed by a saw at', (p.x - sec.x0).toFixed(1));
						made = true;
						break;
					}
				}
			}
		}
	}

	// Played; where it's stopped: the spikes there go, then the blocks give half a block
	for (let round = 0; round < 60; round++) {
		const failed = fails(world, entry, sec.end, events, tolerance, seed, 0);
		if (!failed) {
			needOrbs();
			ctx.plan.push(...events);
			return simulate(world, entry, sec.end, events);
		}
		const near = (o: { x0: number; x1: number }) => o.x1 > failed.x - 1.6 && o.x0 < failed.x + 1.4;
		const hazards = built.hazards as { x0: number; x1: number }[];
		if (hazards.some(near)) {
			const gone = new Set<object>(hazards.filter(near));
			world.hazards.removeIf((h) => gone.has(h));
			built.hazards = hazards.filter((h) => !gone.has(h));
			continue;
		}
		let moved = false;
		for (const p of pieces) {
			if (p.b <= failed.x - 1.6 || p.a >= failed.x + 1.4) continue;
			if (p.bottom > floor) {
				p.bottom = Math.max(floor, p.bottom - 0.5);
				moved = true;
			}
			if (p.ceiling < top) {
				p.ceiling = Math.min(top, p.ceiling + 0.5);
				moved = true;
			}
		}
		if (!moved) {
			dbg('cannot widen at', failed.x - sec.x0);
			break;
		}
		// (the spikes that are left stay where their blocks still are)
		const kept = built.hazards;
		built.hazards = [];
		lay();
		built.hazards = kept;
		const unsupported = new Set<object>(
			(kept as { x: number; y: number; dir: 1 | -1 }[]).filter(
				(h) => !world.surfaceAt(h.x - 0.45, h.x + 0.45, h.y, h.dir)
			)
		);
		world.hazards.removeIf((h) => unsupported.has(h));
		built.hazards = kept.filter((h) => !unsupported.has(h));
	}
	built.clear();
	dropPortals();
	world.solids.touch();
	world.hazards.touch();
	return null;
}

/** How long a beat is in a part (ms) */
function chartBeat(ctx: Context, sec: Section) {
	return musicalPosition(ctx.chart, (sec.start + sec.end) / 2).point.beatLength;
}
