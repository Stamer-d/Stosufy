// The Dash mode's world and physics: what a level is made of, and how the player moves
// through it. The level generator runs the same physics to check that every level it
// makes can be played (see generate.ts), so what it checks is what you play.
//
// Units: blocks (1 block = one grid square) and seconds; song times in ms. y goes up.

export type Mode = 'cube' | 'ship' | 'ball' | 'wave';

/** Horizontal speeds (blocks per second): slow, normal, fast, faster, fastest */
export const SPEEDS = [8.372, 10.386, 12.914, 15.6, 19.2];

export const PHYSICS = {
	/** Cube: gravity, jump (~2.2 blocks high, ~0.39 s in the air) and fastest fall */
	gravity: 115,
	jump: 22.36,
	maxFall: 30,
	/** Orbs and pads (times the jump) */
	yellowOrb: 1.0,
	pinkOrb: 0.72,
	yellowPad: 1.38,
	pinkPad: 0.92,
	/** Ship: up while holding, down otherwise, and the fastest it goes either way */
	shipUp: 50,
	shipDown: 42,
	shipMaxUp: 9,
	shipMaxDown: 11,
	/** Ball: gravity, fastest fall and the push when it switches */
	ballGravity: 82,
	ballMaxFall: 24,
	ballPush: 2.5
};

/** The player's hitboxes (half sizes): outer (spikes, landing) and inner (crashing) */
export const HITBOX: Record<Mode, { w: number; h: number; inner: number }> = {
	cube: { w: 0.5, h: 0.5, inner: 0.18 },
	ship: { w: 0.45, h: 0.32, inner: 0.14 },
	ball: { w: 0.46, h: 0.46, inner: 0.17 },
	wave: { w: 0.17, h: 0.17, inner: 0.17 }
};

/** How deep the player may sink into the top of a block and still land on it */
const SNAP = (mode: Mode) => HITBOX[mode].h - HITBOX[mode].inner + 0.02;

export interface Rect {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

export interface Solid extends Rect {
	/** How it's drawn: 0 a pillar from the ground, 1 a block structure, 2 a tunnel wall */
	style: number;
}

export interface Hazard {
	kind: 'spike' | 'small' | 'saw';
	/** Its middle */
	x: number;
	/** Its base (spikes) or middle (saws) */
	y: number;
	/** Spikes: 1 points up, -1 down */
	dir: 1 | -1;
	/** Saws: radius */
	size: number;
	/** What kills: a rectangle (spikes) */
	hit: Rect;
	x0: number;
	x1: number;
}

export type OrbKind = 'yellow' | 'pink' | 'blue';
export interface Orb {
	id: number;
	kind: OrbKind;
	x: number;
	y: number;
	x0: number;
	x1: number;
}

export interface Pad {
	id: number;
	kind: 'yellow' | 'pink';
	x: number;
	/** The surface it sits on */
	y: number;
	dir: 1 | -1;
	x0: number;
	x1: number;
}

/** The sloped walls of a wave part: lines through (xs, lo) below and (xs, hi) above */
export interface Walls {
	xs: number[];
	lo: number[];
	hi: number[];
	x0: number;
	x1: number;
}

export interface Section {
	index: number;
	mode: Mode;
	/** Song times (ms) and where (blocks) */
	start: number;
	end: number;
	x0: number;
	x1: number;
	/** Blocks per second */
	speed: number;
	speedIndex: number;
	/** The floor and (not for the cube) the ceiling */
	floor: number;
	ceil: number | null;
	/** Which colours (see render.ts) */
	palette: number;
	kiai: boolean;
}

export interface SpeedSegment {
	time: number;
	x: number;
	speed: number;
}

/** A press (down) or release of the button, at a song time (ms) */
export interface InputEvent {
	time: number;
	down: boolean;
}

export interface Decoration {
	kind: string;
	x: number;
	y: number;
	size: number;
	/** -1 hangs from above */
	dir: 1 | -1;
	x0: number;
	x1: number;
	seed: number;
}

export interface Portal {
	kind: 'mode' | 'speed';
	mode?: Mode;
	speedIndex?: number;
	x: number;
	y: number;
	x0: number;
	x1: number;
}

/** Objects sorted by where they start, for finding the ones near a place quickly */
export class Lane<T extends { x0: number; x1: number }> {
	items: T[] = [];
	private dirty = false;
	private widest = 0;

