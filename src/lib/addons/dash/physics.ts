// The Dash mode's world and physics: what a level is made of, and how the player moves
// through it. The level generator runs the same physics to check that every level it
// makes can be played (see generate.ts), so what it checks is what you play.
//
// Units: blocks and seconds; song times in ms, y up. Cube constants, integration order
// and velocity rounding were checked against the local GD 2.2091-compatible executable
// through REA. Other mode/hitbox approximations remain; see docs/rea-status.md.

import { flightStep } from './native-flight';
import { orbVelocity } from './native-orbs';
import { nativeRound } from './native-number';
import { padVelocity } from './native-pads';
import { robotStep } from './native-robot';

export type Mode = 'cube' | 'ship' | 'ball' | 'ufo' | 'wave' | 'swing' | 'spider' | 'robot';

/** Horizontal speeds (blocks per second): 0.5Ã—, 1Ã—, 2Ã—, 3Ã—, 4Ã— */
export const SPEEDS = [8.372, 10.386, 12.914, 15.6, 19.2];

const U = 1 / 30;

/** GD velocity is in units per 1/54 s; setYVelocity rounds to .001, ties away from zero. */
export function quantizeVelocity(blocksPerSecond: number) {
	return (nativeRound((blocksPerSecond * 30) / 54) * 54) / 30;
}

/** The cube's gravity and jump, by speed (blocks/sÂ², blocks/s) */
// Native doubles from updateTimeMod (0x1404ff370); see docs/rea/physics-reference.json.
const CUBE = [
	{ gravity: 0.940199 * 54 ** 2 * U, jump: 10.620032 * 54 * U },
	{ gravity: 0.9581990242004395 * 54 ** 2 * U, jump: 11.180031776428223 * 54 * U },
	{ gravity: 0.957199 * 54 ** 2 * U, jump: 11.420032 * 54 * U },
	{ gravity: 0.961199 * 54 ** 2 * U, jump: 11.230032 * 54 * U },
	{ gravity: 0.961199 * 54 ** 2 * U, jump: 11.230032 * 54 * U }
];

/** Builder proposal constants; runtime flight/orbs/pads use the native-* modules. */
export const PHYSICS = {
	maxFall: 810 * U,
	/** Ship and UFO: the speed where their acceleration changes */
	threshold: 103.5 * U,
	shipHoldSlow: 1397.05 * U,
	shipHoldFast: 1117.64 * U,
	shipFallFast: 1341.17 * U,
	shipFallSlow: 894.11 * U,
	shipMaxUp: 432 * U,
	shipMaxDown: 345.6 * U,
	ballGravity: 1676.47 * U,
	ballSwitch: 181.1 * U,
	ufoJump: 371.03 * U,
	ufoFallSlow: 1114.56 * U,
	ufoFallFast: 1671.84 * U,
	/** Orbs (times the jump) and pads (blocks/s) */
	orb: {
		yellow: 1,
		pink: 0.72,
		red: 1.38,
		green: 1,
		blue: 0.4,
		black: (-810 * U) / (603.72 * U)
	},
	pad: { yellow: 864 * U, pink: 561.6 * U, red: 1080 * U, blue: 345.6 * U },
	/** How much an orb or pad gives in the other modes (times the cube's) */
	modeFactor: {
		cube: 1,
		ship: 0.75,
		ball: 0.7,
		ufo: 0.75,
		wave: 0,
		swing: 0.6,
		robot: 1,
		spider: 0.7
	} as Record<Mode, number>
};

/** The cube's gravity and jump at a speed */
export function cubeAt(speedIndex: number) {
	return CUBE[Math.max(0, Math.min(4, speedIndex))];
}

/** The player's half sizes: outer (spikes, landing, orbs) and inner (crashing into blocks) */
export function hitbox(mode: Mode, mini = false) {
	if (mode === 'wave')
		return { w: mini ? 0.1 : 1 / 6, h: mini ? 0.1 : 1 / 6, inner: mini ? 0.1 : 1 / 6 };
	const f = mini ? 0.6 : 1;
	return { w: 0.5 * f, h: 0.5 * f, inner: 0.15 * f };
}

/** How deep the player may sink into the top of a block and still land on it */
const SNAP = (mode: Mode) => (mode === 'ship' || mode === 'ufo' || mode === 'swing' ? 7 : 10) * U;

