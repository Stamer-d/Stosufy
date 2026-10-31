// Makes a Dash level out of a beatmap: the song is cut into parts on its phrases (cube,
// ship, ball and wave parts, faster in the kiai), the notes become the jumps, orbs, flips
// and turns, and the obstacles are put where they make you press on the beat.
//
// Every obstacle is checked with the physics before it stays: the level is played with
// presses a bit early and a bit late, and what one of them can't get past is taken out
// again. At the end the whole level is played once more. So every level can be finished.

import { beatAt, beatStrength, type DashChart, type DashNote } from './chart';
import {
	HITBOX,
	PHYSICS,
	SPEEDS,
	STEP,
	World,
	copyState,
	press,
	simulate,
	startState,
	step,
	type InputEvent,
	type Mode,
	type PlayerState,
	type Portal,
	type Section,
	type Solid,
	type Walls
} from './physics';

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane', 'extreme'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

interface Preset {
	/** What a click costs: notes weaker than this aren't jumps */
	cost: number;
	/** The shortest time between two clicks (s) */
	gap: number;
	/** How early or late a press may be (ms) */
	tolerance: number;
	spikes: number;
	/** The highest a cube part builds (blocks) */
	height: number;
	/** Half the height of the ship's tunnel and the wave's corridor (blocks) */
	ship: number;
	wave: number;
	/** The shortest time between two turns of the wave (s) */
	waveGap: number;
	/** Speeds: normal parts, kiai */
	speeds: [number, number];
	pads: number;
	ball: number;
	/** How many orbs in a row at most */
	chain: number;
}

const PRESETS: Record<Difficulty, Preset> = {
	easy: {
		cost: 1.2,
		gap: 0.5,
		tolerance: 80,
		spikes: 2,
		height: 2,
		ship: 2.7,
		wave: 0,
		waveGap: 0.3,
		speeds: [1, 1],
		pads: 0.05,
		ball: 0.15,
		chain: 0
	},
	normal: {
		cost: 0.95,
		gap: 0.36,
		tolerance: 65,
		spikes: 2,
		height: 3,
		ship: 2.35,
		wave: 1.75,
		waveGap: 0.22,
		speeds: [1, 2],
		pads: 0.07,
		ball: 0.25,
		chain: 1
	},
	hard: {
		cost: 0.72,
		gap: 0.27,
		tolerance: 55,
		spikes: 3,
		height: 3,
		ship: 2.05,
		wave: 1.45,
		waveGap: 0.15,
		speeds: [1, 2],
		pads: 0.08,
		ball: 0.3,
		chain: 1
	},
	insane: {
		cost: 0.48,
		gap: 0.2,
		tolerance: 48,
		spikes: 3,
		height: 4,
		ship: 1.8,
		wave: 1.2,
		waveGap: 0.11,
		speeds: [2, 3],
		pads: 0.08,
		ball: 0.3,
		chain: 2
	},
	extreme: {
		cost: 0.25,
		gap: 0.15,
		tolerance: 42,
		spikes: 3,
		height: 4,
		ship: 1.55,
		wave: 1.0,
		waveGap: 0.075,
		speeds: [2, 3],
		pads: 0.08,
		ball: 0.3,
		chain: 3
	}
};

/** How tall the parts with a ceiling are (blocks) */
export const BOUNDS: Record<Exclude<Mode, 'cube'>, number> = { ship: 9, wave: 9, ball: 7 };

export interface Level {
	world: World;
	/** The presses and releases that finish the level (autoplay) */
	plan: InputEvent[];
	/** Song times (ms) the level starts and ends at */
	start: number;
	end: number;
	xEnd: number;
	portals: Portal[];
	beats: { time: number; downbeat: boolean }[];
	kiai: { start: number; end: number }[];
	difficulty: Difficulty;
	/** For the results: how many presses it takes */
	clicks: number;
	title: string;
	artist: string;
	creator: string;
	version: string;
}

// --- Randomness, the same for the same song --------------------------------------------