	add(item: T) {
		const last = this.items[this.items.length - 1];
		if (last && item.x0 < last.x0) this.dirty = true;
		this.items.push(item);
		this.widest = Math.max(this.widest, item.x1 - item.x0);
		return item;
	}

	/** After changing where an object is */
	touch() {
		this.dirty = true;
	}

	remove(item: T) {
		const index = this.items.indexOf(item);
		if (index >= 0) this.items.splice(index, 1);
	}

	removeIf(test: (item: T) => boolean) {
		this.items = this.items.filter((item) => !test(item));
		this.dirty = true;
	}

	private tidy() {
		if (!this.dirty) return;
		this.items.sort((a, b) => a.x0 - b.x0);
		this.widest = this.items.reduce((w, i) => Math.max(w, i.x1 - i.x0), 0);
		this.dirty = false;
	}

	/** The objects that reach into [from, to] */
	*near(from: number, to: number): Generator<T> {
		this.tidy();
		const items = this.items;
		let low = 0;
		let high = items.length;
		const start = from - this.widest;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (items[mid].x0 < start) low = mid + 1;
			else high = mid;
		}
		for (let i = low; i < items.length && items[i].x0 <= to; i++)
			if (items[i].x1 >= from) yield items[i];
	}
}

export class World {
	solids = new Lane<Solid>();
	hazards = new Lane<Hazard>();
	orbs = new Lane<Orb>();
	pads = new Lane<Pad>();
	walls = new Lane<Walls>();
	sections: Section[] = [];
	segments: SpeedSegment[] = [];
	private nextId = 1;

	id() {
		return this.nextId++;
	}

	/** Where the player is at a song time (ms) */
	xAt(time: number) {
		const segments = this.segments;
		let low = 0;
		let high = segments.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (segments[mid].time <= time) low = mid;
			else high = mid - 1;
		}
		const s = segments[low];
		return s.x + ((time - s.time) / 1000) * s.speed;
	}

	/** When the player is at a place (ms) */
	timeAt(x: number) {
		const segments = this.segments;
		let s = segments[0];
		for (const segment of segments) {
			if (segment.x <= x) s = segment;
			else break;
		}
		return s.time + ((x - s.x) / s.speed) * 1000;
	}

	sectionAt(time: number) {
		const sections = this.sections;
		let low = 0;
		let high = sections.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (sections[mid].start <= time) low = mid;
			else high = mid - 1;
		}
		return sections[low];
	}

	spike(x: number, y: number, dir: 1 | -1 = 1, kind: 'spike' | 'small' = 'spike') {
		// Like the spikes of the genre: only the middle of a spike hurts
		const width = kind === 'small' ? 0.22 : 0.3;
		const height = kind === 'small' ? 0.3 : 0.55;
		const hit =
			dir === 1
				? { x0: x - width / 2, x1: x + width / 2, y0: y, y1: y + height }
				: { x0: x - width / 2, x1: x + width / 2, y0: y - height, y1: y };
		return this.hazards.add({ kind, x, y, dir, size: 1, hit, x0: x - 0.5, x1: x + 0.5 });
	}

	saw(x: number, y: number, radius: number) {
		const r = radius * 0.78;
		return this.hazards.add({
			kind: 'saw',
			x,
			y,
			dir: 1,
			size: radius,
			hit: { x0: x - r, x1: x + r, y0: y - r, y1: y + r },
			x0: x - radius,
			x1: x + radius
		});
	}
}

