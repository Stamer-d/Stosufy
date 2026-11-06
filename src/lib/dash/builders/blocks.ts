// The cube and robot parts from building blocks, as a level's creator builds them: a library of
// known pieces (a spike, two, three; a step up, stairs, a gap, a pit down; a pillar; an orb over a
// row, orb chains; rings; a stretch upside down), each a few jumps and the orbs taken in the air.
// Along the part's clicks (on the drums, see rhythm.ts) a piece takes off on a click, takes its
// orbs on the clicks while it's in the air, and its next jump on the first click once it's down
// again. Pieces are tried the likelier and fresher first (the same again where the rhythm
// repeats); each is built and played with the physics (on time, all early and late, each press a
// bit off, every press needed) and kept, or taken out again for the next one; of those that work,
// the one that leaves the fewest clicks out. Nothing is taken out afterwards.

import {
	Attempt,
	byIntensity,
	freshness,
	gravityIn,
	half,
	jittered,
	shuffleByWeight,
	tap,
	used,
	type Context
} from '../build';
import { musicalRest } from '../composition';
import { reach } from './runner';
import {
	cubeAt,
	hitbox,
	simulate,
	STEP,
	type InputEvent,
	type OrbKind,
	type PlayerState,
	type Section,
	type Solid
} from '../physics';

type Point = { x: number; y: number; time: number };
type Landing = 'same' | 'up1' | 'up2' | 'down1' | 'ground' | 'gap';
type Fill = 'spikes' | 'small' | 'saw' | 'pillar' | 'block';

/** One jump of a piece: its takeoff, the orbs on the clicks in the air, where it comes down */
interface Leap {
	landing: Landing;
	/** Taken off by an orb on the ground (a ring), not a jump */
	ring?: OrbKind;
	/** Held: a dash orb (on a held note) */
	dash?: boolean;
	orbs?: OrbKind[];
	fill?: Fill;
	/** The most spikes in its row */
	most?: number;
}

export interface Block {
	id: string;
	/** From which difficulty on (0 easy … 4 extreme) */
	level: number;
	weight: number;
	/** Not for the robot (its jump is its own) */
	cubeOnly?: boolean;
	/** Only on a structure at least that high */
	high?: number;
	/** On a held note (a dash) */
	held?: boolean;
	/** Turns gravity around */
	gravity?: boolean;
	leaps?: Leap[];
	upside?: 'orbs' | 'portal';
}

const leap = (landing: Landing, more: Partial<Leap> = {}): Leap => ({ landing, ...more });