function hash(text: string) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function random(seed: number) {
	let a = seed || 1;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Random = () => number;
const pick = <T>(rng: Random, items: T[]) => items[Math.floor(rng() * items.length)];
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

// --- Which notes are clicks ---------------------------------------------------------------

function inKiai(chart: DashChart, time: number) {
	return chart.kiai.some((k) => time >= k.start && time < k.end);
}

function weight(chart: DashChart, note: DashNote) {
	let w = 0.55 + beatStrength(chart.timing, note.time) * 0.6;
	if (note.combo) w += 0.25;
	if (note.sound & 4) w += 0.45;
	if (note.sound & 8) w += 0.2;
	if (note.sound & 2) w += 0.1;
	if (note.kind !== 'circle') w += 0.1;
	if (inKiai(chart, note.time)) w += 0.1;
	return w;
}

/**
 * The notes that become clicks: as many strong ones as fit with at least `gap` between
 * them (the best sum of their weights, less what each click costs), and in long stretches
 * without any the strongest note there.
 */
function chooseClicks(chart: DashChart, notes: DashNote[], gap: number, cost: number) {
	const n = notes.length;
	if (!n) return [] as number[];
	const weights = notes.map((note) => weight(chart, note) - cost);
	const best = new Float64Array(n + 1);
	const took = new Uint8Array(n + 1);
	const previous = new Int32Array(n + 1);
	let j = 0;
	for (let i = 1; i <= n; i++) {
		const time = notes[i - 1].time;
		while (j < i - 1 && notes[j].time <= time - gap * 1000) j++;
		// j: the first note too close; notes before it can go with this one
		const withIt = weights[i - 1] + best[j];
		if (withIt > best[i - 1]) {
			best[i] = withIt;
			took[i] = 1;
			previous[i] = j;
		} else best[i] = best[i - 1];
	}
	const chosen: number[] = [];
	for (let i = n; i > 0;) {
		if (took[i]) {
			chosen.push(notes[i - 1].time);
			i = previous[i];
		} else i--;
	}
	chosen.reverse();
	// Long stretches without a click: the strongest note in it
	const filled = [...chosen];
	const longest = Math.max(1600, gap * 4000);
	for (let pass = 0; pass < 3; pass++) {
		const bounds = [-Infinity, ...filled, Infinity];
		let added = false;
		for (let k = 0; k < bounds.length - 1; k++) {
			const from = bounds[k];
			const to = bounds[k + 1];
			const span = Math.min(to, notes[n - 1].time + 1) - Math.max(from, notes[0].time - 1);
			if (span < longest) continue;
			let bestNote: DashNote | null = null;
			let bestWeight = -Infinity;
			for (const note of notes) {
				if (note.time - from < gap * 1000 || to - note.time < gap * 1000) continue;
				const w = weight(chart, note);
				if (w > bestWeight) {
					bestWeight = w;
					bestNote = note;
				}
			}
			if (bestNote) {
				filled.push(bestNote.time);
				added = true;
			}
		}
		filled.sort((a, b) => a - b);
		if (!added) break;
	}
	return filled;
}

/** Notes at least `gap` (s) apart, the stronger one of two close ones */
function spaced(chart: DashChart, notes: DashNote[], gap: number) {
	const result: DashNote[] = [];
	for (const note of notes) {
		const last = result[result.length - 1];
		if (last && note.time - last.time < gap * 1000) {
			if (weight(chart, note) > weight(chart, last) + 0.3) result[result.length - 1] = note;
			continue;
		}
		result.push(note);
	}
	return result;
}

/**
 * The notes, and in long stretches without any (an intro, a break, a held note) every
 * other beat as a note too: those are still jumps on the music
 */
function withBeats(chart: DashChart): DashNote[] {
	const notes = chart.notes;
	const from = notes[0].time;
	const to = Math.max(...notes.map((n) => n.end));
	const extra: DashNote[] = [];
	let k = 0;
	for (let i = 0; i < chart.timing.length; i++) {
		const point = chart.timing[i];
		const until = Math.min(chart.timing[i + 1]?.time ?? to, to);
		const firstBeat = Math.max(0, Math.ceil((from - point.time) / point.beatLength));
		for (let b = firstBeat; ; b += 1) {
			const time = point.time + b * point.beatLength;
			if (time >= until) break;
			if (b % 2) continue;
			const near = point.beatLength * 1.5;
			while (k < notes.length && notes[k].time < time - near) k++;
			if (k < notes.length && notes[k].time <= time + near) continue;
			// (nor inside a held note's start: its end is free)
			extra.push({ time, end: time, kind: 'circle', height: 0.5, sound: 0, combo: false });
		}
	}
	return [...notes, ...extra].sort((a, b) => a.time - b.time);
}

// --- The parts of the song ---------------------------------------------------------------

interface Part {
	start: number;
	end: number;
	mode: Mode;
	kiai: boolean;
}

function planParts(
	chart: DashChart,
	start: number,
	end: number,
	preset: Preset,
	rng: Random
): Part[] {
	// Phrases: every few measures (about 8–16 s), and where the kiai starts and stops
	const cuts = new Set<number>();
	const timing = chart.timing;
	for (let i = 0; i < timing.length; i++) {
		const point = timing[i];
		const until = timing[i + 1]?.time ?? end;
		const measure = point.beatLength * point.meter;
		let measures = 8;
		while (measures * measure > 17000 && measures > 2) measures /= 2;
		while (measures * measure < 7000) measures *= 2;
		const first =
			point.time + Math.ceil((start - point.time) / (measure * measures)) * measure * measures;
		for (let t = Math.max(point.time, first); t < until; t += measure * measures)
			if (t > start + 3000 && t < end - 4000) cuts.add(Math.round(t));
	}
	const snap = (time: number) => {
		const { point } = beatAt(timing, time);
		const beats = Math.round((time - point.time) / point.beatLength);
		return Math.round(point.time + beats * point.beatLength);
	};
	const kiaiCuts = new Set<number>();
	for (const k of chart.kiai) {
		for (const t of [k.start, k.end]) {
			const at = snap(t);
			if (at > start + 2500 && at < end - 3000) {
				cuts.add(at);
				kiaiCuts.add(at);
			}
		}
	}
	// Cuts too close together: the kiai's stay
	const sorted = [...cuts].sort((a, b) => a - b);
	const kept: number[] = [];
	for (const cut of sorted) {
		const last = kept[kept.length - 1] ?? start;
		if (cut - last >= 5000) kept.push(cut);
		else if (kiaiCuts.has(cut) && !kiaiCuts.has(last) && kept.length) kept[kept.length - 1] = cut;
	}
	if (kept.length && end - kept[kept.length - 1] < 4000) kept.pop();
	const bounds = [start, ...kept, end];

	const parts: Part[] = [];
	let streams = 0;
	let waveTime = 0;
	for (let i = 0; i < bounds.length - 1; i++) {
		const from = bounds[i];
		const to = bounds[i + 1];
		const notes = chart.notes.filter((n) => n.time >= from && n.time < to);
		const seconds = (to - from) / 1000;
		const kiai = inKiai(chart, (from + to) / 2);
		const density = notes.length / seconds;
		let stream = 0;
		for (let k = 1; k < notes.length; k++) {
			const beat = beatAt(timing, notes[k].time).point.beatLength;
			if (notes[k].time - notes[k - 1].time <= Math.max(130, beat / 4 + 12)) stream++;
		}
		const streamy = notes.length > 1 ? stream / (notes.length - 1) : 0;
		const held =
			notes.reduce((sum, n) => sum + (n.kind === 'circle' ? 0 : Math.min(n.end, to) - n.time), 0) /
			(to - from);
		let mode: Mode = 'cube';
		if (i === 0) mode = 'cube';
		else if (notes.length < 3 || density < 0.5) mode = seconds > 6 && rng() < 0.5 ? 'ship' : 'cube';
		else if (streamy > 0.4) {
			// Streams: the wave, the ship, the wave… (and not the wave all the time)
			streams++;
			const waveShare = waveTime / Math.max(1, end - start);
			mode =
				preset.wave > 0 && streams % 2 === 1 && waveShare < 0.28
					? 'wave'
					: streams % 3 === 0
						? 'cube'
						: 'ship';
		} else if (held > 0.6) mode = 'ship';
		else if (rng() < (kiai ? preset.ball + 0.15 : preset.ball)) mode = 'ball';
		else if (rng() < 0.12) mode = 'ship';
		if (mode === 'wave') waveTime += to - from;
		parts.push({ start: from, end: to, mode, kiai });
	}
	// Not too long without the cube, and not the same twice in a row with a portal between
	for (let i = 1; i < parts.length; i++) {
		const before = parts[i - 1];
		if (
			before.mode !== 'cube' &&
			parts[i].mode !== 'cube' &&
			parts[i - 2]?.mode !== 'cube' &&
			i > 1
		)
			parts[i].mode = 'cube';
	}
	const merged: Part[] = [];
	for (const part of parts) {
		const last = merged[merged.length - 1];
		if (last && last.mode === part.mode && last.kiai === part.kiai && part.mode !== 'cube') {
			last.end = part.end;
			continue;
		}
		merged.push({ ...part });
	}
	// The end comes on the cube
	const last = merged[merged.length - 1];
	if (last.mode !== 'cube' && last.end - last.start > 9000) {
		const at = snap(last.end - 4000);
		if (at > last.start + 4000) {
			merged.push({ start: at, end: last.end, mode: 'cube', kiai: last.kiai });
			last.end = at;
		}
	}
	return merged;
}

// --- Building ----------------------------------------------------------------------------

interface Context {
	world: World;
	plan: InputEvent[];
	rng: Random;
	preset: Preset;
	chart: DashChart;
}

/** A check: a stretch of the level played from a state with some presses */
interface Check {
	from: PlayerState;
	inputs: InputEvent[];
	until: number;
}

const passes = (world: World, check: Check) =>
	!simulate(world, check.from, check.until, check.inputs).dead;

/** A short press at a time */
const tap = (time: number, length = 90): InputEvent[] => [
	{ time, down: true },
	{ time: time + length, down: false }
];

/** Things put into the world for a click, taken out again if they don't work */
class Attempt {
	private undo: (() => void)[] = [];
	/** Something went past the end of the part */
	outside = false;
	constructor(
		private world: World,
		private limit = Infinity
	) {}
	spike(x: number, y: number, dir: 1 | -1 = 1, kind: 'spike' | 'small' = 'spike') {
		if (x > this.limit) this.outside = true;
		const spike = this.world.spike(x, y, dir, kind);
		this.undo.push(() => this.world.hazards.remove(spike));
		return spike;
	}
	solid(solid: Solid) {
		this.world.solids.add(solid);
		this.undo.push(() => this.world.solids.remove(solid));
		return solid;
	}
	orb(kind: 'yellow' | 'pink' | 'blue', x: number, y: number) {
		if (x > this.limit) this.outside = true;
		const orb = { id: this.world.id(), kind, x, y, x0: x - 0.6, x1: x + 0.6 };
		this.world.orbs.add(orb);
		this.undo.push(() => this.world.orbs.remove(orb));
		return orb;
	}
	pad(kind: 'yellow' | 'pink', x: number, y: number, dir: 1 | -1 = 1) {
		const pad = { id: this.world.id(), kind, x, y, dir, x0: x - 0.5, x1: x + 0.5 };
		this.world.pads.add(pad);
		this.undo.push(() => this.world.pads.remove(pad));
		return pad;
	}
	/** Changes something, with how to change it back */
	change(apply: () => void, revert: () => void) {
		apply();
		this.undo.push(revert);
		this.world.solids.touch();
	}
	revert() {
		for (const undo of this.undo.reverse()) undo();
		this.undo = [];
		this.world.solids.touch();
	}
}

/** The checks of a click: pressed on time, early and late */
function clickChecks(
	world: World,
	state: PlayerState,
	time: number,
	until: number,
	tolerance: number,
	withPress = true
): Check[] {
	const from = simulate(world, state, time - tolerance - STEP * 2, []);
	if (!withPress) return [{ from, inputs: [], until }];
	return [0, -tolerance, tolerance].map((shift) => ({
		from,
		inputs: tap(time + shift),
		until: Math.max(until, time + shift + 100)
	}));
}

// --- The cube ----------------------------------------------------------------------------

function buildCube(ctx: Context, section: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, rng, preset } = ctx;
	const speed = section.speed;
	const tolerance = preset.tolerance;
	let state = entry;
	/** The platform the cube runs on (none: the ground) */
	let platform: Solid | null = null;
	let level = 0;
	let recent: Check[] = [];
	let chain = 0;
	const times = clicks.filter((t) => t > section.start + 300 && t < section.end - 350);
	const finish = (x: number) => {
		if (platform) {
			platform.x1 = Math.max(platform.x0 + 0.5, x);
			world.solids.touch();
		}
		platform = null;
	};
	const open = (x: number, height: number) => {
		const solid: Solid = { x0: x, x1: x + 60, y0: 0, y1: height, style: 0 };
		world.solids.add(solid);
		return solid;
	};

	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		const next = times[i + 1] ?? section.end - 200;
		if (platform) {
			platform.x1 = Math.max(platform.x1, world.xAt(next) + 40);
			world.solids.touch();
		}
		state = simulate(world, state, time - tolerance - STEP * 3, plan);
		if (state.dead) break;
		const at = simulate(world, state, time, []);
		const x = at.x;
		const grounded = at.grounded && at.gravity > 0;
		// Not too many orbs in a row: the note is left out
		chain = grounded ? 0 : chain + 1;
		if (!grounded && chain > preset.chain) continue;
		if (grounded) level = Math.round(at.y - HITBOX.cube.h);
		const until = next - 2;
		const room = (next - time) / 1000;
		const pressChecks = clickChecks(world, state, time, until, tolerance);

		type Candidate = {
			weight: number;
			build: (a: Attempt) => boolean;
			press?: boolean;
			after?: () => void;
		};
		const candidates: Candidate[] = [];
		const air = (2 * PHYSICS.jump) / PHYSICS.gravity;
		const middle = x + (speed * air) / 2;

		if (grounded) {
			// Spikes under the jump
			for (let count = Math.min(preset.spikes, 3); count >= 1; count--) {
				candidates.push({
					weight: count === 1 ? 1 : count === 2 ? 1.1 : 0.6,
					build: (a) => {
						for (let k = 0; k < count; k++)
							a.spike(
								middle + (k - (count - 1) / 2) * 1,
								level,
								1,
								count === 1 && rng() < 0.3 ? 'small' : 'spike'
							);
						return true;
					}
				});
			}
			// A step up
			if (level < preset.height && room > 0.36) {
				candidates.push({
					weight: level === 0 ? 1.4 : 0.8,
					build: (a) => {
						const edge = x + speed * (0.043 + tolerance / 1000) + HITBOX.cube.inner + 0.06;
						const old = platform;
						const oldEnd = old?.x1 ?? 0;
						const solid = a.solid({ x0: edge, x1: edge + 60, y0: 0, y1: level + 1, style: 0 });
						if (old)
							a.change(
								() => (old.x1 = edge),
								() => (old.x1 = oldEnd)
							);
						const before = platform;
						a.change(
							() => (platform = solid),
							() => (platform = before)
						);
						if (rng() < 0.35 && room > 0.75) {
							// And a spike on it, a bit later
							a.spike(edge + speed * 0.42 + 1.2, level + 1);
						}
						return true;
					}
				});
			}
			// A gap to the same height or one lower (spikes on the ground in it)
			if (level >= 1 && room > 0.4) {
				for (const down of [0, 1]) {
					const target = level - down;
					candidates.push({
						weight: down ? 1.2 : 1,
						build: (a) => {
							const landing =
								down === 0
									? air
									: (PHYSICS.jump + Math.sqrt(PHYSICS.jump ** 2 + 2 * PHYSICS.gravity * down)) /
										PHYSICS.gravity;
							const edge = x + speed * (tolerance / 1000) - HITBOX.cube.w + 0.25;
							const resume = x + speed * (landing - tolerance / 1000) + HITBOX.cube.w - 0.35;
							if (resume - edge < 1.1) return false;
							const old = platform!;
							const oldEnd = old.x1;
							a.change(
								() => (old.x1 = edge),
								() => (old.x1 = oldEnd)
							);
							if (target > 0) {
								const solid = a.solid({ x0: resume, x1: resume + 60, y0: 0, y1: target, style: 0 });
								const before = platform;
								a.change(
									() => (platform = solid),
									() => (platform = before)
								);
								for (let sx = edge + 0.5; sx < resume - 0.3; sx += 1) a.spike(sx, 0, 1, 'small');
							} else {
								const before = platform;
								a.change(
									() => (platform = null),
									() => (platform = before)
								);
								for (let sx = edge + 0.6; sx < resume - 1.4; sx += 1) a.spike(sx, 0, 1);
							}
							return true;
						}
					});
				}
			}
			// A pad on a strong note with time after it (no click)
			if (room > 0.62 && rng() < preset.pads * 3) {
				candidates.push({
					weight: preset.pads * 6,
					press: false,
					build: (a) => {
						const padX = x + HITBOX.cube.w + 0.38;
						a.pad('yellow', padX, level);
						const high = (2 * PHYSICS.jump * PHYSICS.yellowPad) / PHYSICS.gravity;
						const mid = x + (speed * high) / 2;
						for (let k = -1; k <= 1; k++) a.spike(mid + k, level);
						return true;
					}
				});
			}
		} else if (!at.dead) {
			// In the air: an orb where the cube is, and spikes where it would land without it
			const height = at.y - HITBOX.cube.h - level;
			const kind = height > 2.4 || room < 0.3 ? 'pink' : 'yellow';
			candidates.push({
				weight: 1,
				build: (a) => {
					a.orb(kind, at.x + speed * 0.012, at.y);
					const fall = simulate(world, at, time + 900, []);
					if (!fall.grounded) return true;
					const count = room > 0.34 ? 2 : 1;
					for (let k = 0; k < count; k++)
						a.spike(fall.x + 0.35 + k, Math.round(fall.y - HITBOX.cube.h));
					return true;
				}
			});
			// Or only the orb (the spikes of the orbs before are still in the way)
			candidates.push({
				weight: 0.001,
				build: (a) => {
					a.orb(kind, at.x + speed * 0.012, at.y);
					return true;
				}
			});
		}

		// Try them, the likelier first
		const ordered = candidates
			.map((c) => ({ c, key: rng() * c.weight }))
			.sort((a, b) => b.key - a.key)
			.map((e) => e.c);
		let done = false;
		for (const candidate of ordered) {
			const attempt = new Attempt(world, section.x1 - 1.5);
			if (!candidate.build(attempt) || attempt.outside) {
				attempt.revert();
				continue;
			}
			const pressing = candidate.press !== false;
			const checks = pressing
				? pressChecks
				: clickChecks(world, state, time, until, tolerance, false);
			if ([...checks, ...recent].every((check) => passes(world, check))) {
				if (pressing) plan.push(...tap(time));
				recent = checks;
				done = true;
				break;
			}
			attempt.revert();
		}
		if (!done) {
			// Nothing fits: a jump over nothing is still on the beat
			plan.push(...tap(time));
			recent = pressChecks;
			// What still stops it on time goes
			for (let k = 0; k < 8; k++) {
				const run = simulate(world, pressChecks[0].from, until, pressChecks[0].inputs);
				if (!run.dead) break;
				world.hazards.removeIf((h) => h.x1 > run.x - 2 && h.x0 < run.x + 1.5);
			}
		}
		// Long runs on a platform: down to the ground again now and then
		if (platform && level >= 1 && room > 1.1 && rng() < 0.45) {
			const landed = simulate(world, state, time + 520, plan);
			if (landed.grounded) {
				const edge = landed.x + speed * 0.25;
				const old = platform;
				const end = old.x1;
				old.x1 = edge;
				world.solids.touch();
				platform = null;
				const check = { from: landed, inputs: [], until: next - 2 };
				if (!passes(world, check) || !recent.every((c) => passes(world, c))) {
					old.x1 = end;
					world.solids.touch();
					platform = old;
				} else level = 0;
			}
		}
	}
	finish(section.x1 - 0.5);
	void open;
	return simulate(world, state, section.end, plan);
}