export interface Rect {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

export interface Solid extends Rect {
	/** How it's drawn: 0 a structure, 1 a slab (floating platform), 2 a tunnel wall */
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

/**
 * Orbs, used with a press while touching them: jumps (yellow, pink, red), down at once
 * (black), gravity turned around (blue, green), a dash straight on while held (dash), and a
 * jump to the surface on the other side at once (spider)
 */
export type OrbKind = 'yellow' | 'pink' | 'red' | 'blue' | 'green' | 'black' | 'dash' | 'spider';
export interface Orb {
	id: number;
	kind: OrbKind;
	x: number;
	y: number;
	/** A dash orb's way: 1 up at 24Â°, 0 straight on, -1 down */
	dir?: number;
	x0: number;
	x1: number;
}

export type PadKind = 'yellow' | 'pink' | 'red' | 'blue';
export interface Pad {
	id: number;
	kind: PadKind;
	x: number;
	/** The surface it sits on */
	y: number;
	/** 1 on a floor, -1 under a ceiling */
	dir: 1 | -1;
	x0: number;
	x1: number;
}

/** A gravity portal: up (falls up) or back down */
export interface GravityPortal {
	/** The generator must retain this section-entry reset when repairing nearby slabs. */
	sectionEntry?: boolean;
	x: number;
	y: number;
	gravity: 1 | -1;
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
	mini: boolean;
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
	/**
	 * How intense the music is here, from the song's calmest parts (0) to its peak (1): how
	 * demanding the part is built (missing on older level data)
	 */
	intensity?: number;
	/** Seen mirrored, right to left (only the look: the physics is the same) */
	mirror?: boolean;
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

export interface Portal {
	kind: 'mode' | 'speed' | 'size' | 'mirror';
	mode?: Mode;
	speedIndex?: number;
	mini?: boolean;
	/** A mirror portal: from here on mirrored (or back) */
	mirrored?: boolean;
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
	near(from: number, to: number): T[] {
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
		const found: T[] = [];
		for (let i = low; i < items.length && items[i].x0 <= to; i++)
			if (items[i].x1 >= from) found.push(items[i]);
		return found;
	}
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const EPS = 1e-6;

export class World {
	solids = new Lane<Solid>();
	hazards = new Lane<Hazard>();
	orbs = new Lane<Orb>();
	pads = new Lane<Pad>();
	walls = new Lane<Walls>();
	gravityPortals = new Lane<GravityPortal>();
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
		// (the last segment that starts at or before it: found by halves, it's asked for every
		// thing drawn, every frame)
		const segments = this.segments;
		let low = 0;
		let high = segments.length - 1;
		if (segments[0].x > x) high = 0;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (segments[mid].x <= x) low = mid;
			else high = mid - 1;
		}
		const s = segments[low];
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

	/** A spike's hitbox: only its middle hurts (6Ã—12 units; small ones 6Ã—5.6) */
	static spikeHit(x: number, y: number, dir: 1 | -1, kind: 'spike' | 'small'): Rect {
		const w = 0.1;
		const [from, to] = kind === 'small' ? [0.06, 0.25] : [0.3, 0.7];
		return dir === 1
			? { x0: x - w, x1: x + w, y0: y + from, y1: y + to }
			: { x0: x - w, x1: x + w, y0: y - to, y1: y - from };
	}

	spike(x: number, y: number, dir: 1 | -1 = 1, kind: 'spike' | 'small' = 'spike') {
		const hit = World.spikeHit(x, y, dir, kind);
		return this.hazards.add({ kind, x, y, dir, size: 1, hit, x0: x - 0.5, x1: x + 0.5 });
	}