export interface PlayerState {
	/** Song time (ms) */
	time: number;
	x: number;
	/** The middle of the player */
	y: number;
	vy: number;
	/** 1: falls down, -1: falls up */
	gravity: 1 | -1;
	grounded: boolean;
	mode: Mode;
	section: number;
	held: boolean;
	/** A press not used yet (for orbs, the ball), kept while the button is held */
	buffered: boolean;
	/** When the button was last pressed (ms) */
	pressedAt: number;
	/** Orbs and pads used in this attempt */
	used: number[];
	dead: boolean;
	/** For the look: the cube's turn, the last jump, an orb or pad that was just used */
	rotation: number;
	jumpedAt: number;
	boostedAt: number;
	landedAt: number;
}

export function startState(world: World, time: number, y = 0.5): PlayerState {
	const section = world.sectionAt(time);
	return {
		time,
		x: world.xAt(time),
		y: Math.max(section.floor + HITBOX[section.mode].h, y),
		vy: 0,
		gravity: 1,
		grounded: true,
		mode: section.mode,
		section: section.index,
		held: false,
		buffered: false,
		pressedAt: -1e9,
		used: [],
		dead: false,
		rotation: 0,
		jumpedAt: -1e9,
		boostedAt: -1e9,
		landedAt: -1e9
	};
}