// --- The ball ----------------------------------------------------------------------------

function buildBall(ctx: Context, section: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, rng, preset } = ctx;
	const speed = section.speed;
	const tolerance = preset.tolerance;
	const top = section.ceil!;
	let state = entry;
	let recent: Check[] = [];
	const times = clicks.filter((t) => t > section.start + 450 && t < section.end - 350);
	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		const next = times[i + 1] ?? section.end - 200;
		state = simulate(world, state, time - tolerance - STEP * 3, plan);
		if (state.dead) break;
		const at = simulate(world, state, time, []);
		const until = next - 2;
		const room = (next - time) / 1000;
		const checks = clickChecks(world, state, time, until, tolerance);
		const candidates: ((a: Attempt) => void)[] = [];
		if (at.grounded) {
			const onFloor = at.gravity > 0;
			const surface = onFloor ? section.floor : top;
			const other = onFloor ? top : section.floor;
			const dir: 1 | -1 = onFloor ? 1 : -1;
			const away = x0(speed, tolerance) + at.x;
			for (let count = preset.spikes; count >= 1; count--) {
				// Spikes it must leave before, and spikes on the other side before it lands
				candidates.push((a) => {
					for (let k = 0; k < count; k++) a.spike(away + 0.75 + k, surface, dir);
					if (room > 0.5 && rng() < 0.6) a.spike(at.x + speed * 0.25, other, -dir as 1 | -1);
				});
				candidates.push((a) => {
					for (let k = 0; k < count; k++) a.spike(away + 0.75 + k, surface, dir);
				});
			}
		} else {
			// In the air: a blue orb flips it there
			candidates.push((a) => {
				a.orb('blue', at.x + speed * 0.012, at.y);
				const fall = simulate(world, at, time + 900, []);
				if (fall.grounded) {
					const where = fall.gravity > 0 ? section.floor : top;
					a.spike(fall.x + 0.4, where, fall.gravity > 0 ? 1 : -1);
				}
			});
		}
		let done = false;
		for (const build of candidates) {
			const attempt = new Attempt(world, section.x1 - 1.5);
			build(attempt);
			if (!attempt.outside && [...checks, ...recent].every((check) => passes(world, check))) {
				plan.push(...tap(time));
				recent = checks;
				done = true;
				break;
			}
			attempt.revert();
		}
		if (!done) {
			plan.push(...tap(time));
			recent = checks;
		}
	}
	return simulate(world, state, section.end, plan);
}

