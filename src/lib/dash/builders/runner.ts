// Grounded modes (cube, robot). Every jump is planned as a whole: its takeoff (a jump, an orb on
// the ground, a pad or a dash on a held note), the orbs it takes in the air on the notes that
// follow it, and where it comes down (the same height, a step up, or down off an edge). Then
// what's in its way is put where it decides how precise the press must be: the first spike (or
// the edge it jumps from) as far after the takeoff as a late press may come, the last spike (or
// the start of where it lands) as far before the landing as an early one may. Several such
// layouts are built and played with the physics, on time, early and late; of those that work,
// the one whose room for the press comes closest to what the difficulty asks for there (less
// where the music is intense) is kept, with some leeway for variety and for building the same
// where the music repeats.
//
// The terrain always stands on the floor (no floating upper lanes), the spikes stand on it.

import { Attempt, byIntensity, freshness, half, tap, used, type Context } from '../build';
import { composePhrases, musicalRest, phraseAt } from '../composition';
import { hitAt } from '../audio';
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

interface Launch {
	kind: 'jump' | 'ring' | 'pad' | 'dash';
	ring?: OrbKind;
	/** How many of the clicks after it are taken by orbs in the air */
	chain: number;
	/** How many after those it jumps over (too soon after it for a jump of their own) */
	skip?: number;
}

interface Layout {
	/** The height it comes down on */
	landing: number;
	/** The surface it jumps from ends (a pit), or goes on under spikes */
	cut: boolean;
	/** What's between: spikes, small ones in the middle, a saw in the middle; or a block */
	fill: 'spikes' | 'small' | 'saw' | 'block';
	/** How late (ms) the press may come before the first spike or the edge is in the way */
	late: number;
	/** How early (ms) it may come before it lands short of where it may land */
	early: number;
	/** Aimed at the room asked for (and how much of it late): measured, it may be set closer */
	aimed?: number;
}

/** The first spike place (x.5) at or after a place, and the last at or before one */
const spikeAfter = (x: number) => Math.ceil(x - 0.5 - 1e-6) + 0.5;
const spikeBefore = (x: number) => Math.floor(x - 0.5 + 1e-6) + 0.5;

/**
 * How far a press may be moved (ms) one way and still pass: from `low` (known to pass) up to
 * `cap`, in whole physics steps
 */
export function reach(passes: (shift: number) => boolean, way: 1 | -1, low: number, cap: number) {
	let lo = Math.max(0, Math.floor(low / STEP));
	let hi = Math.ceil(cap / STEP);
	if (passes(way * hi * STEP)) return hi * STEP;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (passes(way * mid * STEP)) lo = mid;
		else hi = mid;
	}
	return lo * STEP;
}

