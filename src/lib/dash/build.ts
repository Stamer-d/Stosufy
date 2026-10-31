// What the level builders share: the presets of the difficulties, randomness, putting things
// into the world so they can be taken out again, checking them with the physics, and the
// rules every level keeps (spikes only on surfaces, nothing inside a block, every orb needed).

import type { DashChart } from './chart';
import {
	STEP,
	World,
	simulate,
	type InputEvent,
	type OrbKind,
	type PadKind,
	type PlayerState,
	type Section,
	type Solid
} from './physics';

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane', 'extreme'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface Preset {
	level: number;
	/** What a click costs: notes weaker than this aren't clicks */
	cost: number;
	/** The shortest time between two clicks (s) */
	gap: number;
	/** How early or late a press may be (ms) */
	tolerance: number;
	spikes: number;
	/** The highest a cube part builds (blocks) */
	height: number;
	/** The ship's tunnel and the wave's corridor: half their height (blocks) */
	ship: number;
	wave: number;
	/** The shortest time between two turns of the wave (s) */
	waveGap: number;
	/** Speeds: normal parts, the kiai */
	speeds: [number, number];
	/** How many orbs in a row at most */
	chain: number;
	/** Parts that are small */
	mini: number;
	/** The kinds of parts there are */
	modes: string[];
}

export const PRESETS: Record<Difficulty, Preset> = {
	easy: {
		level: 0,
		cost: 1.2,
		gap: 0.52,
		tolerance: 80,
		spikes: 2,
		height: 2,
		ship: 2.5,
		wave: 0,
		waveGap: 0.3,
		speeds: [1, 1],
		chain: 0,
		mini: 0,
		modes: ['cube', 'ship', 'ball', 'ufo']
	},
	normal: {
		level: 1,
		cost: 0.95,
		gap: 0.36,
		tolerance: 65,
		spikes: 2,
		height: 3,
		ship: 2.2,
		wave: 1.75,
		waveGap: 0.22,
		speeds: [1, 2],
		chain: 1,
		mini: 0,
		modes: ['cube', 'ship', 'ball', 'ufo', 'wave']
	},
	hard: {
		level: 2,
		cost: 0.72,
		gap: 0.27,
		tolerance: 55,
		spikes: 3,
		height: 4,
		ship: 1.9,
		wave: 1.5,
		waveGap: 0.15,
		speeds: [1, 2],
		chain: 2,
		mini: 0.15,
		modes: ['cube', 'ship', 'ball', 'ufo', 'wave', 'swing', 'spider']
	},
	insane: {
		level: 3,
		cost: 0.48,
		gap: 0.2,
		tolerance: 48,
		spikes: 3,
		height: 4,
		ship: 1.65,
		wave: 1.25,
		waveGap: 0.11,
		speeds: [2, 3],
		chain: 2,
		mini: 0.22,
		modes: ['cube', 'ship', 'ball', 'ufo', 'wave', 'swing', 'spider']
	},
	extreme: {
		level: 4,
		cost: 0.25,
		gap: 0.15,
		tolerance: 42,
		spikes: 3,
		height: 5,
		ship: 1.45,
		wave: 1.0,
		waveGap: 0.075,
		speeds: [2, 3],
		chain: 3,
		mini: 0.3,
		modes: ['cube', 'ship', 'ball', 'ufo', 'wave', 'swing', 'spider']
	}
};

// --- Randomness, the same for the same song ----------------------------------------------