/** How far the ball goes before it's clear of the surface it leaves, pressed late */
function x0(speed: number, tolerance: number) {
	// It needs ~0.1 s to get 0.6 blocks away
	return speed * (0.1 + tolerance / 1000);
}

// --- The ship ----------------------------------------------------------------------------

/** A ship's input: holds while below where it should be (and isn't climbing too fast) */
function flyShip(
	world: World,
	from: PlayerState,
	until: number,
	target: (x: number) => number,
	events: InputEvent[]
) {
	const s = copyState(from);
	let lastChange = -1e9;
	while (s.time < until && !s.dead) {
		const next = Math.min(until, s.time + STEP);
		const ahead = target(s.x + section(world, s.time).speed * 0.2);
		const wanted = clamp((ahead - s.y) * 7, -7, 7);
		const hold = s.vy < wanted;
		if (hold !== s.held && next - lastChange > 24) {
			press(s, hold);
			events.push({ time: next, down: hold });
			lastChange = next;
		}
		step(world, s, next);
	}
	if (s.held) events.push({ time: until, down: false });
	return s;
}

const section = (world: World, time: number) => world.sectionAt(time);

function buildShip(ctx: Context, sec: Section, notes: DashNote[], entry: PlayerState) {
	const { world, plan, rng, preset } = ctx;
	const top = sec.ceil!;
	const speed = sec.speed;
	const width = preset.ship;
	// Where the tunnel goes: up and down with the notes, not steeper than the ship can
	const keys: { x: number; y: number }[] = [];
	const startY = clamp(entry.y, width + 0.6, top - width - 0.6);
	keys.push({ x: sec.x0, y: startY });
	const wallsFrom = world.xAt(sec.start + 900);
	const wallsTo = world.xAt(sec.end - 500);
	const calm = notes.length / Math.max(1, (sec.end - sec.start) / 1000) < 0.6;
	for (const note of spaced(ctx.chart, notes, 0.32)) {
		const x = world.xAt(note.time);
		if (x < wallsFrom || x > wallsTo) continue;
		const last = keys[keys.length - 1];
		const y = width + 0.8 + note.height * (top - 2 * width - 1.6);
		const steepest = 0.42 * (x - last.x);
		keys.push({ x, y: clamp(y, last.y - steepest, last.y + steepest) });
	}
	keys.push({ x: sec.x1 + 2, y: keys[keys.length - 1].y });
	const path = (x: number) => {
		if (x <= keys[0].x) return keys[0].y;
		for (let k = 1; k < keys.length; k++) {
			if (x <= keys[k].x) {
				const a = keys[k - 1];
				const b = keys[k];
				const f = (x - a.x) / (b.x - a.x || 1);
				// Smooth between the keys
				const e = f * f * (3 - 2 * f);
				return a.y + (b.y - a.y) * e;
			}
		}
		return keys[keys.length - 1].y;
	};

	// The tunnel: a column of blocks below and above every block
	const columns: { x: number; low: number; high: number; spike: 0 | 1 | -1 }[] = [];
	if (!calm) {
		let low = 0;
		let high = top;
		for (let x = Math.ceil(wallsFrom); x < wallsTo; x++) {
			const middle = path(x + 0.5);
			const wantLow = clamp(Math.round(middle - width), 0, top - 3);
			const wantHigh = clamp(Math.round(middle + width), 3, top);
			low = clamp(wantLow, low - 1, low + 1);
			high = clamp(wantHigh, high - 1, high + 1);
			if (high - low < Math.round(width * 2)) {
				if (middle - low > high - middle) high = low + Math.round(width * 2);
				else low = high - Math.round(width * 2);
			}
			columns.push({ x, low, high, spike: 0 });
		}
		// Spikes on the walls on some of the notes
		for (const note of spaced(ctx.chart, notes, 0.4)) {
			const x = Math.floor(world.xAt(note.time) + speed * 0.05);
			const column = columns.find((c) => c.x === x);
			if (!column || rng() > 0.55) continue;
			if (column.high - column.low < width * 2 + 0.6) continue;
			column.spike = path(x + 0.5) - column.low > column.high - path(x + 0.5) ? 1 : -1;
		}
	}

	let made: { solids: Solid[]; spikes: ReturnType<World['spike']>[] } = { solids: [], spikes: [] };
	const build = () => {
		for (const solid of made.solids) world.solids.remove(solid);
		for (const spike of made.spikes) world.hazards.remove(spike);
		world.solids.touch();
		made = { solids: [], spikes: [] };
		// Columns of the same height as one block
		for (const side of ['low', 'high'] as const) {
			let run: { x0: number; height: number } | null = null;
			const flush = (x1: number) => {
				if (!run) return;
				const height = run.height;
				if (side === 'low' && height > 0)
					made.solids.push(
						world.solids.add({ x0: run.x0, x1, y0: sec.floor, y1: height, style: 2 })
					);
				if (side === 'high' && height < top)
					made.solids.push(world.solids.add({ x0: run.x0, x1, y0: height, y1: top, style: 2 }));
				run = null;
			};
			for (const column of columns) {
				const height = column[side];
				if (!run || run.height !== height) {
					flush(column.x);
					run = { x0: column.x, height };
				}
			}
			flush((columns[columns.length - 1]?.x ?? 0) + 1);
		}
		for (const column of columns) {
			if (column.spike === 1) made.spikes.push(world.spike(column.x + 0.5, column.low, 1));
			if (column.spike === -1) made.spikes.push(world.spike(column.x + 0.5, column.high, -1));
		}
	};
	build();

	// Fly it; where it crashes, the tunnel gets wider
	const target = (x: number) => {
		const column = columns.find((c) => c.x === Math.floor(x));
		if (!column) return path(x);
		const low = column.low + (column.spike === 1 ? 0.55 : 0);
		const high = column.high - (column.spike === -1 ? 0.55 : 0);
		return (low + high) / 2;
	};
	let events: InputEvent[] = [];
	let end: PlayerState = entry;
	for (let attempt = 0; attempt < 24; attempt++) {
		events = [];
		end = flyShip(world, entry, sec.end, target, events);
		if (!end.dead) break;
		const near = columns.filter((c) => Math.abs(c.x + 0.5 - end.x) < 3.5);
		if (!near.length) break;
		for (const column of near) {
			column.spike = 0;
			if (attempt > 16) {
				column.low = 0;
				column.high = top;
			} else if (end.y - column.low < column.high - end.y) column.low = Math.max(0, column.low - 1);
			else column.high = Math.min(top, column.high + 1);
		}
		build();
	}
	plan.push(...events);
	return end;
}