export function buildRunner(ctx: Context, sec: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, preset, rng } = ctx;
	const box = hitbox(sec.mode, sec.mini);
	const notes = new Map(ctx.chart.notes.map((n) => [n.time, n]));
	const times = clicks.filter(
		(t) => t > sec.start + 650 && t < sec.end - 850 && !musicalRest(ctx.chart, t)
	);
	const phrases = composePhrases(ctx.chart, times);
	const intensity = sec.intensity ?? 0.5;
	const tolerance = preset.tolerance;
	const speed = sec.speed;
	const exitX = world.xAt(sec.end - 700);
	const robot = sec.mode === 'robot';
	// The room a press should have here (ms, early + late): never less than the tolerance allows
	const aim = Math.max(2 * tolerance + 12, byIntensity(preset.window, intensity));
	// (rising and falling through a spike's deadly middle takes a moment: blocks at this speed)
	const brush = 0.6 + speed * 0.035;
	// The longest row of spikes on a surface: at speed a jump is long
	const rowMost = preset.level === 0 ? 2 : sec.speedIndex >= 3 ? 6 : sec.speedIndex >= 2 ? 4 : 3;

	let state = entry;
	let platform: Solid | null =
		world.solids
			.near(entry.x - box.w, entry.x + box.w)
			.find((s) => Math.abs(s.y1 - (entry.y - box.h)) < 0.02) ?? null;
	let previous: { from: PlayerState; variants: InputEvent[][] } | null = null;
	/** Upside down stretches so far in this part, and tries */
	let upsides = 0;
	let upsideTries = 0;
	/** What was built for each rhythm: the same rhythm later, the same kind of thing again */
	const motifKey = (rhythm: string) => `run:${sec.speedIndex}:${Number(sec.mini)}:${rhythm}`;

	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		// (from far enough before it to try a press that much earlier: one before the state it's
		// played from would be left out)
		const ahead = simulate(world, state, Math.max(state.time, time - 170 - STEP * 3), plan);
		state = simulate(world, state, time - tolerance - STEP * 3, plan);
		if (state.dead) break;
		const planAhead = plan.filter((e) => e.time >= ahead.time);
		const at = simulate(world, state, time, plan);
		if (!at.grounded || at.gravity !== 1) continue;
		const height = half(at.y - box.h);
		const phrase = phraseAt(ctx.chart, phrases, time);
		const phraseTimes = times.filter((t) => phraseAt(ctx.chart, phrases, t) === phrase);
		const position = phraseTimes.indexOf(time);
		const phase = position / Math.max(1, phraseTimes.length - 1);
		const ceiling = Math.min(preset.height, sec.mini ? 2 : 3 + Math.round(intensity));
		// A rise and return over the phrase, flat at the start and end of the part
		const contour =
			ctx.simplify || preset.level === 0 || time < sec.start + 1800 || time > sec.end - 2500
				? 0
				: Math.round(Math.sin(phase * Math.PI) * ceiling);
		const desired = Math.max(0, Math.min(height + 1, Math.max(height - 1, contour)));
		const beat = ctx.chart.timing.reduce(
			(a, p) => (p.time <= time ? p : a),
			ctx.chart.timing[0]
		).beatLength;
		const sustain = (notes.get(time)?.end ?? time) - time;
		const hold = robot
			? Math.min(
					285,
					Math.max(
						desired > height ? 240 : 100,
						Math.min(time + sustain, time + beat * 0.5) - time || beat * 0.3
					)
				)
			: 90;
		const accent = strength(time);
		const room = (times[i + 1] ?? sec.end) - time;
		let motifs = ctx.motifs.get(motifKey(phrase.rhythm));
		const wanted = motifs?.[position];

		// --- Now and then a phrase upside down (a gravity portal in, one out) ----------------
		if (
			!ctx.simplify &&
			preset.level >= 1 &&
			upsides < (preset.level >= 3 ? 2 : 1) &&
			upsideTries < 5 &&
			time > sec.start + 1500 &&
			sec.end - time > 3200 &&
			(position === 0 || rng() < 0.35) &&
			rng() < preset.flips * (0.3 + intensity * 0.5)
		) {
			upsideTries++;
			const last = upside(i, at, height);
			if (last !== null) {
				upsides++;
				i = last;
				previous = null;
				continue;
			}
		}

		// --- How it takes off: the notes after it in the air first (each an orb) --------------
		const launches: Launch[] = [];
		if (!ctx.simplify && preset.chain > 0)
			for (let k = Math.min(preset.chain, 4); k >= 1; k--) {
				const last = times[i + k];
				if (last === undefined || last - time > 260 + k * 400) continue;
				let spaced = true;
				for (let j = 1; j <= k; j++) if (times[i + j] - times[i + j - 1] < 130) spaced = false;
				if (spaced) launches.push({ kind: 'jump', chain: k });
			}
		if (!ctx.simplify && preset.level >= 1 && position === phraseTimes.length - 1 && accent > 0.7)
			launches.push({
				kind: 'ring',
				ring: room > 1000 && preset.level >= 2 ? 'red' : 'yellow',
				chain: 0
			});
		if (!ctx.simplify && preset.level >= 1 && sustain >= 250 && room > 850) {
			const long = sustain >= beat * 0.75;
			// (a held note is held: a dash; on the easier levels a pad takes a short one)
			if (long || preset.level >= 3) launches.push({ kind: 'dash', chain: 0 });
			else launches.push({ kind: 'pad', chain: 0 }, { kind: 'dash', chain: 0 });
		}
		if (!ctx.simplify && preset.level >= 2 && accent > 0.5 && rng() < 0.2 * freshness(ctx, 'ring'))
			launches.push({ kind: 'ring', ring: accent > 0.8 ? 'red' : 'pink', chain: 0 });
		launches.push({ kind: 'jump', chain: 0 });
		// (the note after it too soon for a jump of its own, and no orb for it: over it)
		launches.push({ kind: 'jump', chain: 0, skip: 1 }, { kind: 'jump', chain: 0, skip: 2 });

		let committed = false;
		for (const launch of launches) {
			if (committed) break;
			const skip = launch.skip ?? 0;
			const chained = times.slice(i + 1, i + 1 + launch.chain);
			const next = times[i + 1 + launch.chain + skip] ?? sec.end;
			const until = Math.min(sec.end, time + Math.max(1100, next - time + 120));
			const length = launch.kind === 'dash' ? Math.min(700, sustain) : hold;
			const nominal: InputEvent[] =
				launch.kind === 'pad'
					? []
					: [
							{ time, down: true },
							{ time: time + length, down: false }
						];
			chained.forEach((t, k) => {
				const gap = (chained[k + 1] ?? next) - t;
				nominal.push({ time: t, down: true }, { time: t + Math.min(90, gap - 35), down: false });
			});
			// (a press of the robot held a bit shorter or longer too)
			const variants = [-tolerance, 0, tolerance].flatMap((shift) =>
				(robot ? [-20, 20] : [0]).map((release) =>
					nominal.map((e, k) => ({
						time: e.time + shift + (k === 1 && launch.kind !== 'pad' ? release : 0),
						down: e.down
					}))
				)
			);

			// --- Where it comes down, and how much room the press gets --------------------------
			const heights = ctx.simplify ? [height] : [...new Set([desired, height, 0])];
			const layouts: Layout[] = [];
			for (const landing of heights) {
				const cuts =
					landing < height
						? [true]
						: height > 0 && !ctx.simplify
							? rng() < 0.5
								? [true, false]
								: [false, true]
							: [false];
				for (const cut of cuts) {
					// Aimed at the room asked for (more of it on one side or the other), and a roomier one
					const share = 0.3 + rng() * 0.4;
					const spare = Math.max(0, aim - 2 * tolerance - 30);
					const fill: Layout['fill'] =
						preset.level >= 2 && rng() < 0.25 * freshness(ctx, 'saw')
							? 'saw'
							: preset.level >= 1 && rng() < 0.35
								? 'small'
								: 'spikes';
					layouts.push(
						{
							landing,
							cut,
							fill,
							late: tolerance + spare * share,
							early: tolerance + spare * (1 - share),
							aimed: share
						},
						{
							landing,
							cut,
							fill: 'spikes',
							late: tolerance + 40 + spare * 0.65,
							early: tolerance + 40 + spare * 0.65
						}
					);
				}
			}
			if (!ctx.simplify && launch.chain === 0 && preset.level <= 1 && !robot)
				layouts.push({ landing: height, cut: false, fill: 'block', late: 0, early: 0 });

			const usable: { layout: Layout; window: number; family: string }[] = [];
			for (let n = 0; n < layouts.length; n++) {
				const layout = layouts[n];
				// (enough: one about as precise as asked for, and a few to choose from)
				if (usable.length >= 3 && usable.some((u) => Math.abs(u.window - aim) < aim * 0.2)) break;
				const a = new Attempt(world, exitX);
				const result = build(a, layout, launch, chained, nominal, at, height, until, next);
				if (!result) {
					a.revert();
					continue;
				}
				const ok =
					a.legal() &&
					variants.every((v) => !simulate(world, state, until, v).dead) &&
					(!previous ||
						previous.variants.every(
							(v) =>
								!simulate(
									world,
									previous!.from,
									until,
									[...v, ...nominal].sort((p, q) => p.time - q.time)
								).dead
						)) &&
					required(launch, chained, nominal, until);
				if (!ok) {
					a.revert();
					continue;
				}
				// The room the press really has (the presses in the air after it on time)
				const passes = (shift: number) =>
					!simulate(
						world,
						ahead,
						until,
						[
							...planAhead,
							...nominal.map((e, k) => (k < 2 ? { ...e, time: e.time + shift } : e))
						].sort((p, q) => p.time - q.time)
					).dead;
				const early = launch.kind === 'pad' ? aim / 2 : reach(passes, -1, tolerance, 170);
				const late = launch.kind === 'pad' ? aim / 2 : reach(passes, 1, tolerance, 170);
				const window = early + late;
				usable.push({ layout, window, family: result.family });
				a.revert();
				// More room than asked for: the same again, closer by what it had too much on each side
				if (layout.aimed !== undefined && window > aim * 1.15) {
					const wantLate = Math.max(tolerance + 6, aim * layout.aimed);
					const wantEarly = Math.max(tolerance + 6, aim - wantLate);
					layouts.splice(n + 1, 0, {
						...layout,
						late: layout.late - Math.max(0, late - wantLate),
						early: layout.early - Math.max(0, early - wantEarly),
						aimed: undefined
					});
				}
			}
			if (!usable.length) continue;
			// The closest to what's asked for (with a bit of chance, what's fresh, what repeats)
			const scored = usable.map((u) => ({
				...u,
				score:
					Math.abs(u.window - aim) / aim +
					(u.window < aim ? 0.1 : 0) +
					rng() * 0.15 +
					(1 - freshness(ctx, u.family)) * 0.25 -
					(wanted && u.family === wanted ? 0.3 : 0)
			}));
			scored.sort((p, q) => p.score - q.score);
			const chosen = scored[0];
			const a = new Attempt(world, exitX);
			const result = build(a, chosen.layout, launch, chained, nominal, at, height, until, next);
			if (!result) {
				a.revert();
				continue;
			}
			platform = result.platform;
			plan.push(...nominal);
			plan.sort((p, q) => p.time - q.time);
			previous = { from: state, variants };
			used(ctx, chosen.family);
			if (!motifs) ctx.motifs.set(motifKey(phrase.rhythm), (motifs = []));
			motifs[position] ??= chosen.family;
			committed = true;
			i += skip;
			i += launch.chain;
		}
	}
	// The last support ends early enough to settle onto the next mode's floor.
	if (platform) {
		platform.x1 = Math.min(platform.x1, exitX);
		world.solids.touch();
	}
	return simulate(world, entry, sec.end, plan);

	// --- Upside down ---------------------------------------------------------------------------

	/**
	 * A phrase upside down: on click i a gravity portal (or on the harder levels a blue orb, a
	 * press) turns gravity around, up under a slab; the clicks after it jump (down) over spikes
	 * hanging from it; the last one (a portal, or a blue orb) turns it back down onto the ground,
	 * where small spikes wait for who didn't turn. Played on time, all early and late, short and
	 * long, each a bit off; every press must be needed. Returns the last click it took (null: it
	 * didn't fit).
	 */
	function upside(i: number, at: PlayerState, h: number): number | null {
		const start = times[i];
		const longest = Math.min(1800 + preset.level * 900, sec.end - 1200 - start);
		let j = i;
		while (j + 1 < times.length && times[j + 1] - start <= longest) j++;
		if (j < i + 2) return null;
		const end = times[j];
		const x = at.x;
		const endX = world.xAt(end);
		if (endX + 8 > exitX) return null;
		// After turning back it falls to the ground: the clicks while it falls are left out
		let last = j;
		while (last + 1 < times.length && times[last + 1] < end + 700) last++;
		const cube = cubeAt(sec.speedIndex);
		const air = ((2 * cube.jump) / cube.gravity) * (sec.mini ? 0.8 : 1);
		const high = h + (sec.mini ? 3 : 4) + (preset.level >= 3 && rng() < 0.5 ? 1 : 0);
		const length = robot ? 160 : 90;
		const a = new Attempt(world, exitX);
		const presses: number[] = [];
		const portal = (px: number, gravity: 1 | -1) => {
			const p = { x: px, y: h + 2.5, gravity, x0: px - 0.6, x1: px + 0.6 };
			a.change(
				() => world.gravityPortals.add(p),
				() => world.gravityPortals.remove(p),
				px
			);
		};
		// In
		const inByOrb = preset.level >= 2 && rng() < 0.35;
		if (inByOrb) {
			a.orb('blue', half(x), h + box.h);
			presses.push(start);
		} else portal(x, -1);
		// The slab, from above where it turns to past where it turns back
		a.solid({ x0: Math.floor(x) + 1, x1: Math.ceil(endX) + 2, y0: high, y1: high + 1, style: 1 });
		// Out
		const outByOrb = preset.level >= 2 && rng() < 0.4;
		if (outByOrb) {
			a.orb('blue', half(endX), high - box.h);
			presses.push(end);
		} else portal(endX, 1);
		// Who doesn't turn around runs into these
		a.spikes(Math.ceil(x + 2), Math.floor(endX - 1), h, 1, 'small');
		const taps = () => presses.flatMap((t) => tap(t, length)).sort((p, q) => p.time - q.time);
		const withPlan = (inputs: InputEvent[]) => [...plan, ...inputs].sort((p, q) => p.time - q.time);
		// Upside down: jumps (down) over spikes hanging from the slab, on the clicks between
		let jumps = 0;
		for (const c of times.slice(i + 1, j)) {
			if (c + air * 1000 + 150 > end) break;
			const s = simulate(world, state, c, withPlan(taps()));
			if (s.dead || !s.grounded || s.gravity > 0 || Math.abs(s.y - (high - box.h)) > 0.05) continue;
			const mid = s.x + (speed * air) / 2;
			const count = !robot && preset.level >= 2 && rng() < 0.45 ? 2 : 1;
			const center = count % 2 ? Math.floor(mid) + 0.5 : Math.round(mid);
			for (let k = 0; k < count; k++)
				a.spike(center + k - (count - 1) / 2, high, -1, robot ? 'small' : 'spike');
			presses.push(c);
			presses.sort((p, q) => p - q);
			jumps++;
		}
		const until = end + 750;
		const shifted = (shift: (k: number) => number, hold: number) =>
			withPlan(presses.flatMap((t, k) => tap(t + shift(k), hold)));
		const variants = [
			withPlan(taps()),
			...[-tolerance, tolerance].flatMap((d) =>
				[length - 30, length + 80].map((l) => shifted(() => d, l))
			),
			...[1, 2, 3, 4, 5].map((seed) =>
				shifted((k) => Math.sin(seed * 12.9898 + k * 78.233) * tolerance * 0.75, length)
			)
		];
		// (never long without pressing in it, from the press before to the click after)
		const before = plan.reduce(
			(t, e) => (e.down && e.time < start ? Math.max(t, e.time) : t),
			-1e9
		);
		const marks = [
			Math.max(before, start - 1500),
			...presses,
			outByOrb ? end : (times[last + 1] ?? sec.end)
		].sort((p, q) => p - q);
		const ok =
			jumps > 0 &&
			marks.every((t, k) => k === 0 || t - marks[k - 1] <= 1700) &&
			a.legal() &&
			variants.every((inputs) => !simulate(world, state, until, inputs).dead);
		// Not without pressing, nor without turning around (the orb in)
		const needed =
			ok &&
			simulate(world, state, until + 1000, plan).dead &&
			(!inByOrb ||
				simulate(
					world,
					state,
					until + 1000,
					withPlan(presses.slice(1).flatMap((t) => tap(t, length)))
				).dead);
		if (!ok || !needed) {
			a.revert();
			return null;
		}
		plan.push(...taps());
		plan.sort((p, q) => p.time - q.time);
		used(ctx, inByOrb || outByOrb ? 'upside-orb' : 'upside-portal');
		return last;
	}

	// --- One jump ----------------------------------------------------------------------------

	/** Every press needed: without the jump, or without any of the orbs, it doesn't get through */
	function required(launch: Launch, chained: number[], nominal: InputEvent[], until: number) {
		if (launch.kind === 'pad') return true;
		if (!simulate(world, state, until, []).dead) return false;
		for (const t of chained) {
			const without = nominal.filter((e, k) => (e.down ? e.time : nominal[k - 1].time) !== t);
			if (!simulate(world, state, until, without).dead) return false;
		}
		return true;
	}

	function build(
		a: Attempt,
		layout: Layout,
		launch: Launch,
		chained: number[],
		nominal: InputEvent[],
		at: PlayerState,
		height: number,
		until: number,
		next: number
	): { platform: Solid | null; family: string } | null {
		const old = platform;
		const takeoff = at.x;
		const lateX = (speed * layout.late) / 1000;
		const earlyX = (speed * layout.early) / 1000;
		// The edge it jumps from: as late as the press may come, the cube still stands on it
		const edge = half(takeoff + lateX - box.w + 0.25);
		if (layout.cut) {
			if (!old || height <= 0 || edge <= old.x0 + 0.5) return null;
			const end = old.x1;
			a.change(
				() => (old.x1 = edge),
				() => (old.x1 = end)
			);
		}
		// How it takes off
		if (launch.kind === 'ring' && launch.ring) a.orb(launch.ring, half(takeoff), height + box.h);
		if (launch.kind === 'pad') a.pad('yellow', at.x + box.w + 0.42, height);
		if (launch.kind === 'dash') a.orb('dash', half(takeoff), height + box.h, 1);
		// The orbs in the air, on the notes after it, where the cube is then
		for (let k = 0; k < chained.length; k++) {
			const t = chained[k];
			const before = nominal.filter((e, n) => (e.down ? e.time : nominal[n - 1].time) < t);
			const there = simulate(world, state, t, before);
			if (there.dead || there.grounded) return null;
			const rising = there.vy * there.gravity > 0;
			const s = strength(t);
			const kind: OrbKind =
				there.y > 7
					? 'pink'
					: !rising && preset.level >= 3 && s > 0.85 && k === chained.length - 1 && rng() < 0.3
						? 'black'
						: s > 0.8 && preset.level >= 2
							? 'red'
							: s < 0.3
								? 'pink'
								: 'yellow';
			a.orb(kind, half(there.x + speed * 0.01), Math.round(there.y * 2) / 2);
		}
		// Where it comes down: the first time it falls through the landing height
		const trace: Point[] = [];
		simulate(world, state, Math.min(sec.end, until + 400), nominal, { trace });
		const lastPress = Math.max(nominal[0]?.time ?? at.time, ...chained);
		const fall = trace.find(
			(p, k) =>
				k > 0 &&
				p.time > lastPress + 70 &&
				p.y < trace[k - 1].y &&
				p.y - box.h <= layout.landing + 0.08 &&
				trace[k - 1].y - box.h >= layout.landing - 0.08
		);
		if (!fall) return null;
		const landX = fall.x;
		if (landX > world.xAt(next + 25) || landX + 2 > exitX) return null;
		let family = '';
		const tag = (name: string) =>
			launch.chain
				? `orbs${Math.min(launch.chain, 3)}:${name}`
				: launch.kind === 'jump'
					? name
					: `${launch.kind}:${name}`;

		if (layout.fill === 'block') {
			// A low block under the jump (the easy levels): over it, or onto it and off again
			const apex = trace.reduce((best, p) => (p.y > best.y ? p : best), trace[0]);
			const c = Math.floor(apex.x);
			a.solid({ x0: c - 0.5, x1: c + 1, y0: 0, y1: height + 1, style: 0 });
			return { platform: old, family: tag('block') };
		}

		const firstSpike = spikeAfter(takeoff + lateX + brush);
		// Lands on the surface it ran on, after the spikes on it
		if (!layout.cut && layout.landing === height) {
			const last = spikeBefore(landX - earlyX - brush);
			const count = Math.round(last - firstSpike) + 1;
			if (count < 1 || count > rowMost) return null;
			spikeRow(a, firstSpike, last, height, layout.fill, false);
			family =
				layout.fill === 'saw' && count >= 4
					? 'rowSaw'
					: count >= 3
						? 'row'
						: count === 2
							? 'double'
							: 'single';
			return { platform: old, family: tag(family) };
		}
		// Comes down on another height: where that starts, as early as the press may come
		const resume = half(landX - earlyX + 0.3);
		if (resume - (layout.cut ? edge : firstSpike) < 1) return null;
		let nextPlatform: Solid | null = null;
		if (layout.landing > 0) {
			if (!layout.cut && old) {
				// (up a step: the structure it ran on ends where the higher one starts)
				const end = old.x1;
				a.change(
					() => (old.x1 = resume),
					() => (old.x1 = end)
				);
			}
			nextPlatform = a.solid({
				x0: resume,
				x1: exitX,
				y0: sec.floor,
				y1: layout.landing,
				style: 0
			});
		}
		if (layout.cut) {
			// A pit: small spikes on its floor up to where it lands (or spikes on the ground it
			// comes down to, up to where the early landing still clears them)
			const from = Math.ceil(edge) + 0.5;
			const to =
				layout.landing > 0 ? spikeBefore(resume - 0.5) : spikeBefore(landX - earlyX - brush);
			if (to < from) return null;
			spikeRow(a, from, to, sec.floor, layout.fill, layout.landing > 0);
			family = layout.landing > height ? 'pitUp' : layout.landing < height ? 'pitDown' : 'gap';
		} else {
			const to = spikeBefore(resume - 0.5);
			if (to < firstSpike || Math.round(to - firstSpike) + 1 > rowMost) return null;
			spikeRow(a, firstSpike, to, height, layout.fill, false);
			family = 'stepUp';
		}
		if (layout.fill === 'saw') family += 'Saw';
		return { platform: nextPlatform, family: tag(family) };
	}

	/** Spikes from one place to another (x.5 places, a block apart), a saw in a long row */
	function spikeRow(
		a: Attempt,
		from: number,
		to: number,
		base: number,
		fill: Layout['fill'],
		pit: boolean
	) {
		const count = Math.round(to - from) + 1;
		if (fill === 'saw' && count >= 4) {
			a.spike(from, base, 1, pit || robot ? 'small' : 'spike');
			a.saw(half((from + to) / 2), base + 0.1, count >= 6 ? 1 : 0.8);
			a.spike(to, base, 1, pit || robot ? 'small' : 'spike');
			return;
		}
		for (let k = 0; k < count; k++) {
			const middle = k > 0 && k < count - 1;
			const small = pit || robot || (fill === 'small' && middle);
			a.spike(from + k, base, 1, small ? 'small' : 'spike');
		}
	}

	function strength(t: number) {
		return ctx.chart.sound?.hits
			? hitAt(ctx.chart.sound, t)
			: (notes.get(t)?.sound ?? 0) & 4
				? 1
				: (notes.get(t)?.volume ?? 0.5) * 0.8;
	}
}