	saw(x: number, y: number, radius: number) {
		const r = radius * 0.72;
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

	/** Whether a place is inside a block (or below the floor, above the ceiling) */
	solidAt(x0: number, x1: number, y0: number, y1: number) {
		const box = { x0: x0 + EPS, x1: x1 - EPS, y0: y0 + EPS, y1: y1 - EPS };
		return this.solids.near(x0, x1).some((s) => overlaps(box, s));
	}

	/** Whether a whole stretch is a surface to stand on at a height (dir 1) or hang under (-1) */
	surfaceAt(x0: number, x1: number, y: number, dir: 1 | -1) {
		const section = this.sectionAt(this.timeAt((x0 + x1) / 2));
		if (dir === 1 && Math.abs(y - section.floor) < EPS) return true;
		if (dir === -1 && section.ceil !== null && Math.abs(y - section.ceil) < EPS) return true;
		// Covered by the tops (or bottoms) of blocks, with no gap
		const tops = this.solids
			.near(x0, x1)
			.filter((s) => Math.abs((dir === 1 ? s.y1 : s.y0) - y) < EPS)
			.sort((a, b) => a.x0 - b.x0);
		let reached = x0;
		for (const s of tops) {
			if (s.x0 > reached + EPS) return false;
			reached = Math.max(reached, s.x1);
			if (reached >= x1 - EPS) return true;
		}
		return false;
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
	mini: boolean;
	section: number;
	held: boolean;
	/** A press not used yet (for orbs, the UFO, the swing), while the button is held */
	buffered: boolean;
	/** The ball and the spider switch once per press */
	switched: boolean;
	/** Orbs and pads used in this attempt */
	used: number[];
	dead: boolean;
	/** For the look: the cube's turn, the last jump, an orb or pad that was just used */
	rotation: number;
	jumpedAt: number;
	boostedAt: number;
	/** Native flight cap-bypass state (not the particle timestamp). */
	velocityBoosted: boolean;
	robotCharge: number;
	robotActive: boolean;
	robotReleased: boolean;
	landedAt: number;
	/** The spider's last jump: from where to where (for its trail) */
	teleport: { x: number; from: number; to: number; time: number } | null;
	/** Dashing (from a dash orb, while held): its speed up or down (blocks/s) */
	dash: number | null;
}

export function startState(world: World, time: number, y?: number): PlayerState {
	const section = world.sectionAt(time);
	const box = hitbox(section.mode, section.mini);
	return {
		time,
		x: world.xAt(time),
		y: Math.max(section.floor + box.h, y ?? section.floor + box.h),
		vy: 0,
		gravity: 1,
		grounded: true,
		mode: section.mode,
		mini: section.mini,
		section: section.index,
		held: false,
		buffered: false,
		switched: false,
		used: [],
		dead: false,
		rotation: 0,
		jumpedAt: -1e9,
		boostedAt: -1e9,
		velocityBoosted: false,
		robotCharge: 1.5,
		robotActive: false,
		robotReleased: true,
		landedAt: -1e9,
		teleport: null,
		dash: null
	};
}

export function copyState(state: PlayerState): PlayerState {
	return { ...state, used: [...state.used] };
}

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
 * Falling is held to the most (`maxFall`); going up isn't: a jump, an orb or a pad may launch
 * it faster (a red pad higher than a yellow one)
 */
const capFall = (vy: number, gravity: 1 | -1) =>
	gravity > 0 ? Math.max(-PHYSICS.maxFall, vy) : Math.min(PHYSICS.maxFall, vy);

/** Each changed Ship/UFO/Wave/Swing toggle halves vy, on entry AND exit.
 * Ball/Spider toggles do not. Native 0x1404fa150 dispatches the old mode's disable path. */
function enterMode(s: PlayerState, from: Mode, to: Mode) {
	if (to === 'robot') {
		s.robotCharge = 1.5;
		s.robotActive = false;
	}
	const halves = (m: Mode) => m === 'ship' || m === 'ufo' || m === 'wave' || m === 'swing';
	if (halves(from)) s.vy *= 0.5;
	if (halves(to)) s.vy *= 0.5;
	if (halves(from) || halves(to)) s.grounded = false;
}

/** Where the spider lands when it jumps: the first surface the other way */
function spiderTarget(
	world: World,
	s: PlayerState,
	section: Section,
	box: { w: number; h: number }
) {
	const up = s.gravity > 0;
	let target = up ? (section.ceil ?? s.y + 30) : section.floor;
	for (const solid of world.solids.near(s.x - box.w + 0.05, s.x + box.w - 0.05)) {
		if (up && solid.y0 >= s.y + box.h - 0.01 && solid.y0 < target) target = solid.y0;
		if (!up && solid.y1 <= s.y - box.h + 0.01 && solid.y1 > target) target = solid.y1;
	}
	return up ? target - box.h : target + box.h;
}

/** pushButton processes already touching rings before the ordinary ground jump. */
function activateOrb(world: World, s: PlayerState, orb: Orb, time: number, events: string[]) {
	const section = world.sectionAt(time),
		cube = cubeAt(section.speedIndex),
		box = hitbox(s.mode, s.mini);
	if (orb.kind === 'red' || orb.kind === 'black') s.velocityBoosted = true;
	s.used.push(orb.id);
	s.buffered = false;
	s.switched = true;
	s.grounded = false;
	s.boostedAt = time;
	events.push('orb');
	if (orb.kind === 'blue') {
		s.vy = orbVelocity(s.mode, 'blue', s.mini, s.gravity, cube.jump);
		s.gravity = (s.gravity * -1) as 1 | -1;
	} else if (orb.kind === 'green') {
		s.gravity = (s.gravity * -1) as 1 | -1;
		s.vy = orbVelocity(s.mode, 'green', s.mini, s.gravity, cube.jump);
	} else if (orb.kind === 'dash') s.vy = s.dash = (orb.dir ?? 0) * section.speed * 0.45;
	else if (orb.kind === 'spider') {
		const from = s.y;
		s.y = spiderTarget(world, s, section, box);
		s.teleport = { x: s.x, from, to: s.y, time };
		s.gravity = (s.gravity * -1) as 1 | -1;
		s.vy = 0;
		s.grounded = true;
	} else s.vy = orbVelocity(s.mode, orb.kind, s.mini, s.gravity, cube.jump);
	s.robotActive = true;
}

function touchingOrb(world: World, s: PlayerState) {
	if (!s.buffered || !s.held || s.mode === 'wave') return undefined;
	const box = hitbox(s.mode, s.mini);
	return world.orbs
		.near(s.x - box.w - 0.6, s.x + box.w + 0.6)
		.find(
			(orb) =>
				!s.used.includes(orb.id) &&
				Math.abs(orb.x - s.x) <= box.w + 0.6 &&
				Math.abs(orb.y - s.y) <= box.h + 0.6
		);
}
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
		const modeChanged = section.mode !== before;
		const sizeChanged = section.mini !== s.mini;
		s.section = section.index;
		// A musical section boundary is not an implicit gameplay portal.
		if (modeChanged || sizeChanged) {
			events.push('portal');
			if (modeChanged) enterMode(s, before, section.mode);
			s.mode = section.mode;
			s.mini = section.mini;
			// Mode toggles preserve gravity, held/buffered input and ongoing dash state.
			// Gravity portals and explicit presses perform those independent state changes.
		}
	}
	const prevX = s.x;
	s.time = time;
	s.x = world.xAt(time);
	const speed = section.speed;
	const box = hitbox(s.mode, s.mini);
	const cube = cubeAt(section.speedIndex);

