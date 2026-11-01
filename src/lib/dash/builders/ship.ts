// The ship parts from building blocks: a corridor on the beats, piece after piece (straight, a
// rise, a fall, a zigzag, a squeeze, a slalom between pillars, around a saw, up or down by an
// orb, upside down between two gravity portals, between rows of spikes, a funnel). Each piece
// is the corridor's middle and height along it and the way the ship flies through it; its walls
// are blocks on the grid of half blocks around that. Each is flown with the physics (on its way,
// and a bit above and below it, as a person steers), an orb also without it (then it must
// crash), and kept, or the next one is tried. The ship's room: wider the easier and calmer.

import { clamp, freshness, gravityIn, shuffleByWeight, used, type Context } from '../build';
import { flyShip, type ShipOrb } from './flight';
import {
	hitbox,
	simulate,
	type InputEvent,
	type OrbKind,
	type PlayerState,
	type Section,
	type Solid
} from '../physics';
import { musicalRest } from '../composition';

/** A piece of corridor, between two places */
interface Piece {
	/** Where the ship flies (its middle) */
	path: (x: number) => number;
	/** The corridor's middle and height */
	middle: (x: number) => number;
	height: (x: number) => number;
	/** Its middle at its end */
	end: number;
	/** Pillars in one column: from the floor up to, or from the ceiling down to */
	pillars?: { x: number; floor: boolean; to: number }[];
	spikes?: boolean;
	saw?: { x: number; y: number; radius: number };
	orb?: { kind: OrbKind; time: number };
	portals?: { x: number; gravity: 1 | -1; y: number }[];
}

interface Span {
	c: number;
	H: number;
	xa: number;
	xb: number;
	ta: number;
	tb: number;
	/** The beats' places in it */
	beats: number[];
}

interface ShipBlock {
	id: string;
	level: number;
	weight: number;
	beats: number;
	gravity?: boolean;
	make: (s: Span) => Piece | null;
}

/** The ship's pieces (see buildShip): 12 */
export const SHIP_PIECES = [
	'straight',
	'rise',
	'fall',
	'zigzag',
	'squeeze',
	'slalom',
	'saw',
	'orbUp',
	'orbDown',
	'gravity',
	'spikes',
	'funnel'
] as const;

/** 0 to 1, smoothly */
const ramp = (f: number) => {
	const t = clamp(f, 0, 1);
	return t * t * (3 - 2 * t);
};