/** The library: 38 pieces */
export const BLOCKS: Block[] = [
	// A jump over something, or onto something
	{ id: 'spike1', level: 0, weight: 1.1, leaps: [leap('same', { most: 1 })] },
	{ id: 'spike2', level: 0, weight: 1, leaps: [leap('same', { most: 2 })] },
	{ id: 'spike3', level: 1, weight: 0.8, leaps: [leap('same', { most: 3 })] },
	{ id: 'smallRow', level: 1, weight: 0.6, leaps: [leap('same', { fill: 'small' })] },
	{ id: 'rowSaw', level: 2, weight: 0.5, leaps: [leap('same', { fill: 'saw' })] },
	{
		id: 'pillar',
		level: 1,
		weight: 0.6,
		cubeOnly: true,
		leaps: [leap('same', { fill: 'pillar' })]
	},
	{ id: 'block', level: 0, weight: 0.5, cubeOnly: true, leaps: [leap('same', { fill: 'block' })] },
	{ id: 'stepUp', level: 0, weight: 1, leaps: [leap('up1')] },
	{ id: 'stepUp2', level: 2, weight: 0.5, leaps: [leap('up2')] },
	{ id: 'stepDown', level: 1, weight: 0.8, high: 2, leaps: [leap('down1')] },
	{ id: 'dropDown', level: 0, weight: 0.8, high: 1, leaps: [leap('ground')] },
	{ id: 'gap', level: 1, weight: 0.9, high: 1, leaps: [leap('gap')] },
	{ id: 'ringYellow', level: 1, weight: 0.5, leaps: [leap('same', { ring: 'yellow' })] },
	{ id: 'ringRed', level: 2, weight: 0.4, leaps: [leap('up2', { ring: 'red' })] },
	{ id: 'ringPink', level: 1, weight: 0.4, leaps: [leap('same', { ring: 'pink', most: 1 })] },
	{ id: 'ringGap', level: 2, weight: 0.4, high: 1, leaps: [leap('gap', { ring: 'yellow' })] },
	{ id: 'dash', level: 1, weight: 2, held: true, leaps: [leap('same', { dash: true })] },
	// Orbs on the clicks in the air
	{ id: 'orbRow', level: 1, weight: 1.2, leaps: [leap('same', { orbs: ['yellow'] })] },
	{ id: 'orbPink', level: 1, weight: 0.7, leaps: [leap('same', { orbs: ['pink'] })] },
	{ id: 'orbUp', level: 2, weight: 0.8, leaps: [leap('up2', { orbs: ['red'] })] },
	{ id: 'orbStep', level: 1, weight: 0.8, leaps: [leap('up1', { orbs: ['yellow'] })] },
	{ id: 'orbGap', level: 2, weight: 0.8, high: 1, leaps: [leap('gap', { orbs: ['yellow'] })] },
	{ id: 'orbPinkGap', level: 2, weight: 0.6, high: 1, leaps: [leap('gap', { orbs: ['pink'] })] },
	{ id: 'orbChain2', level: 2, weight: 0.9, leaps: [leap('same', { orbs: ['yellow', 'yellow'] })] },
	{
		id: 'orbChain3',
		level: 3,
		weight: 0.7,
		leaps: [leap('same', { orbs: ['yellow', 'pink', 'yellow'] })]
	},
	// Two jumps
	{ id: 'stairs2', level: 1, weight: 1, leaps: [leap('up1'), leap('up1')] },
	{ id: 'stairsDown2', level: 1, weight: 0.8, high: 2, leaps: [leap('down1'), leap('down1')] },
	{ id: 'hill', level: 1, weight: 0.9, leaps: [leap('up1'), leap('ground')] },
	{ id: 'gaps2', level: 2, weight: 0.8, high: 1, leaps: [leap('gap'), leap('gap')] },
	{
		id: 'pillars2',
		level: 1,
		weight: 0.6,
		cubeOnly: true,
		leaps: [leap('same', { fill: 'pillar' }), leap('same', { fill: 'pillar' })]
	},
	{ id: 'stepAndSpike', level: 1, weight: 0.9, leaps: [leap('up1'), leap('same', { most: 2 })] },
	{
		id: 'spikes2x',
		level: 0,
		weight: 0.9,
		leaps: [leap('same', { most: 2 }), leap('same', { most: 2 })]
	},
	{
		id: 'ringJump',
		level: 2,
		weight: 0.6,
		leaps: [leap('same', { ring: 'yellow' }), leap('same', { most: 2 })]
	},
	// Three jumps
	{ id: 'stairs3', level: 2, weight: 0.9, leaps: [leap('up1'), leap('up1'), leap('up1')] },
	{ id: 'zigzag', level: 2, weight: 0.7, leaps: [leap('up1'), leap('ground'), leap('up1')] },
	{ id: 'gaps3', level: 3, weight: 0.6, high: 1, leaps: [leap('gap'), leap('gap'), leap('gap')] },
	// Upside down
	{ id: 'upsideOrbs', level: 2, weight: 0.8, gravity: true, upside: 'orbs' },
	{ id: 'upsidePortal', level: 1, weight: 0.8, gravity: true, upside: 'portal' }
];

/** Whether a piece goes up (1), down (-1) or stays (0) */
const rise = (b: Block) => {
	const ways = (b.leaps ?? []).map((l) =>
		l.landing.startsWith('up') ? 1 : l.landing === 'down1' || l.landing === 'ground' ? -1 : 0
	);
	const sum = ways.reduce((a: number, w) => a + w, 0);
	return Math.sign(sum) || (ways.includes(-1) ? -1 : 0);
};