	// GD 2.2091: PlayerObject::update calls updateJump before applying dy;
	// GJBaseGameLayer checks collisions after PlayerObject::update. See docs/rea-status.md.
	const wasGrounded = s.grounded;
	const ring = touchingOrb(world, s);
	if (ring) activateOrb(world, s, ring, time, events);
	// The new speed up or down. Dashing: straight on while held (then as before)
	const gg = s.gravity;
	if (s.dash !== null && !s.held) s.dash = null;
	const mode = s.dash !== null ? 'dash' : s.mode;
	if (s.dash !== null) {
		s.vy = s.dash;
		s.grounded = false;
	}
	switch (mode) {
		case 'cube': {
			if (s.grounded && s.held && !ring) {
				s.vy = gg * cube.jump * (s.mini ? 0.8 : 1);
				s.grounded = false;
				s.buffered = false;
				s.jumpedAt = time;
				events.push('jump');
			} else s.vy -= gg * cube.gravity * dt;
			s.vy = capFall(s.vy, s.gravity);
			break;
		}
		case 'robot': {
			const result = robotStep(
				{
					vy: s.vy,
					gravity: s.gravity,
					mini: s.mini,
					grounded: s.grounded,
					held: s.held,
					buffered: s.buffered,
					active: s.robotActive,
					released: s.robotReleased,
					charge: s.robotCharge
				},
				cube,
				dt
			);
			s.vy = capFall(result.vy, s.gravity);
			s.robotCharge = result.charge;
			s.robotActive = result.active;
			s.robotReleased = result.released;
			if (result.jumped) {
				s.grounded = false;
				s.buffered = false;
				s.jumpedAt = time;
				events.push('jump');
			}
			break;
		}
		case 'ball': {
			if (s.grounded && s.held && !s.switched) {
				s.gravity = (s.gravity * -1) as 1 | -1;
				s.vy = -s.gravity * PHYSICS.ballSwitch * (s.mini ? 0.8 : 1);
				s.grounded = false;
				s.buffered = false;
				s.switched = true;
				s.jumpedAt = time;
				events.push('jump');
			} else s.vy -= gg * PHYSICS.ballGravity * dt;
			s.vy = capFall(s.vy, s.gravity);
			break;
		}
		case 'spider': {
			if (s.grounded && s.held && !s.switched) {
				const from = s.y;
				s.y = spiderTarget(world, s, section, box);
				s.teleport = { x: s.x, from, to: s.y, time };
				s.gravity = (s.gravity * -1) as 1 | -1;
				s.vy = 0;
				s.switched = true;
				s.buffered = false;
				s.grounded = true;
				s.jumpedAt = time;
				events.push('jump');
			} else if (!s.grounded) s.vy -= gg * PHYSICS.ballGravity * dt;
			s.vy = capFall(s.vy, s.gravity);
			break;
		}
		case 'ship':
		case 'ufo':
		case 'swing': {
			const next = flightStep(
				mode,
				{
					vy: s.vy,
					gravity: s.gravity,
					mini: s.mini,
					held: s.held,
					buffered: s.buffered,
					boosted: s.velocityBoosted,
					storedGravity: (cube.gravity * 30) / 54 ** 2
				},
				dt
			);
			s.vy = next.vy;
			s.gravity = next.gravity;
			s.velocityBoosted = next.boosted;
			s.buffered = false;
			if (next.jumped) {
				s.grounded = false;
				s.jumpedAt = time;
				events.push('jump');
			}
			break;
		}
		case 'wave':
			s.buffered = false;
			break;
	}