export function buildShip(ctx: Context, sec: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const floor = sec.floor;
	const top = sec.ceil!;
	const speed = sec.speed;
	const intensity = sec.intensity ?? 0.5;
	/** Half the ship's height */
	const box = hitbox('ship', sec.mini).h;
	// The corridor's height: roomier on the easier levels and where it's calm
	const base = clamp(2 * preset.ship + 1.8 - intensity * 0.4, 3.2, 7);
	// How steep it may go (blocks up per block on): the ship climbs about 14 blocks a second
	const slope = Math.min(0.75, (4.5 + preset.level * 1.2) / speed);
	// (a wall of a block at least below and above it)
	const lowest = (H: number) => floor + 1 + H / 2;
	const highest = (H: number) => top - 1 - H / 2;

	// --- The pieces ------------------------------------------------------------------------
	const straight = (s: Span, H = s.H): Piece => ({
		path: () => s.c,
		middle: () => s.c,
		height: () => H,
		end: s.c
	});
	/** Up or down by d, from a quarter in */
	const climb = (s: Span, d: number): Piece | null => {
		const c1 = s.c + d;
		if (c1 < lowest(s.H) || c1 > highest(s.H)) return null;
		const from = s.xa + (s.xb - s.xa) * 0.2;
		const length = Math.abs(d) / slope;
		if (from + length > s.xb - 0.5) return null;
		const m = (x: number) => s.c + d * ramp((x - from) / length);
		return { path: m, middle: m, height: () => s.H, end: c1 };
	};
	const step = () =>
		preset.level >= 2 ? 2 + Math.floor(rng() * 4) * 0.5 : preset.level >= 1 ? 1.5 + rng() : 1.5;
	/** The middle a wider corridor may have here */
	const room = (c: number, W: number) => clamp(c, floor + W / 2, top - W / 2);
	const BLOCKS: ShipBlock[] = [
		{ id: 'straight', level: 0, weight: 0.5, beats: 2, make: (s) => straight(s) },
		{ id: 'rise', level: 0, weight: 1, beats: 2, make: (s) => climb(s, step()) },
		{ id: 'fall', level: 0, weight: 1, beats: 2, make: (s) => climb(s, -step()) },
		{
			id: 'zigzag',
			level: 1,
			weight: 0.7,
			beats: 4,
			make: (s) => {
				const d = step() * (s.c + step() <= highest(s.H) ? 1 : -1);
				if (s.c + d < lowest(s.H) || s.c + d > highest(s.H)) return null;
				const half = (s.xb - s.xa) / 2;
				const length = Math.abs(d) / slope;
				if (length > half * 0.8) return null;
				const a = s.xa + half * 0.15;
				const b = s.xa + half + half * 0.15;
				const m = (x: number) => s.c + d * (ramp((x - a) / length) - ramp((x - b) / length));
				return { path: m, middle: m, height: () => s.H, end: s.c };
			}
		},
		{
			id: 'squeeze',
			level: 1,
			weight: 0.5,
			beats: 2,
			make: (s) => {
				const narrow = Math.max(2.6, s.H - 0.9);
				const a = s.xa + (s.xb - s.xa) * 0.3;
				const b = s.xa + (s.xb - s.xa) * 0.8;
				return {
					...straight(s),
					height: (x) => (x >= a && x < b ? narrow : s.H)
				};
			}
		},
		{
			id: 'slalom',
			level: 1,
			weight: 0.8,
			beats: 4,
			make: (s) => {
				const W = s.H + 2.4;
				const mid = room(s.c, W);
				// (a pillar each beat when there's room between them, else every other)
				const every = s.beats[1] - s.beats[0] >= 6 ? 1 : 2;
				const at = s.beats.filter((_, k) => k > 0 && k % every === 0 && k < s.beats.length - 1);
				if (!at.length) return null;
				const gap = 0.55 + (4 - preset.level) * 0.1;
				let side = rng() < 0.5 ? 1 : -1;
				const pillars: Piece['pillars'] = [];
				const keys: { x: number; y: number }[] = [{ x: s.xa, y: s.c }];
				for (const x of at) {
					const y = mid + side * 1.05;
					keys.push({ x: x + 0.5, y });
					pillars.push(
						side > 0
							? { x: Math.floor(x), floor: true, to: Math.floor((y - 0.5 - gap) * 2) / 2 }
							: { x: Math.floor(x), floor: false, to: Math.ceil((y + 0.5 + gap) * 2) / 2 }
					);
					side = -side;
				}
				keys.push({ x: s.xb, y: mid });
				for (let k = 1; k < keys.length; k++)
					if (Math.abs(keys[k].y - keys[k - 1].y) / (keys[k].x - keys[k - 1].x) > slope * 1.4)
						return null;
				const path = (x: number) => {
					for (let k = 1; k < keys.length; k++)
						if (x <= keys[k].x) {
							const f = (x - keys[k - 1].x) / (keys[k].x - keys[k - 1].x || 1);
							return keys[k - 1].y + (keys[k].y - keys[k - 1].y) * ramp(f);
						}
					return mid;
				};
				return {
					path,
					middle: (x) => s.c + (mid - s.c) * ramp((x - s.xa) / 2),
					height: (x) => s.H + (W - s.H) * ramp((x - s.xa) / 2),
					end: mid,
					pillars
				};
			}
		},
		{
			id: 'saw',
			level: 1,
			weight: 0.6,
			beats: 2,
			make: (s) => {
				const W = s.H + 2.2;
				const mid = room(s.c, W);
				const x = (s.xa + s.xb) / 2;
				const side = mid < (floor + top) / 2 ? 1 : -1;
				const length = 1.1 / slope;
				if (x - length < s.xa + 0.5) return null;
				const middle = (p: number) => s.c + (mid - s.c) * ramp((p - s.xa) / 1.5);
				// (around it on the side with more room, and back)
				const around = (p: number) =>
					side * 1.1 * (ramp((p - (x - length * 1.2)) / length) - ramp((p - (x + 0.8)) / length));
				return {
					path: (p) => middle(p) + around(p),
					middle,
					height: (p) => s.H + (W - s.H) * ramp((p - s.xa) / 1.5),
					end: mid,
					saw: { x, y: mid - side * 0.9, radius: 0.75 }
				};
			}
		},
		...(
			[
				['orbUp', 'yellow', 1],
				['orbDown', 'black', -1]
			] as const
		).map(([id, kind, way]): ShipBlock => ({
			id,
			level: 1,
			weight: 0.8,
			beats: 2,
			make: (s) => {
				// (on a click: the beat's)
				const time = clicks.find((t) => Math.abs(t - s.ta) < 40);
				if (time === undefined) return null;
				const d = way * (preset.level >= 2 ? 2.5 : 2);
				const c1 = s.c + d;
				if (c1 < lowest(s.H) || c1 > highest(s.H)) return null;
				const x = world.xAt(time);
				const m = (p: number) => s.c + d * ramp((p - x - speed * 0.03) / (speed * 0.12));
				return {
					path: m,
					middle: m,
					height: () => s.H,
					end: c1,
					orb: { kind, time }
				};
			}
		})),
		{
			id: 'gravity',
			level: 1,
			weight: 0.3,
			beats: 4,
			gravity: true,
			make: (s) => {
				// (upside down it climbs or falls too)
				const inner = { ...s, H: s.H + 0.4, xa: s.xa + 2, xb: s.xb - 2 };
				const d = step() * (s.c < (floor + top) / 2 ? 1 : -1);
				const piece = climb(inner, d) ?? straight(inner);
				return {
					...piece,
					path: (x) => (x < inner.xa ? s.c : piece.path(x)),
					middle: (x) => (x < inner.xa ? s.c : piece.middle(x)),
					portals: [
						{ x: s.xa + 0.5, gravity: -1, y: s.c },
						{ x: s.xb - 1, gravity: 1, y: piece.end }
					]
				};
			}
		},
		{
			id: 'spikes',
			level: 2,
			weight: 0.6,
			beats: 2,
			make: (s) => {
				const H = s.H + 1.3;
				if (s.c < lowest(H) || s.c > highest(H)) return null;
				return { ...straight(s, H), spikes: true };
			}
		},
		{
			id: 'funnel',
			level: 1,
			weight: 0.5,
			beats: 4,
			make: (s) => {
				const W = s.H + 2.4;
				const mid = room(s.c, W);
				const length = s.xb - s.xa;
				return {
					path: (x) => s.c + (mid - s.c) * ramp((x - s.xa) / (length * 0.3)),
					middle: (x) => s.c + (mid - s.c) * ramp((x - s.xa) / (length * 0.3)),
					height: (x) => W - (W - s.H) * ramp((x - s.xa - length * 0.15) / (length * 0.6)),
					end: mid
				};
			}
		}
	];

	// --- The beats it's built on -------------------------------------------------------------
	const beats: number[] = [];
	for (let i = 0; i < ctx.chart.timing.length; i++) {
		const point = ctx.chart.timing[i];
		const until = Math.min(sec.end - 300, ctx.chart.timing[i + 1]?.time ?? Infinity);
		const first = Math.max(0, Math.ceil((sec.start + 300 - point.time) / point.beatLength));
		for (let t = point.time + first * point.beatLength; t < until; t += point.beatLength)
			beats.push(t);
	}
	beats.sort((a, b) => a - b);
	const endX = world.xAt(sec.end - 300);
	if (beats.length < 3) return simulate(world, entry, sec.end, plan);

	/** The walls: each column's floor and ceiling */
	const columns = new Map<number, { low: number; high: number }>();
	const pieces: { xa: number; xb: number; piece: Piece }[] = [];
	const shipOrbs: ShipOrb[] = [];
	let c = clamp(entry.y, lowest(base), highest(base));
	const c0 = c;
	/** Where the ship flies along the whole part */
	const target = (x: number) => {
		let before = c0;
		for (const p of pieces) {
			if (x < p.xa) return before;
			if (x < p.xb) return p.piece.path(x);
			before = p.piece.end;
		}
		return before;
	};
	let state = flyShip(ctx, entry, beats[0], () => c0, [], 0, []).end;
	const events: InputEvent[] = flyShip(ctx, entry, beats[0], () => c0, [], 0, []).events;

	/** The columns of a piece (and those after it, straight on as it ends, to fly on) */
	function columnsOf(piece: Piece, xa: number, xb: number, H: number) {
		const out = new Map<number, { low: number; high: number }>();
		for (let x = Math.ceil(xa); x < Math.min(Math.floor(endX), xb + speed * 0.5); x++) {
			let low = Infinity;
			let high = -Infinity;
			for (let f = 0; f <= 4; f++) {
				const p = x + f / 4;
				const inside = p < xb;
				const m = inside ? piece.middle(p) : piece.end;
				const h = inside ? piece.height(p) : H;
				low = Math.min(low, m - h / 2);
				high = Math.max(high, m + h / 2);
			}
			let l = clamp(Math.floor(low * 2) / 2, floor, top);
			let h = clamp(Math.ceil(high * 2) / 2, floor, top);
			for (const pillar of piece.pillars ?? [])
				if (pillar.x === x) {
					if (pillar.floor) l = Math.max(l, pillar.to);
					else h = Math.min(h, pillar.to);
				}
			out.set(x, { low: l, high: h });
		}
		return out;
	}

	/** Blocks for columns (runs of the same height) */
	function solidsOf(cols: Map<number, { low: number; high: number }>) {
		const made: Solid[] = [];
		const xs = [...cols.keys()].sort((a, b) => a - b);
		for (const side of ['low', 'high'] as const) {
			let run: { x0: number; height: number; last: number } | null = null;
			const flush = () => {
				if (!run) return;
				const x1 = run.last + 1;
				if (side === 'low' && run.height > floor)
					made.push({ x0: run.x0, x1, y0: floor, y1: run.height, style: 2 });
				if (side === 'high' && run.height < top)
					made.push({ x0: run.x0, x1, y0: run.height, y1: top, style: 2 });
				run = null;
			};
			for (const x of xs) {
				const height = cols.get(x)![side];
				if (!run || run.height !== height || x !== run.last + 1) {
					flush();
					run = { x0: x, height, last: x };
				}
				run.last = x;
			}
			flush();
		}
		return made;
	}

	/** Builds a piece, flies it; keeps it (true) or takes it all out again */
	function tryPiece(piece: Piece, s: Span, id: string) {
		const own = columnsOf(piece, s.xa, s.xb, s.H);
		// (with the columns just before it, the ship may still be over them)
		const near = new Map(own);
		for (let x = Math.ceil(s.xa) - 3; x < Math.ceil(s.xa); x++) {
			const col = columns.get(x);
			if (col) near.set(x, col);
		}
		const temp = solidsOf(near).map((b) => world.solids.add(b));
		const undo: (() => void)[] = [];
		if (piece.spikes)
			for (const [x, col] of own) {
				if (x < s.xa + 1 || x + 1 > s.xb - 1) continue;
				const spike = world.spike(x + 0.5, col.low, 1, 'spike');
				const hang = world.spike(x + 0.5, col.high, -1, 'spike');
				undo.push(
					() => world.hazards.remove(spike),
					() => world.hazards.remove(hang)
				);
			}
		if (piece.saw) {
			const saw = world.saw(piece.saw.x, piece.saw.y, piece.saw.radius);
			undo.push(() => world.hazards.remove(saw));
		}
		for (const p of piece.portals ?? []) {
			const portal = world.gravityPortals.add({
				x: p.x,
				y: p.y,
				gravity: p.gravity,
				x0: p.x - 0.6,
				x1: p.x + 0.6
			});
			undo.push(() => world.gravityPortals.remove(portal));
		}
		let so: ShipOrb | null = null;
		if (piece.orb) {
			const { kind, time } = piece.orb;
			const made: ShipOrb = { time };
			made.place = (x, y) => {
				made.orb = world.orbs.add({
					id: world.id(),
					kind,
					x,
					y: Math.round(y * 2) / 2,
					x0: x - 0.6,
					x1: x + 0.6
				});
			};
			so = made;
		}
		const way = (x: number) => (x < s.xb ? piece.path(x) : piece.end);
		const until = Math.min(sec.end, world.timeAt(Math.min(endX, s.xb + speed * 0.4)));
		const orbs = so ? [...shipOrbs, so] : shipOrbs;
		const flown = flyShip(ctx, state, until, way, [], 0, orbs);
		if (so) so.place = undefined;
		if (so?.orb) undo.push(() => world.orbs.remove(so!.orb!));
		let ok = !flown.end.dead && (!piece.orb || !!so?.orb);
		// A bit above and below its way, as a person steers
		for (const off of [0.3, -0.3]) {
			if (!ok) break;
			ok = !flyShip(ctx, state, until, (x) => way(x) + off, [], 0, orbs).end.dead;
		}
		// The orb needed: without it, into the wall
		if (ok && so?.orb) {
			world.orbs.remove(so.orb);
			ok = flyShip(ctx, state, until, way, [], 0, shipOrbs).end.dead;
			world.orbs.add(so.orb);
		}
		// Nowhere to rest: riding along the floor (not pressing) or the ceiling (holding on)
		// mustn't get it through. Spikes where it would slide, if the ways still get through
		if (ok && s.tb - s.ta >= 400)
			for (const held of [false, true]) {
				const trace: { x: number; y: number; time: number }[] = [];
				const lazy = simulate(
					world,
					{ ...state, used: [...state.used], held, buffered: false },
					// (through the piece: what comes after it isn't known yet)
					s.tb - 40,
					[],
					{ trace }
				);
				if (lazy.dead) continue;
				const added: (() => void)[] = [];
				for (const [x, col] of own) {
					if (x < s.xa + 1 || x + 1 > s.xb - 0.5) continue;
					const p = trace.find((q) => q.x >= x + 0.5);
					if (!p) continue;
					const kind = col.high - col.low < 3.6 ? 'small' : 'spike';
					const onFloor = Math.abs(p.y - box - col.low) < 0.1;
					const onCeiling = Math.abs(p.y + box - col.high) < 0.1;
					if (!onFloor && !onCeiling) continue;
					const spike = world.spike(x + 0.5, onFloor ? col.low : col.high, onFloor ? 1 : -1, kind);
					added.push(() => world.hazards.remove(spike));
				}
				const fine =
					added.length > 0 &&
					[0, 0.3, -0.3].every(
						(off) => !flyShip(ctx, state, until, (x) => way(x) + off, [], 0, orbs).end.dead
					);
				if (fine) undo.push(...added);
				else for (const u of added) u();
			}
		let next: PlayerState | null = null;
		let flownEvents: InputEvent[] = [];
		if (ok) {
			const kept = flyShip(ctx, state, s.tb, way, [], 0, orbs);
			ok = !kept.end.dead;
			next = kept.end;
			flownEvents = kept.events;
		}
		for (const b of temp) world.solids.remove(b);
		if (!ok) {
			for (const u of undo.reverse()) u();
			return false;
		}
		for (const [x, col] of own) if (x < s.xb) columns.set(x, col);
		pieces.push({ xa: s.xa, xb: s.xb, piece });
		if (so) shipOrbs.push(so);
		state = next!;
		events.push(...flownEvents.filter((e) => e.time < s.tb));
		if (state.held) {
			// (let go where the piece ends: the next one starts from there)
			events.push({ time: s.tb, down: false });
		}
		used(ctx, `ship-${id}`);
		return true;
	}

	// --- Piece after piece ---------------------------------------------------------------------
	let j = 0;
	let H = base;
	while (j < beats.length - 1) {
		const left = beats.length - 1 - j;
		// (calmer, a bit roomier, where the music rests)
		H = base + (musicalRest(ctx.chart, beats[j]) ? 1.5 : 0);
		const candidates = BLOCKS.filter(
			(b) =>
				b.level <= preset.level &&
				b.beats <= left &&
				(!b.gravity || gravityIn(ctx, 'ship')) &&
				!(musicalRest(ctx.chart, beats[j]) && b.id !== 'straight')
		);
		const order = shuffleByWeight(
			rng,
			candidates.map((b) => ({
				item: b,
				weight:
					b.weight *
					freshness(ctx, `ship-${b.id}`) *
					// (up where it's low, down where it's high)
					(b.id === 'rise' ? 1.4 - (c - floor) / (top - floor) : 1) *
					(b.id === 'fall' ? 0.4 + (c - floor) / (top - floor) : 1)
			}))
		);
		let placed = false;
		for (const block of order) {
			const k = block.beats;
			const span: Span = {
				c,
				H,
				xa: world.xAt(beats[j]),
				xb: world.xAt(beats[j + k]),
				ta: beats[j],
				tb: beats[j + k],
				beats: beats.slice(j, j + k + 1).map((t) => world.xAt(t))
			};
			const piece = block.make(span);
			if (!piece || !tryPiece(piece, span, block.id)) continue;
			c = piece.end;
			j += k;
			placed = true;
			break;
		}
		if (placed) continue;
		// (nothing fits: a beat straight on, roomier; or open)
		const span: Span = {
			c,
			H: H + 1,
			xa: world.xAt(beats[j]),
			xb: world.xAt(beats[j + 1]),
			ta: beats[j],
			tb: beats[j + 1],
			beats: [world.xAt(beats[j]), world.xAt(beats[j + 1])]
		};
		if (!tryPiece(straight(span), span, 'straight')) {
			pieces.push({ xa: span.xa, xb: span.xb, piece: straight(span) });
			const flown = flyShip(ctx, state, span.tb, () => c, [], 0, shipOrbs);
			events.push(...flown.events.filter((e) => e.time < span.tb));
			state = flown.end;
			if (state.held) events.push({ time: span.tb, down: false });
		}
		j += 1;
	}

	// The walls, then the whole part flown once more (as it's played from its start)
	for (const b of solidsOf(columns)) world.solids.add(b);
	const whole = flyShip(ctx, entry, sec.end, target, [], 0, shipOrbs);
	let final = whole.events;
	if (whole.end.dead) {
		const rest = flyShip(ctx, state, sec.end, target, [], 0, shipOrbs);
		final = [...events, ...rest.events];
	}
	// (a release before a press, never two presses in a row)
	final.sort((a, b) => a.time - b.time);
	const clean: InputEvent[] = [];
	let held = false;
	for (const e of final) {
		if (e.down === held) continue;
		clean.push(e);
		held = e.down;
	}
	if (held) clean.push({ time: sec.end, down: false });
	plan.push(...clean);
	used(ctx, 'ship');
	return simulate(world, entry, sec.end, plan);
}