const spikeAfter = (x: number) => Math.ceil(x - 0.5 - 1e-6) + 0.5;
const spikeBefore = (x: number) => Math.floor(x - 0.5 + 1e-6) + 0.5;

/** How a piece was built (to build it again the same) */
interface Built {
	block: Block;
	/** How late and early (ms) the first press may come before something's in the way */
	late: number;
	early: number;
	/** The room its first press really has (ms, early and late), when measured */
	room?: [number, number];
	/** The click after it, and how many it left out */
	next: number;
	skipped: number;
}

export function buildBlocks(ctx: Context, sec: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const box = hitbox(sec.mode, sec.mini);
	const robot = sec.mode === 'robot';
	const tolerance = preset.tolerance;
	const speed = sec.speed;
	const intensity = sec.intensity ?? 0.5;
	const exitX = world.xAt(sec.end - 150);
	const brush = 0.6 + speed * 0.035;
	const rowMost = preset.level === 0 ? 2 : sec.speedIndex >= 3 ? 6 : sec.speedIndex >= 2 ? 4 : 3;
	const aim = Math.max(2 * tolerance + 12, byIntensity(preset.window, intensity));
	const times = clicks.filter(
		(t) => t > sec.start + 300 && t < sec.end - 350 && !musicalRest(ctx.chart, t)
	);
	const ends = new Map(ctx.chart.notes.map((n) => [n.time, n.end]));
	const cube = cubeAt(sec.speedIndex);
	/** A jump's time in the air (ms) */
	const air = ((2 * cube.jump) / cube.gravity) * (sec.mini ? 0.8 : 1) * 1000;
	const hold = robot ? 160 : 90;

	let state = entry;
	let platform: Solid | null =
		world.solids
			.near(entry.x - box.w, entry.x + box.w)
			.find((s) => Math.abs(s.y1 - (entry.y - box.h)) < 0.02) ?? null;
	let previous: { from: PlayerState; variants: InputEvent[][] } | null = null;
	const beatAt = (time: number) =>
		ctx.chart.timing.reduce((a, p) => (p.time <= time ? p : a), ctx.chart.timing[0]).beatLength;
	/** The rhythm from a click on (its next clicks within a bar, in quarter beats) */
	const motifKey = (i: number) => {
		const beat = beatAt(times[i]);
		return (
			`blocks:${sec.speedIndex}:${Number(sec.mini)}:` +
			times
				.slice(i, i + 6)
				.filter((t) => t - times[i] < beat * 4)
				.map((t) => Math.round(((t - times[i]) / beat) * 4))
				.join(',')
		);
	};

	/**
	 * Where it is at a click, on the ground: there, or down a moment after (up to 30 ms: a press
	 * held from then jumps as it lands, so the click right after a jump's landing is on the beat
	 * too, not left out)
	 */
	const LAND = 30;
	const downAt = (from: PlayerState, time: number, inputs: InputEvent[]) => {
		const at = simulate(world, from, time, inputs);
		if (at.grounded || at.dead) return at;
		const soon = simulate(world, at, time + LAND, inputs);
		return soon.grounded && !soon.dead ? soon : at;
	};

	/** From far enough before the click to measure a press that much earlier */
	let ahead = entry;
	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		ahead = simulate(world, state, Math.max(state.time, time - 170 - STEP * 3), plan);
		state = simulate(world, state, time - tolerance - STEP * 3, plan);
		if (state.dead) break;
		const at = downAt(state, time, plan);
		if (!at.grounded || at.gravity !== 1) continue;
		const height = half(at.y - box.h);
		const beat = beatAt(time);
		const sustain = (ends.get(time) ?? time) - time;
		const fits = BLOCKS.filter(
			(b) =>
				b.level <= preset.level &&
				!(robot && b.cubeOnly) &&
				!(ctx.simplify && (b.level > 1 || b.gravity)) &&
				(b.high === undefined || height >= b.high) &&
				(!b.held || sustain >= beat * 0.6) &&
				(!b.gravity || gravityIn(ctx, sec.mode))
		);
		const key = motifKey(i);
		const remembered = ctx.motifs.get(key)?.[0];
		// (the next click comes while a jump from here is in the air: a piece with an orb there
		// takes it, on the beat, where a plain jump would leave it out)
		const inAir = times[i + 1] !== undefined && times[i + 1] - time < air - 60;
		const takesAir = (b: Block) => !!b.leaps?.[0]?.orbs?.length || b.upside === 'orbs';
		const order = shuffleByWeight(
			rng,
			fits.map((b) => ({
				item: b,
				weight:
					b.weight *
					freshness(ctx, b.id) *
					(b.level >= 2 ? 0.6 + intensity * 0.8 : 1) *
					(remembered === b.id ? 5 : 1) *
					(inAir && takesAir(b) ? 2.5 : 1) *
					// (up where it's low, down where it's high: it comes back to the ground)
					(rise(b) > 0 ? Math.pow(0.45, Math.max(0, height - 1)) : 1) *
					(rise(b) < 0 ? 1 + height * 0.5 : 1)
			}))
		);
		// The first few that work; the one that leaves the fewest clicks out
		let best: Built | null = null;
		let works = 0;
		for (const block of order.slice(0, inAir ? 16 : 12)) {
			const built = place(block, i, null, 'try');
			if (!built) continue;
			works++;
			// (a stretch upside down is worth a click left out: else the plain jumps always win)
			const cost = (b: Built) => b.skipped - (b.block.gravity ? 1 : 0);
			if (!best || cost(built) < cost(best)) best = built;
			if (built.skipped === 0 || works >= (inAir ? 8 : 3)) break;
		}
		if (!best) continue;
		// More room than the difficulty asks for: the same closer, by what it had too much on
		// each side (the first press's room measured)
		const measured = place(best.block, i, best, 'measure');
		if (measured?.room) {
			const [early, late] = measured.room;
			if (early + late > aim * 1.15) {
				const wantLate = Math.max(tolerance + 6, aim * 0.5);
				const wantEarly = Math.max(tolerance + 6, aim - wantLate);
				const closer = place(
					best.block,
					i,
					{
						...best,
						late: best.late - Math.max(0, late - wantLate),
						early: best.early - Math.max(0, early - wantEarly)
					},
					'try'
				);
				if (closer && closer.next === best.next) best = closer;
			}
		}
		place(best.block, i, best, 'keep');
		used(ctx, best.block.id);
		if (!ctx.motifs.has(key)) ctx.motifs.set(key, [best.block.id]);
		i = best.next - 1;
	}
	if (platform) {
		(platform as Solid).x1 = Math.min((platform as Solid).x1, exitX);
		world.solids.touch();
	}
	return simulate(world, entry, sec.end, plan);

	// --- One piece --------------------------------------------------------------------------

	type Kit = {
		a: Attempt;
		presses: InputEvent[];
		/** The presses it can't do without */
		must: number[];
		platform: Solid | null;
		late: number;
		early: number;
		/** The next click it may take, how many it left out, where and when it's down again */
		at: number;
		skipped: number;
		landX: number;
		landTime: number;
	};

	/**
	 * Builds a piece from click i on and plays it ('try': how it went, taken out again; 'measure':
	 * also the room its first press has; 'keep': built again the same way and kept). Its layouts:
	 * aimed at the room the difficulty asks for, a roomier one, as close as allowed
	 */
	function place(
		block: Block,
		i: number,
		given: Built | null,
		how: 'try' | 'measure' | 'keep'
	): Built | null {
		const spare = Math.max(0, aim - 2 * tolerance - 30);
		const share = 0.35 + rng() * 0.3;
		const layouts: [number, number][] = given
			? [[given.late, given.early]]
			: [
					[tolerance + spare * share, tolerance + spare * (1 - share)],
					[tolerance + 40 + spare * 0.6, tolerance + 40 + spare * 0.6],
					[tolerance + 4, tolerance + 4]
				];
		for (const [late, early] of layouts) {
			const a = new Attempt(world, exitX);
			const kit: Kit = {
				a,
				presses: [],
				must: [],
				platform,
				late,
				early,
				at: i,
				skipped: 0,
				landX: -Infinity,
				landTime: -Infinity
			};
			const ok =
				(block.upside
					? upside(kit, block)
					: (block.leaps ?? []).every((l, k) => jump(kit, l, k === 0))) && kit.landX + 1.5 <= exitX;
			// The click after it: the first once it's down
			let next = kit.at;
			while (next < times.length && times[next] < kit.landTime - LAND) next++;
			const skipped = kit.skipped + (next - kit.at);
			const nominal = [...kit.presses].sort((p, q) => p.time - q.time);
			const until = Math.min(sec.end, Math.max(kit.landTime + 500, (times[next] ?? sec.end) + 120));
			if (!ok || !checks(a, nominal, kit.must, until, times[i])) {
				a.revert();
				continue;
			}
			const built: Built = { block, late, early, next, skipped };
			if (how === 'measure') {
				// (the first press and its release moved, the others on time)
				const first = nominal.findIndex((e) => e.down);
				const release = nominal.findIndex((e, k) => k > first && !e.down);
				const before = plan.filter((e) => e.time >= ahead.time);
				const passes = (shift: number) =>
					!simulate(
						world,
						ahead,
						until,
						[
							...before,
							...nominal.map((e, k) =>
								k === first || k === release ? { ...e, time: e.time + shift } : e
							)
						].sort((p, q) => p.time - q.time)
					).dead;
				built.room = [reach(passes, -1, tolerance, 170), reach(passes, 1, tolerance, 170)];
			}
			if (how !== 'keep') {
				a.revert();
				return built;
			}
			platform = kit.platform;
			plan.push(...nominal);
			plan.sort((p, q) => p.time - q.time);
			previous = { from: state, variants: variantsOf(nominal, times[i]) };
			return built;
		}
		return null;
	}

	/** The ways a piece may be played: on time, all early, all late, each press a bit off */
	function variantsOf(nominal: InputEvent[], seed: number) {
		const variants = [-tolerance, 0, tolerance].flatMap((shift) =>
			(robot ? [-20, 20] : [0]).map((release) =>
				nominal.map((e) => ({ time: e.time + shift + (e.down ? 0 : release), down: e.down }))
			)
		);
		if (nominal.length > 2)
			variants.push(...jittered(nominal, tolerance * 0.75, Math.round(seed), 5).slice(2));
		return variants;
	}

	/** The rules kept, played every way (with the piece before it too), every press needed */
	function checks(a: Attempt, nominal: InputEvent[], must: number[], until: number, first: number) {
		if (!a.legal()) return false;
		const variants = variantsOf(nominal, first);
		if (variants.some((v) => simulate(world, state, until, v).dead)) return false;
		if (
			previous &&
			previous.variants.some(
				(v) =>
					simulate(
						world,
						previous!.from,
						until,
						[...v, ...nominal].sort((p, q) => p.time - q.time)
					).dead
			)
		)
			return false;
		const without = (t: number) =>
			nominal.filter((e, k) => (e.down ? e.time : nominal[k - 1]?.time) !== t);
		if (!(must.length > 0 && must.every((t) => simulate(world, state, until, without(t)).dead)))
			return false;
		// Every orb needed too: without it (the press there a plain jump, or nothing in the air) it
		// mustn't get through, else the orb is only there to look at
		return a.orbs.every((orb) => {
			world.orbs.remove(orb);
			const dead = simulate(world, state, until, nominal).dead;
			world.orbs.add(orb);
			return dead;
		});
	}

	/** The presses so far with the piece's */
	function withPlan(kit: Kit) {
		return [...plan, ...kit.presses].sort((p, q) => p.time - q.time);
	}

	/**
	 * A jump of a piece: on the first click once it's down (the piece's first: its click), the
	 * orbs on the clicks after it while it's in the air; what's below and where it lands
	 */
	function jump(kit: Kit, leap: Leap, first: boolean) {
		const { a } = kit;
		let c = kit.at;
		while (!first && c < times.length && times[c] < kit.landTime - LAND) c++;
		if (c >= times.length) return false;
		kit.skipped += c - kit.at;
		const time = times[c];
		kit.at = c + 1;
		const at = downAt(state, time, withPlan(kit));
		if (at.dead || !at.grounded || at.gravity !== 1) return false;
		/** How long before it's down the press comes (held till it is) */
		const before = Math.max(0, at.time - time);
		const height = half(at.y - box.h);
		const takeoff = at.x;
		const lateX = (speed * kit.late) / 1000;
		const earlyX = (speed * kit.early) / 1000;
		const old = kit.platform;
		const target =
			leap.landing === 'up1'
				? height + 1
				: leap.landing === 'up2'
					? height + 2
					: leap.landing === 'down1'
						? height - 1
						: leap.landing === 'ground'
							? 0
							: height;
		if (target < 0 || target > preset.height) return false;
		const cut = leap.landing === 'down1' || leap.landing === 'ground' || leap.landing === 'gap';
		const edge = half(takeoff + lateX - box.w + 0.25);
		if (cut) {
			if (!old || height < 1 || edge <= old.x0 + 0.5) return false;
			const end = old.x1;
			a.change(
				() => (old.x1 = edge),
				() => (old.x1 = end)
			);
		}
		// The orbs: on the clicks right after it, while it's in the air
		const orbTimes = (leap.orbs ?? []).map((_, k) => times[kit.at + k]);
		if (orbTimes.some((t, k) => t === undefined || t - (orbTimes[k - 1] ?? time) < 130))
			return false;
		kit.at += orbTimes.length;
		// How it takes off
		const sustain = Math.min(700, (ends.get(time) ?? time) - time);
		if (leap.ring) a.orb(leap.ring, half(takeoff), height + box.h);
		if (leap.dash) a.orb('dash', half(takeoff), height + box.h, 1);
		let length =
			(leap.dash ? sustain : leap.landing.startsWith('up') && robot ? 240 : hold) + before;
		if (orbTimes.length) length = Math.min(length, orbTimes[0] - time - 30);
		kit.presses.push(...tap(time, length));
		kit.must.push(time, ...orbTimes);
		for (let k = 0; k < orbTimes.length; k++) {
			const t = orbTimes[k];
			const there = simulate(world, state, t, withPlan(kit));
			if (there.dead || there.grounded || there.y > 9) return false;
			a.orb(leap.orbs![k], half(there.x + speed * 0.01), Math.round(there.y * 2) / 2);
			const after = orbTimes[k + 1] ?? times[kit.at] ?? t + 400;
			kit.presses.push(...tap(t, Math.min(90, after - t - 35)));
		}
		// Where it comes down: the first time it falls through the height it lands on
		const last = orbTimes[orbTimes.length - 1] ?? time;
		const trace: Point[] = [];
		simulate(world, state, Math.min(sec.end, last + 1800), withPlan(kit), { trace });
		const fall = trace.find(
			(p, k) =>
				k > 0 &&
				p.time > last + 70 &&
				p.y < trace[k - 1].y &&
				p.y - box.h <= target + 0.08 &&
				trace[k - 1].y - box.h >= target - 0.08
		);
		if (!fall) return false;
		const landX = fall.x;
		kit.landX = landX;
		kit.landTime = fall.time;
		const firstSpike = spikeAfter(takeoff + lateX + brush);

		if (!cut && target === height) {
			if (leap.fill === 'block' || leap.fill === 'pillar') {
				// Under the top of the jump: a low block, or a pillar with a small spike on it
				const apex = trace
					.filter((p) => p.time > time && p.time < fall.time)
					.reduce((b, p) => (p.y > b.y ? p : b), at);
				const x = Math.floor(apex.x);
				if (leap.fill === 'block')
					a.solid({ x0: x - 0.5, x1: x + 1, y0: 0, y1: height + 1, style: 0 });
				else {
					a.solid({ x0: x, x1: x + 1, y0: 0, y1: height + 1, style: 0 });
					a.spike(x + 0.5, height + 1, 1, 'small');
				}
				return true;
			}
			const lastSpike = spikeBefore(landX - earlyX - brush);
			const count = Math.round(lastSpike - firstSpike) + 1;
			if (count < 1) return false;
			// (over orbs a jump goes far: a longer row, that it doesn't get over without them; a long
			// jump over a short row has the row in its middle)
			const most = leap.most ?? rowMost + (orbTimes.length ? 6 : 0);
			const n = Math.min(count, most);
			const fill = leap.fill ?? 'spikes';
			if (n === count || preset.level < 2) {
				const from = firstSpike + Math.floor((count - n) / 2);
				row(a, from, from + n - 1, height, fill, false);
			} else if (n === 1) {
				// (on the harder levels where the press is close: right after the takeoff, or right
				// before the landing, by turns)
				row(
					a,
					...(((Math.round(time) >> 3) & 1 ? [firstSpike, firstSpike] : [lastSpike, lastSpike]) as [
						number,
						number
					]),
					height,
					fill,
					false
				);
			} else {
				// (the row split: some right after the takeoff, the rest right before the landing)
				const first = Math.ceil(n / 2);
				row(a, firstSpike, firstSpike + first - 1, height, fill, false);
				row(a, lastSpike - (n - first) + 1, lastSpike, height, fill, false);
			}
			return true;
		}
		// Down on another height: where that starts, as early as the press may come
		const resume = half(landX - earlyX + 0.3);
		if (resume - (cut ? edge : firstSpike) < 1) return false;
		let next: Solid | null = null;
		if (target > 0) {
			if (!cut && old) {
				const end = old.x1;
				a.change(
					() => (old.x1 = resume),
					() => (old.x1 = end)
				);
			}
			next = a.solid({ x0: resume, x1: exitX, y0: sec.floor, y1: target, style: 0 });
		}
		if (cut) {
			const from = Math.ceil(edge) + 0.5;
			const to = target > 0 ? spikeBefore(resume - 0.5) : spikeBefore(landX - earlyX - brush);
			if (to < from) return false;
			row(a, from, to, sec.floor, leap.fill === 'saw' ? 'saw' : 'spikes', target > 0);
		} else {
			const to = spikeBefore(resume - 0.5);
			if (to < firstSpike || Math.round(to - firstSpike) + 1 > rowMost) return false;
			row(a, firstSpike, to, height, 'spikes', false);
		}
		kit.platform = next;
		return true;
	}

	/** Spikes from one place to another (a block apart), a saw in a long row */
	function row(a: Attempt, from: number, to: number, base: number, fill: Fill, pit: boolean) {
		const count = Math.round(to - from) + 1;
		const small = pit || robot;
		if (fill === 'saw' && count >= 3) {
			a.spike(from, base, 1, small ? 'small' : 'spike');
			a.saw(half((from + to) / 2), base + 0.1, count >= 5 ? 1 : 0.8);
			a.spike(to, base, 1, small ? 'small' : 'spike');
			return;
		}
		for (let k = 0; k < count; k++) {
			const middle = k > 0 && k < count - 1;
			a.spike(from + k, base, 1, small || (fill === 'small' && middle) ? 'small' : 'spike');
		}
	}

	/**
	 * Upside down for a few clicks. With orbs: a blue orb on the first turns gravity around, up
	 * under a slab; two jumps (down) up there over spikes hanging from it, each on the first click
	 * once it's up; a blue orb on the click after turns it back down. With portals: the first click
	 * jumps over small spikes into a gravity portal at the top of the jump, two jumps up there, and
	 * a portal once it's down from the last turns it back. Small spikes on the ground below for who
	 * doesn't turn.
	 */
	function upside(kit: Kit, block: Block) {
		const { a } = kit;
		const byOrb = block.upside === 'orbs';
		const inAt = times[kit.at];
		const at = downAt(state, inAt, withPlan(kit));
		if (at.dead || !at.grounded || at.gravity !== 1) return false;
		const h = half(at.y - box.h);
		const x = at.x;
		const high = h + (sec.mini ? 3 : 4);
		kit.at++;
		const portal = (px: number, gravity: 1 | -1) => {
			const p = { x: px, y: h + 2.5, gravity, x0: px - 0.6, x1: px + 0.6 };
			a.change(
				() => world.gravityPortals.add(p),
				() => world.gravityPortals.remove(p),
				px
			);
		};
		if (byOrb) a.orb('blue', half(x), h + box.h);
		// (held till it's down, where the press comes just before)
		kit.presses.push(...tap(inAt, hold + Math.max(0, at.time - inAt)));
		kit.must.push(inAt);
		// (the slab from where it turns, as long as it may be: shortened once it's known where it
		// turns back)
		let slab: Solid | null = null;
		if (byOrb)
			slab = a.solid({ x0: Math.floor(x) + 1, x1: exitX, y0: high, y1: high + 1, style: 1 });
		else {
			// (in at the top of the jump)
			const trace: Point[] = [];
			simulate(world, state, inAt + 600, withPlan(kit), { trace });
			const apex = trace
				.filter((p) => p.time > inAt)
				.reduce((b, p) => (p.y > b.y ? p : b), { x, y: -Infinity, time: inAt });
			if (!isFinite(apex.y) || apex.y - box.h < h + 0.8) return false;
			const px = half(apex.x);
			portal(px, -1);
			slab = a.solid({ x0: Math.ceil(px - 0.5), x1: exitX, y0: high, y1: high + 1, style: 1 });
		}
		/** The first click it's up on the slab at (from the next it may take on) */
		const onSlab = () => {
			for (let c = kit.at; c < times.length && c < kit.at + 4; c++) {
				const s = simulate(world, state, times[c], withPlan(kit));
				if (s.dead) return -1;
				if (s.grounded && s.gravity < 0 && Math.abs(s.y - (high - box.h)) < 0.05) return c;
			}
			return -1;
		};
		for (let jumps = 0; jumps < 2; jumps++) {
			const c = onSlab();
			if (c < 0) return false;
			kit.skipped += c - kit.at;
			kit.at = c + 1;
			const s = simulate(world, state, times[c], withPlan(kit));
			const mid = s.x + ((speed * air) / 1000) * 0.5;
			a.spike(Math.floor(mid) + 0.5, high, -1, robot ? 'small' : 'spike');
			kit.presses.push(...tap(times[c], hold));
			kit.must.push(times[c]);
		}
		let outAt: number;
		if (byOrb) {
			const c = onSlab();
			if (c < 0) return false;
			kit.skipped += c - kit.at;
			kit.at = c + 1;
			outAt = times[c];
			const s = simulate(world, state, outAt, withPlan(kit));
			a.orb('blue', half(s.x), high - box.h);
			kit.presses.push(...tap(outAt, hold));
			kit.must.push(outAt);
		} else {
			// (once it's down from the last jump)
			const trace: Point[] = [];
			const lastJump = kit.must[kit.must.length - 1];
			simulate(world, state, lastJump + air + 400, withPlan(kit), { trace });
			const down = trace.find(
				(p) => p.time > lastJump + 100 && Math.abs(p.y - (high - box.h)) < 0.05
			);
			if (!down) return false;
			outAt = down.time + 60;
			portal(half(world.xAt(outAt)), 1);
		}
		const endX = world.xAt(outAt);
		if (endX + 6 > exitX) return false;
		// (with orbs on past where it turns, with a spike that who doesn't turn runs into)
		slab!.x1 = Math.ceil(endX) + (byOrb ? 4 : 2);
		world.solids.touch();
		if (byOrb) a.spike(Math.floor(endX + 3) + 0.5, high, -1, robot ? 'small' : 'spike');
		a.spikes(Math.ceil(x + 2), Math.floor(endX - 1), h, 1, 'small');
		// Down on the ground again: where
		const trace: Point[] = [];
		simulate(world, state, Math.min(sec.end, outAt + 1200), withPlan(kit), { trace });
		const down = trace.find((p) => p.time > outAt + 30 && p.y - box.h <= h + 0.02);
		if (!down) return false;
		kit.landX = down.x;
		kit.landTime = down.time;
		return true;
	}
}