	if (s.mode !== 'wave' && s.dash === null) s.vy = quantizeVelocity(s.vy);
	if (s.mode === 'wave') s.vy = (s.held ? 1 : -1) * s.gravity * speed * (s.mini ? 2 : 1);
	s.y += s.vy * dt;
	s.grounded = false;

	// Gravity portals
	for (const portal of world.gravityPortals.near(prevX, s.x)) {
		if (portal.x > prevX && portal.x <= s.x && portal.gravity !== s.gravity) {
			s.gravity = portal.gravity;
			s.vy = s.vy / 2;
			events.push('gravity');
		}
	}

	// Orbs and pads
	const player = { x0: s.x - box.w, x1: s.x + box.w, y0: s.y - box.h, y1: s.y + box.h };
	if (s.mode !== 'wave') {
		for (const orb of world.orbs.near(player.x0 - 0.6, player.x1 + 0.6)) {
			if (!s.buffered || !s.held || s.used.includes(orb.id)) continue;
			if (Math.abs(orb.x - s.x) > box.w + 0.6 || Math.abs(orb.y - s.y) > box.h + 0.6) continue;
			activateOrb(world, s, orb, time, events);
			break;
		}
		for (const pad of world.pads.near(player.x0, player.x1)) {
			if (s.used.includes(pad.id)) continue;
			const near = pad.dir === 1 ? player.y0 <= pad.y + 0.2 : player.y1 >= pad.y - 0.2;
			const touching = pad.dir === 1 ? player.y1 > pad.y : player.y0 < pad.y;
			if (!near || !touching || Math.abs(pad.x - s.x) > box.w + 0.42) continue;
			if (pad.kind === 'blue' && s.gravity !== pad.dir) continue;
			s.velocityBoosted = pad.kind === 'red' || pad.kind === 'blue';
			s.used.push(pad.id);
			s.grounded = false;
			s.boostedAt = time;
			events.push('pad');
			s.vy = padVelocity(s.mode, pad.kind, s.mini, s.gravity);
			if (pad.kind === 'blue') s.gravity = (s.gravity * -1) as 1 | -1;
		}
	}

	// Blocks: land on them, slide along them, or crash into them
	const snap = SNAP(s.mode);
	const g = s.gravity;
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
		const flying = s.mode === 'ship' || s.mode === 'ufo' || s.mode === 'swing';
		// Landing on a top (falling down) or under a bottom (falling up), and flying modes and
		// the ball bump along the other side
		const downward = g > 0 ? s.vy <= 0 : s.vy < 0;
		const upward = g < 0 ? s.vy >= 0 : s.vy > 0;
		if (
			fromTop <= fromBottom &&
			fromTop <= snap &&
			(g > 0 ? downward : flying || s.mode === 'ball' ? s.vy <= 0 : false)
		) {
			s.y = solid.y1 + box.h;
			if (s.vy < 0) s.vy = 0;
			if (g > 0 || flying) s.grounded = true;
		} else if (
			fromBottom < fromTop &&
			fromBottom <= (g < 0 ? snap : 0.2) &&
			(g < 0 ? upward : flying || s.mode === 'ball' ? s.vy >= 0 : false)
		) {
			s.y = solid.y0 - box.h;
			if (s.vy > 0) s.vy = 0;
			if (g < 0 || flying) s.grounded = true;
		}
	}