export function copyState(state: PlayerState): PlayerState {
	return { ...state, used: [...state.used] };
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** The wave walls' height at a place */
export function wallAt(walls: Walls, x: number) {
	const xs = walls.xs;
	if (x <= xs[0]) return { lo: walls.lo[0], hi: walls.hi[0] };
	const last = xs.length - 1;
	if (x >= xs[last]) return { lo: walls.lo[last], hi: walls.hi[last] };
	let low = 0;
	let high = last;
	while (high - low > 1) {
		const mid = (low + high) >> 1;
		if (xs[mid] <= x) low = mid;
		else high = mid;
	}
	const f = (x - xs[low]) / (xs[high] - xs[low] || 1);
	return {
		lo: walls.lo[low] + (walls.lo[high] - walls.lo[low]) * f,
		hi: walls.hi[low] + (walls.hi[high] - walls.hi[low]) * f
	};
}

/** The fixed step of the physics (ms): 240 steps a second */
export const STEP = 1000 / 240;

/**
 * One step of the physics, to `time` (at most a STEP after the state's). Changes the state;
 * returns what happened (for sounds and effects).
 */
export function step(world: World, s: PlayerState, time: number) {
	const events: string[] = [];
	if (s.dead) return events;
	const dt = Math.max(0, (time - s.time) / 1000);
	const section = world.sectionAt(time);
	if (section.index !== s.section) {
		const before = s.mode;
		s.section = section.index;
		s.mode = section.mode;
		s.gravity = 1;
		s.buffered = false;
		if (section.mode !== before) {
			events.push('portal');
			if (section.mode === 'ship') s.vy *= 0.4;
			if (section.mode === 'ball' || section.mode === 'cube')
				s.vy = Math.min(s.vy, PHYSICS.jump * 0.6);
		}
		s.grounded = false;
	}
	s.time = time;
	s.x = world.xAt(time);
	if (s.buffered && !s.held && time - s.pressedAt > BUFFER) s.buffered = false;
	const speed = section.speed;
	const box = HITBOX[s.mode];
	const g = s.gravity;

	// Orbs and pads
	const player = { x0: s.x - box.w, x1: s.x + box.w, y0: s.y - box.h, y1: s.y + box.h };
	if (s.mode !== 'wave') {
		for (const orb of world.orbs.near(player.x0, player.x1)) {
			if (!s.buffered || s.used.includes(orb.id)) continue;
			const dx = Math.max(0, Math.abs(orb.x - s.x) - box.w);
			const dy = Math.max(0, Math.abs(orb.y - s.y) - box.h);
			if (dx * dx + dy * dy > 0.42 * 0.42) continue;
			s.used.push(orb.id);
			s.buffered = false;
			s.grounded = false;
			s.boostedAt = time;
			events.push('orb');
			const jump = s.mode === 'ball' ? PHYSICS.jump * 0.75 : PHYSICS.jump;
			if (orb.kind === 'blue') {
				s.gravity = (s.gravity * -1) as 1 | -1;
				s.vy = -s.gravity * jump * 0.35;
			} else s.vy = g * jump * (orb.kind === 'pink' ? PHYSICS.pinkOrb : PHYSICS.yellowOrb);
			if (s.mode === 'ship') s.vy *= 0.45;
			break;
		}
		for (const pad of world.pads.near(player.x0, player.x1)) {
			if (s.used.includes(pad.id)) continue;
			const top = pad.dir === 1 ? pad.y + 0.35 : pad.y;
			const bottom = pad.dir === 1 ? pad.y : pad.y - 0.35;
			if (player.y0 > top || player.y1 < bottom || Math.abs(pad.x - s.x) > box.w + 0.4) continue;
			s.used.push(pad.id);
			s.grounded = false;
			s.boostedAt = time;
			events.push('pad');
			s.vy = pad.dir * PHYSICS.jump * (pad.kind === 'pink' ? PHYSICS.pinkPad : PHYSICS.yellowPad);
			if (s.mode === 'ship') s.vy *= 0.5;
		}
	}

	// Moving
	switch (s.mode) {
		case 'cube': {
			if (s.grounded && (s.held || s.buffered)) {
				s.vy = g * PHYSICS.jump;
				s.grounded = false;
				s.buffered = false;
				s.jumpedAt = time;
				events.push('jump');
			}
			s.vy -= g * PHYSICS.gravity * dt;
			s.vy = g > 0 ? Math.max(s.vy, -PHYSICS.maxFall) : Math.min(s.vy, PHYSICS.maxFall);
			break;
		}
		case 'ball': {
			if (s.grounded && s.buffered) {
				s.gravity = (s.gravity * -1) as 1 | -1;
				s.vy = -s.gravity * PHYSICS.ballPush;
				s.grounded = false;
				s.buffered = false;
				s.jumpedAt = time;
				events.push('jump');
			}
			const gb = s.gravity;
			s.vy -= gb * PHYSICS.ballGravity * dt;
			s.vy = Math.max(-PHYSICS.ballMaxFall, Math.min(PHYSICS.ballMaxFall, s.vy));
			break;
		}
		case 'ship': {
			s.vy += (s.held ? PHYSICS.shipUp : -PHYSICS.shipDown) * g * dt;
			const up = g > 0 ? PHYSICS.shipMaxUp : PHYSICS.shipMaxDown;
			const down = g > 0 ? PHYSICS.shipMaxDown : PHYSICS.shipMaxUp;
			s.vy = Math.max(-down, Math.min(up, s.vy));
			s.buffered = false;
			break;
		}
		case 'wave': {
			s.vy = (s.held ? 1 : -1) * g * speed;
			s.buffered = false;
			break;
		}
	}
	const wasGrounded = s.grounded;
	s.y += s.vy * dt;
	s.grounded = false;

	// The floor and ceiling of the part
	const floor = section.floor;
	if (s.y - box.h < floor) {
		s.y = floor + box.h;
		if (s.vy < 0) s.vy = 0;
		if (s.gravity > 0 || s.mode === 'ship' || s.mode === 'wave') s.grounded = true;
	}
	if (section.ceil !== null && s.y + box.h > section.ceil) {
		s.y = section.ceil - box.h;
		if (s.vy > 0) s.vy = 0;
		if (s.gravity < 0 || s.mode === 'ship' || s.mode === 'wave') s.grounded = true;
	}

	// Blocks: land on them, slide along them, or crash into them
	const snap = SNAP(s.mode);
	for (const solid of world.solids.near(s.x - box.w, s.x + box.w)) {
		const outer = { x0: s.x - box.w, x1: s.x + box.w, y0: s.y - box.h, y1: s.y + box.h };
		if (!overlaps(outer, solid)) continue;
		const inner = {
			x0: s.x - box.inner,
			x1: s.x + box.inner,
			y0: s.y - box.inner,
			y1: s.y + box.inner
		};
		if (s.mode === 'wave' || overlaps(inner, solid)) {
			s.dead = true;
			events.push('death');
			return events;
		}
		const fromTop = solid.y1 - outer.y0;
		const fromBottom = outer.y1 - solid.y0;
		if (fromTop <= fromBottom && fromTop <= snap && (s.vy <= 0.01 || s.mode === 'ship')) {
			s.y = solid.y1 + box.h;
			if (s.vy < 0) s.vy = 0;
			if (s.gravity > 0 || s.mode === 'ship') s.grounded = true;
		} else if (fromBottom < fromTop && fromBottom <= snap && (s.vy >= -0.01 || s.mode === 'ship')) {
			s.y = solid.y0 - box.h;
			if (s.vy > 0) s.vy = 0;
			if (s.gravity < 0 || s.mode === 'ship') s.grounded = true;
		}
	}
	if (s.grounded && !wasGrounded && s.mode !== 'wave') {
		s.landedAt = time;
		events.push('land');
	}

	// What kills
	const hurt = {
		x0: s.x - box.w + 0.04,
		x1: s.x + box.w - 0.04,
		y0: s.y - box.h + 0.04,
		y1: s.y + box.h - 0.04
	};
	for (const hazard of world.hazards.near(hurt.x0, hurt.x1)) {
		if (hazard.kind === 'saw') {
			const dx = Math.max(0, Math.abs(hazard.x - s.x) - (box.w - 0.04));
			const dy = Math.max(0, Math.abs(hazard.y - s.y) - (box.h - 0.04));
			if (dx * dx + dy * dy < (hazard.size * 0.78) ** 2) {
				s.dead = true;
				break;
			}
		} else if (overlaps(hurt, hazard.hit)) {
			s.dead = true;
			break;
		}
	}
	if (!s.dead && s.mode === 'wave') {
		for (const walls of world.walls.near(s.x, s.x)) {
			const at = wallAt(walls, s.x);
			// Along a slope the wave touches it a bit before its middle gets there
			if (s.y - box.h * 1.2 < at.lo || s.y + box.h * 1.2 > at.hi) s.dead = true;
		}
	}
	if (s.y < floor - 4) s.dead = true;
	if (s.dead) {
		events.push('death');
		return events;
	}

	// The look
	if (s.mode === 'cube') {
		if (s.grounded) {
			const quarter = Math.PI / 2;
			const target = Math.round(s.rotation / quarter) * quarter;
			s.rotation += (target - s.rotation) * Math.min(1, dt * 30);
		} else s.rotation += g * dt * ((Math.PI / 0.39) * 1.0);
	} else if (s.mode === 'ball') s.rotation += (s.gravity * speed * dt) / 0.5;
	else s.rotation = 0;
	return events;
}

/** Sets the button (with what a press buffers) */
/** How long a press counts after it was let go (ms): a tap a bit before landing still jumps */
export const BUFFER = 100;

export function press(s: PlayerState, down: boolean) {
	if (down && !s.held) {
		s.buffered = true;
		s.pressedAt = s.time;
	}
	s.held = down;
}

/**
 * Runs the physics from a state to a time with presses and releases (sorted, from
 * `from` on). Returns the end state and, if asked, where the player was along the way.
 */
export function simulate(
	world: World,
	start: PlayerState,
	until: number,
	inputs: InputEvent[],
	options: { from?: number; trace?: { x: number; y: number; time: number }[] } = {}
) {
	const s = copyState(start);
	let index = options.from ?? 0;
	while (index < inputs.length && inputs[index].time < s.time) index++;
	while (s.time < until && !s.dead) {
		const next = Math.min(until, s.time + STEP);
		while (index < inputs.length && inputs[index].time <= next) {
			press(s, inputs[index].down);
			index++;
		}
		step(world, s, next);
		options.trace?.push({ x: s.x, y: s.y, time: s.time });
	}
	return s;
}