export function hash(text: string) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function random(seed: number) {
	let a = seed || 1;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type Random = () => number;
export const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
/** On the grid of half blocks */
export const half = (x: number) => Math.round(x * 2) / 2;

/** Picks one by weight */
export function weighted<T>(rng: Random, items: { item: T; weight: number }[]): T | null {
	const total = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
	if (total <= 0) return null;
	let r = rng() * total;
	for (const i of items) {
		r -= Math.max(0, i.weight);
		if (r <= 0) return i.item;
	}
	return items[items.length - 1].item;
}

/** Orders by weight with randomness: the likelier first, but not always */
export function shuffleByWeight<T>(rng: Random, items: { item: T; weight: number }[]) {
	return items
		.filter((i) => i.weight > 0)
		.map((i) => ({ i, key: Math.pow(rng(), 1 / i.weight) }))
		.sort((a, b) => b.key - a.key)
		.map((e) => e.i.item);
}

// --- Building -------------------------------------------------------------------------------

export interface Context {
	world: World;
	plan: InputEvent[];
	rng: Random;
	preset: Preset;
	chart: DashChart;
	/** The kinds of things used lately (to not use them again and again) */
	history: string[];
}

/** A stretch of the level played from a state with some presses */
export interface Check {
	from: PlayerState;
	inputs: InputEvent[];
	until: number;
}

export const passes = (world: World, check: Check) =>
	!simulate(world, check.from, check.until, check.inputs).dead;

/** A press at a time, held for a while */
export const tap = (time: number, length = 90): InputEvent[] => [
	{ time, down: true },
	{ time: time + length, down: false }
];

/** The checks of a click: on time, early and late, short and long */
export function clickChecks(
	world: World,
	state: PlayerState,
	time: number,
	until: number,
	tolerance: number,
	extra: InputEvent[] = []
): Check[] {
	const from = simulate(world, state, time - tolerance - STEP * 2, []);
	const variants: [number, number][] = [
		[0, 90],
		[-tolerance, 60],
		[-tolerance, 170],
		[tolerance, 60],
		[tolerance, 170]
	];
	return variants.map(([shift, length]) => ({
		from,
		inputs: [...tap(time + shift, length), ...extra].sort((a, b) => a.time - b.time),
		until: Math.max(until, time + shift + length + 20)
	}));
}

/** Things put into the world for a click, taken out again if they don't work out */
export class Attempt {
	private undo: (() => void)[] = [];
	/** Where it put things (to check the rules there) */
	from = Infinity;
	to = -Infinity;
	/** Something broke a rule or went past the end of the part */
	broken = false;

	constructor(
		private world: World,
		private limit = Infinity
	) {}

	private mark(x0: number, x1: number) {
		this.from = Math.min(this.from, x0);
		this.to = Math.max(this.to, x1);
		if (x1 > this.limit) this.broken = true;
	}

	spike(x: number, y: number, dir: 1 | -1 = 1, kind: 'spike' | 'small' = 'spike') {
		this.mark(x - 0.5, x + 0.5);
		const spike = this.world.spike(x, y, dir, kind);
		this.undo.push(() => this.world.hazards.remove(spike));
		return spike;
	}

	/** A row of spikes, one per block, on [x0, x1] */
	spikes(x0: number, x1: number, y: number, dir: 1 | -1 = 1, kind: 'spike' | 'small' = 'spike') {
		for (let x = x0 + 0.5; x <= x1 - 0.5 + 1e-6; x += 1) this.spike(x, y, dir, kind);
	}

	saw(x: number, y: number, radius: number) {
		this.mark(x - radius, x + radius);
		const saw = this.world.saw(x, y, radius);
		this.undo.push(() => this.world.hazards.remove(saw));
		return saw;
	}

	solid(solid: Solid) {
		this.mark(solid.x0, Math.min(solid.x1, solid.x0 + 8));
		this.world.solids.add(solid);
		this.undo.push(() => this.world.solids.remove(solid));
		return solid;
	}

	orb(kind: OrbKind, x: number, y: number) {
		this.mark(x - 0.6, x + 0.6);
		const orb = { id: this.world.id(), kind, x, y, x0: x - 0.6, x1: x + 0.6 };
		this.world.orbs.add(orb);
		this.undo.push(() => this.world.orbs.remove(orb));
		return orb;
	}

	pad(kind: PadKind, x: number, y: number, dir: 1 | -1 = 1) {
		this.mark(x - 0.5, x + 0.5);
		const pad = { id: this.world.id(), kind, x, y, dir, x0: x - 0.5, x1: x + 0.5 };
		this.world.pads.add(pad);
		this.undo.push(() => this.world.pads.remove(pad));
		return pad;
	}

	/** Changes something, with how to change it back */
	change(apply: () => void, revert: () => void, x = 0) {
		apply();
		this.undo.push(revert);
		this.world.solids.touch();
		if (x) this.mark(x - 1, x + 1);
	}

	revert() {
		for (const undo of this.undo.reverse()) undo();
		this.undo = [];
		this.world.solids.touch();
	}

	/** Whether what's around it keeps the rules */
	legal() {
		if (this.broken) return false;
		if (this.from > this.to) return true;
		return legalAround(this.world, this.from - 2, this.to + 2);
	}
}

/**
 * The rules of a clean level, between two places: every spike stands on a surface (or
 * hangs under one), none is inside a block or another spike, orbs and pads aren't inside
 * blocks or spikes, pads stand on a surface
 */
export function legalAround(world: World, from: number, to: number) {
	const hazards = world.hazards.near(from, to);
	for (const h of hazards) {
		if (h.kind === 'saw') continue;
		const height = h.kind === 'small' ? 0.5 : 1;
		const cell = h.dir === 1 ? [h.y, h.y + height] : [h.y - height, h.y];
		if (world.solidAt(h.x - 0.45, h.x + 0.45, cell[0], cell[1])) return false;
		if (!world.surfaceAt(h.x - 0.45, h.x + 0.45, h.y, h.dir)) return false;
		for (const o of hazards) {
			if (o === h || o.kind === 'saw') continue;
			if (Math.abs(o.x - h.x) < 0.9 && Math.abs(o.y - h.y) < 0.9 && o.dir === h.dir) return false;
			// A spike pointing at another one, too close
			if (o.dir !== h.dir && Math.abs(o.x - h.x) < 0.9 && Math.abs(o.y - h.y) < 1.8) return false;
		}
	}
	for (const o of world.orbs.near(from, to)) {
		if (world.solidAt(o.x - 0.45, o.x + 0.45, o.y - 0.45, o.y + 0.45)) return false;
		if (hazards.some((h) => Math.abs(h.x - o.x) < 0.9 && Math.abs(h.y + 0.5 * h.dir - o.y) < 0.9))
			return false;
	}
	for (const p of world.pads.near(from, to)) {
		if (!world.surfaceAt(p.x - 0.45, p.x + 0.45, p.y, p.dir)) return false;
		if (
			world.solidAt(
				p.x - 0.45,
				p.x + 0.45,
				p.dir === 1 ? p.y : p.y - 0.3,
				p.dir === 1 ? p.y + 0.3 : p.y
			)
		)
			return false;
		if (
			hazards.some(
				(h) => h.kind !== 'saw' && Math.abs(h.x - p.x) < 0.95 && h.y === p.y && h.dir === p.dir
			)
		)
			return false;
	}
	return true;
}

/** Remembers that a kind of thing was used (for variety) */
export function used(ctx: Context, kind: string) {
	ctx.history.push(kind);
	if (ctx.history.length > 24) ctx.history.shift();
}

/** How welcome a kind of thing is now: less so if it was used just before */
export function freshness(ctx: Context, kind: string) {
	const h = ctx.history;
	for (let i = h.length - 1, back = 1; i >= 0 && back <= 8; i--, back++) {
		if (h[i] === kind) return back <= 1 ? 0.12 : back <= 3 ? 0.35 : back <= 6 ? 0.7 : 0.9;
	}
	return 1;
}

/** Whether a stretch can be played without pressing at a time (then that press isn't needed) */
export function survivesWithout(world: World, state: PlayerState, until: number) {
	return !simulate(world, state, until, []).dead;
}

export type { Section };