	// The floor and ceiling of the part (before what kills: sliding along the floor, it's on it)
	const floor = section.floor;
	if (s.y - box.h <= floor) {
		s.y = floor + box.h;
		if (s.vy < 0) s.vy = 0;
		if (
			s.gravity > 0 ||
			s.mode === 'ship' ||
			s.mode === 'ufo' ||
			s.mode === 'wave' ||
			s.mode === 'swing'
		)
			s.grounded = true;
	}
	if (section.ceil !== null && s.y + box.h >= section.ceil) {
		s.y = section.ceil - box.h;
		if (s.vy > 0) s.vy = 0;
		if (
			s.gravity < 0 ||
			s.mode === 'ship' ||
			s.mode === 'ufo' ||
			s.mode === 'wave' ||
			s.mode === 'swing'
		)
			s.grounded = true;
	}
	// (nothing in a cube part is that high: up and away there is gone)
	if (s.y < floor - 6 || (section.ceil === null && s.y > 30)) {
		s.dead = true;
		events.push('death');
		return events;
	}

	// What kills. The spider's jump to the other side (a press or a spider orb) is all of the way
	// it jumps in this step: a saw or spike on that way kills, it doesn't jump through it
	const jumped = s.teleport && s.teleport.time === time ? s.teleport : null;
	const yLow = jumped ? Math.min(jumped.from, jumped.to) : s.y;
	const yHigh = jumped ? Math.max(jumped.from, jumped.to) : s.y;
	for (const hazard of world.hazards.near(player.x0 - 1, player.x1 + 1)) {
		const p = { x0: s.x - box.w, x1: s.x + box.w, y0: yLow - box.h, y1: yHigh + box.h };
		if (hazard.kind === 'saw') {
			const dx = Math.max(0, Math.abs(hazard.x - s.x) - box.w);
			const dy = Math.max(0, Math.max(yLow - hazard.y, hazard.y - yHigh) - box.h);
			if (dx * dx + dy * dy < (hazard.size * 0.72) ** 2) s.dead = true;
		} else if (overlaps(p, hazard.hit)) s.dead = true;
		if (s.dead) break;
	}
	if (!s.dead && s.mode === 'wave') {
		for (const walls of world.walls.near(s.x, s.x)) {
			const at = wallAt(walls, s.x);
			// Along a slope the wave touches it a bit before its middle gets there
			if (s.y - box.h * 1.35 < at.lo || s.y + box.h * 1.35 > at.hi) s.dead = true;
		}
	}
	if (s.dead) {
		events.push('death');
		return events;
	}

	const landed = s.grounded && !wasGrounded;
	if (landed && s.mode !== 'wave') {
		s.landedAt = time;
		events.push('land');
		// Landing clears a press made in the air (but holding still jumps)
		if (s.mode !== 'ufo' && s.mode !== 'swing') s.buffered = false;
	}

	// The look
	if (s.mode === 'cube') {
		if (s.grounded) {
			const quarter = Math.PI / 2;
			const target = Math.round(s.rotation / quarter) * quarter;
			s.rotation += (target - s.rotation) * Math.min(1, (dt / 0.075) * 2);
		} else s.rotation += gg * dt * (Math.PI / (s.mini ? 0.328 : 0.41));
	} else if (s.mode === 'ball') s.rotation += (s.gravity * dt * Math.PI * 2) / 0.5;
	else if (s.mode === 'spider' || s.mode === 'robot') s.rotation = 0;
	return events;
}

/** Sets the button */
export function press(s: PlayerState, down: boolean) {
	if (down && !s.held) {
		s.buffered = true;
		s.switched = false;
	}
	if (!down) {
		s.robotReleased = true;
		s.buffered = false;
		s.switched = false;
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
	// Whole steps only, on the grid from the level's start: the same steps the game takes
	while (s.time + STEP <= until + 1e-6 && !s.dead) {
		const next = s.time + STEP;
		while (index < inputs.length && inputs[index].time <= next) {
			press(s, inputs[index].down);
			index++;
		}
		step(world, s, next);
		options.trace?.push({ x: s.x, y: s.y, time: s.time });
	}
	return s;
}