// --- The wave ----------------------------------------------------------------------------

function buildWave(ctx: Context, sec: Section, notes: DashNote[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const top = sec.ceil!;
	const speed = sec.speed;
	const half = HITBOX.wave.h;
	const toggles = spaced(ctx.chart, notes, preset.waveGap).filter(
		(n) => n.time > sec.start + 650 && n.time < sec.end - 450
	);
	// The path: 45° up or down, turning on the notes, along the floor or ceiling at the ends
	const points: { x: number; y: number }[] = [];
	const events: InputEvent[] = [];
	let x = entry.x;
	let y = clamp(entry.y, half, top - half);
	let up = false;
	points.push({ x, y });
	const advance = (toX: number) => {
		const dx = toX - x;
		const target = y + (up ? dx : -dx);
		if (target > top - half || target < half) {
			const limit = up ? top - half : half;
			const reach = x + Math.abs(limit - y);
			if (reach > x + 1e-6) points.push({ x: reach, y: limit });
			y = limit;
			x = toX;
			points.push({ x, y });
			return;
		}
		y = target;
		x = toX;
		points.push({ x, y });
	};
	const width = preset.wave;
	const margin = width * 0.6;
	for (let k = 0; k < toggles.length; k++) {
		const time = toggles[k].time;
		const tx = world.xAt(time);
		advance(tx);
		const nextX = k + 1 < toggles.length ? world.xAt(toggles[k + 1].time) : world.xAt(sec.end);
		const dx = nextX - tx;
		const wouldBe = y + (up ? -dx : dx);
		// Turning every note, unless that runs into the floor or ceiling for long
		const turn = wouldBe >= margin - dx * 0.4 && wouldBe <= top - margin + dx * 0.4;
		if (turn || rng() < 0.15) {
			up = !up;
			events.push({ time, down: up });
		}
	}
	advance(world.xAt(sec.end) + 1);
	if (up) events.push({ time: sec.end - 1, down: false });

	// The walls along it, opening at the start like a funnel
	const firstX = toggles.length ? world.xAt(toggles[0].time) : sec.x1;
	const walls: Walls = { xs: [], lo: [], hi: [], x0: firstX - 3, x1: world.xAt(sec.end - 300) };
	const widths: number[] = [];
	const build = () => {
		walls.xs = [];
		walls.lo = [];
		walls.hi = [];
		const ys = (px: number) => {
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
			...points.map((p) => p.x).filter((px) => px > walls.x0 && px < walls.x1),
			walls.x1
		];
		xs.forEach((px, k) => {
			const open = clamp((walls.x0 + 3.5 - px) / 3.5, 0, 1);
			const w = (widths[k] ?? width) + open * 4;
			const py = ys(px);
			walls.xs.push(px);
			walls.lo.push(py - w);
			walls.hi.push(py + w);
		});
	};
	if (toggles.length > 1) {
		build();
		world.walls.add(walls);
	}

	// Check: on time, and with every turn a bit off either way
	const jitter = (seed: number) =>
		events.map((e, k) => ({
			...e,
			time: e.time + (((k * 7919 + seed * 104729) % 1000) / 1000 - 0.5) * preset.tolerance * 1.1
		}));
	let end = simulate(world, entry, sec.end, events);
	for (let attempt = 0; attempt < 40 && toggles.length > 1; attempt++) {
		let failed: PlayerState | null = null;
		for (const inputs of [events, jitter(1), jitter(2)]) {
			const run = simulate(
				world,
				entry,
				sec.end,
				[...inputs].sort((a, b) => a.time - b.time)
			);
			if (run.dead) {
				failed = run;
				break;
			}
		}
		if (!failed) break;
		// Wider where it crashed
		walls.xs.forEach((px, k) => {
			if (Math.abs(px - failed!.x) < 3) widths[k] = (widths[k] ?? width) + 0.25;
		});
		build();
		world.walls.touch();
		end = simulate(world, entry, sec.end, events);
	}
	if (end.dead) {
		world.walls.remove(walls);
		end = simulate(world, entry, sec.end, events);
	}
	plan.push(...events);
	void speed;
	return end;
}

// --- The level ---------------------------------------------------------------------------

export function generateLevel(
	chart: DashChart,
	options: { difficulty: Difficulty; seed: string; duration: number }
): Level {
	const preset = PRESETS[options.difficulty];
	const rng = random(hash(`${options.seed}:${options.difficulty}`));
	chart = { ...chart, notes: withBeats(chart) };
	const notes = chart.notes;
	const first = notes[0].time;
	const lastEnd = Math.max(...notes.map((n) => n.end));
	const start = first > 2600 ? Math.round(first - 2000) : 0;
	const end = Math.min(
		options.duration > 0 ? options.duration - 100 : Infinity,
		Math.round(lastEnd + 1600)
	);
	const parts = planParts(chart, start, end, preset, rng);

	const world = new World();
	// Speeds: one per part, and where the player is
	let x = 0;
	let palette = Math.floor(rng() * 8);
	parts.forEach((part, index) => {
		const speedIndex = part.kiai ? preset.speeds[1] : preset.speeds[0];
		const speed = SPEEDS[speedIndex];
		world.segments.push({ time: part.start, x, speed });
		const x1 = x + ((part.end - part.start) / 1000) * speed;
		palette = (palette + 1 + Math.floor(rng() * 3)) % 8;
		world.sections.push({
			index,
			mode: part.mode,
			start: part.start,
			end: part.end,
			x0: x,
			x1,
			speed,
			speedIndex,
			floor: 0,
			ceil: part.mode === 'cube' ? null : BOUNDS[part.mode],
			palette,
			kiai: part.kiai
		});
		x = x1;
	});
	// Past the end: on at the last speed
	world.segments.push({ time: end, x, speed: world.sections[world.sections.length - 1].speed });

	const plan: InputEvent[] = [];
	const ctx: Context = { world, plan, rng, preset, chart };
	const allClicks = chooseClicks(chart, notes, preset.gap, preset.cost);
	let state = startState(world, start);
	const portals: Portal[] = [];
	for (const sec of world.sections) {
		state = simulate(world, state, sec.start + STEP, plan);
		const before = world.sections[sec.index - 1];
		if (before && before.mode !== sec.mode)
			portals.push({
				kind: 'mode',
				mode: sec.mode,
				x: sec.x0,
				y: state.y,
				x0: sec.x0 - 1,
				x1: sec.x0 + 1
			});
		if (before && before.speedIndex !== sec.speedIndex)
			portals.push({
				kind: 'speed',
				speedIndex: sec.speedIndex,
				x: sec.x0 - 1.4,
				y: state.y,
				x0: sec.x0 - 2.4,
				x1: sec.x0 - 0.4
			});
		const inside = notes.filter((n) => n.time >= sec.start && n.time < sec.end);
		const clicks = allClicks.filter((t) => t >= sec.start && t < sec.end);
		const entry = state;
		if (sec.mode === 'cube') state = buildCube(ctx, sec, clicks, state);
		else if (sec.mode === 'ball') state = buildBall(ctx, sec, clicks, state);
		else if (sec.mode === 'ship') state = buildShip(ctx, sec, inside, state);
		else state = buildWave(ctx, sec, inside, state);
		// Whatever still stops it in this part goes, before the next part starts from there
		for (let k = 0; k < 30 && state.dead; k++) {
			const at = state;
			const near = (o: { x0: number; x1: number }) => o.x1 > at.x - 2 && o.x0 < at.x + 1.5;
			if (world.hazards.items.some(near)) world.hazards.removeIf(near);
			else if (world.solids.items.some((o) => near(o) && o.style !== 0))
				world.solids.removeIf((o) => near(o) && o.style !== 0);
			else if (world.walls.items.some(near)) world.walls.removeIf(near);
			else world.solids.removeIf(near);
			state = simulate(world, entry, sec.end, plan);
		}
	}
	plan.sort((a, b) => a.time - b.time);

	// Played through once more: whatever still stops it goes
	for (let attempt = 0; attempt < 80; attempt++) {
		const run = simulate(world, startState(world, start), end, plan);
		if (!run.dead) break;
		const near = (o: { x0: number; x1: number }) => o.x1 > run.x - 2 && o.x0 < run.x + 1.5;
		const hazards = world.hazards.items.filter(near).length;
		if (hazards) world.hazards.removeIf(near);
		else {
			const sec = world.sectionAt(run.time);
			const removable = world.solids.items.filter((s) => near(s) && s.style !== 0);
			if (removable.length) world.solids.removeIf((s) => removable.includes(s));
			else if (world.walls.items.some((w) => near(w))) world.walls.removeIf(near);
			else if (sec.mode === 'cube') world.solids.removeIf(near);
			else break;
		}
	}

	const beats: { time: number; downbeat: boolean }[] = [];
	for (let i = 0; i < chart.timing.length; i++) {
		const point = chart.timing[i];
		const until = Math.min(chart.timing[i + 1]?.time ?? end + 4000, end + 4000);
		for (let k = 0, t = point.time; t < until; k++, t = point.time + k * point.beatLength)
			if (t >= start - 2000) beats.push({ time: t, downbeat: k % point.meter === 0 });
	}

	return {
		world,
		plan,
		start,
		end,
		xEnd: world.xAt(end),
		portals,
		beats,
		kiai: chart.kiai,
		difficulty: options.difficulty,
		clicks: plan.filter((e) => e.down).length,
		title: chart.title,
		artist: chart.artist,
		creator: chart.creator,
		version: chart.version
	};
}
