// Makes a Dash level out of a beatmap. The song is cut into parts on its phrases, and each
// part gets a kind (cube, ship, ball, UFO, wave, swing, spider; some of them small) that
// fits its music: streams become wave turns, held notes ship flights, the kiai comes faster.
// The parts are built by the builders (builders/*.ts) from the notes, and every obstacle
// is checked with the physics: the level is played on time, early and late, short and long
// presses, and what can't be passed is taken out again. So every level can be finished.

import { beatAt, beatStrength, type DashChart, type DashNote } from './chart';
import {
	SPEEDS,
	STEP,
	World,
	cubeAt,
	hitbox,
	simulate,
	startState,
	type InputEvent,
	type Mode,
	type Portal,
	type Section
} from './physics';
import {
	DIFFICULTIES,
	PRESETS,
	hash,
	random,
	clamp,
	freshness,
	legalAround,
	type Context,
	type Difficulty,
	type Preset,
	type Random
} from './build';
import { buildCube } from './builders/cube';
import { buildFlight } from './builders/flight';
import { buildWave } from './builders/wave';

export { DIFFICULTIES, type Difficulty };

/** How tall the parts with a ceiling are (blocks) */
export const BOUNDS: Record<Exclude<Mode, 'cube'>, number> = {
	ship: 10,
	ufo: 10,
	wave: 10,
	swing: 10,
	ball: 8,
	spider: 9
};

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

// --- Which notes are clicks ---------------------------------------------------------------

export function inKiai(chart: DashChart, time: number) {
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
export function chooseClicks(chart: DashChart, notes: DashNote[], gap: number, cost: number) {
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
	// Never long without a click: in every stretch longer than that, the strongest note there
	const longest = Math.max(1100, gap * 2600);
	const filled: number[] = [];
	let k = 0;
	let last = -Infinity;
	for (let n0 = 0; n0 < n;) {
		const nextChosen = chosen[k] ?? Infinity;
		const windowEnd = (last === -Infinity ? notes[0].time - 1 : last) + longest;
		if (nextChosen <= windowEnd) {
			filled.push(nextChosen);
			last = nextChosen;
			k++;
			while (n0 < n && notes[n0].time <= last) n0++;
			continue;
		}
		// The strongest note in (last + gap, windowEnd], else the next one after
		let best = -1;
		let bestWeight = -Infinity;
		for (let m = n0; m < n && notes[m].time <= windowEnd; m++) {
			if (notes[m].time - last < gap * 1000) continue;
			const w = weight(chart, notes[m]);
			if (w > bestWeight) {
				bestWeight = w;
				best = m;
			}
		}
		if (best < 0) {
			while (n0 < n && notes[n0].time - last < gap * 1000) n0++;
			if (n0 >= n) break;
			best = n0;
		}
		const time = Math.min(notes[best].time, nextChosen);
		if (time === nextChosen) k++;
		filled.push(time);
		last = time;
		while (n0 < n && notes[n0].time <= last) n0++;
		while (k < chosen.length && chosen[k] - last < gap * 1000) k++;
	}
	return filled;
}

/**
 * The cube's clicks: the strongest notes a whole jump apart, so every jump lands on a note
 * that counts instead of on whichever comes when the cube happens to be down again. Where the
 * song has a strong note in the middle of a jump (and the next jump is far enough), that one
 * too: an orb takes it, and on the harder levels another one in that orb's jump, as many in a
 * row as the difficulty allows. The harder, the less strong such a note needs to be.
 */
function cubeClicks(chart: DashChart, notes: DashNote[], sec: Section, preset: Preset) {
	const cube = cubeAt(sec.speedIndex);
	const air = ((2 * cube.jump) / cube.gravity) * 1000;
	const jumps = chooseClicks(chart, notes, Math.max(preset.gap, air / 1000 + 0.04), preset.cost);
	if (preset.chain < 1) return jumps;
	const strong = [1.45, 1.35, 1.12, 1.0, 0.9][preset.level];
	const weightAt = new Map(notes.map((n) => [n.time, weight(chart, n)]));
	const clicks: number[] = [];
	let orbsBefore = 0;
	for (let k = 0; k < jumps.length; k++) {
		const time = jumps[k];
		clicks.push(time);
		let from = time;
		let orbs = 0;
		// On the easier levels not on two jumps in a row
		while (orbs < preset.chain && !(preset.level <= 1 && orbsBefore)) {
			const next = jumps[k + 1] ?? Infinity;
			const after = jumps[k + 2] ?? Infinity;
			let best: DashNote | null = null;
			let takesNext = false;
			for (const note of notes) {
				if (note.time <= from + 160 || note.time >= from + air - 50) continue;
				const w = weightAt.get(note.time) ?? 0;
				if (w < strong) continue;
				// After the orb it flies a whole jump again: the next jump only once it's down.
				// On the harder levels the orb may take the next jump's place instead (when its
				// note is as strong and the one after that is far enough).
				let instead = false;
				if (next - note.time < air + 60) {
					if (preset.level < 2 || after - note.time < air + 60) continue;
					if (w < (weightAt.get(next) ?? Infinity)) continue;
					instead = true;
				}
				if (!best || w > (weightAt.get(best.time) ?? 0)) {
					best = note;
					takesNext = instead;
				}
			}
			if (!best) break;
			if (takesNext) jumps.splice(k + 1, 1);
			clicks.push(best.time);
			from = best.time;
			orbs++;
		}
		orbsBefore = orbs;
	}
	return clicks;
}

/** Notes at least `gap` (s) apart, the stronger one of two close ones */
export function spaced(chart: DashChart, notes: DashNote[], gap: number) {
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
export function withBeats(chart: DashChart): DashNote[] {
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
			if (chart.breaks.some((br) => time > br.start - 500 && time < br.end + 300)) continue;
			const near = point.beatLength * 0.75;
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
	mini: boolean;
	kiai: boolean;
	/** Busier than the song's middle (> 1) or calmer */
	energy: number;
}

function planParts(
	chart: DashChart,
	start: number,
	end: number,
	preset: Preset,
	rng: Random
): Part[] {
	// Phrases: every few measures (about 10–20 s), and where the kiai starts and stops
	const cuts = new Set<number>();
	const timing = chart.timing;
	for (let i = 0; i < timing.length; i++) {
		const point = timing[i];
		const until = timing[i + 1]?.time ?? end;
		const measure = point.beatLength * point.meter;
		let measures = 8;
		while (measures * measure > 21000 && measures > 2) measures /= 2;
		while (measures * measure < 9000) measures *= 2;
		const first =
			point.time + Math.ceil((start - point.time) / (measure * measures)) * measure * measures;
		for (let t = Math.max(point.time, first); t < until; t += measure * measures)
			if (t > start + 4000 && t < end - 5000) cuts.add(Math.round(t));
	}
	const snap = (time: number) => {
		const { point } = beatAt(timing, time);
		const beats = Math.round((time - point.time) / point.beatLength);
		return Math.round(point.time + beats * point.beatLength);
	};
	const kiaiCuts = new Set<number>();
	for (const k of chart.kiai)
		for (const t of [k.start, k.end]) {
			const at = snap(t);
			if (at > start + 3000 && at < end - 4000) {
				cuts.add(at);
				kiaiCuts.add(at);
			}
		}
	const sorted = [...cuts].sort((a, b) => a - b);
	const kept: number[] = [];
	for (const cut of sorted) {
		const last = kept[kept.length - 1] ?? start;
		if (cut - last >= 7000) kept.push(cut);
		else if (kiaiCuts.has(cut) && !kiaiCuts.has(last) && kept.length) kept[kept.length - 1] = cut;
	}
	if (kept.length && end - kept[kept.length - 1] < 6000) kept.pop();
	const bounds = [start, ...kept, end];
	const meanDensity = chart.notes.length / Math.max(1, (end - start) / 1000);

	const parts: Part[] = [];
	const history: Mode[] = [];
	for (let i = 0; i < bounds.length - 1; i++) {
		const from = bounds[i];
		const to = bounds[i + 1];
		const notes = chart.notes.filter((n) => n.time >= from && n.time < to);
		const seconds = (to - from) / 1000;
		const kiai = inKiai(chart, (from + to) / 2);
		const energy = notes.length / seconds / Math.max(0.1, meanDensity);
		let stream = 0;
		for (let k = 1; k < notes.length; k++) {
			const beat = beatAt(timing, notes[k].time).point.beatLength;
			if (notes[k].time - notes[k - 1].time <= Math.max(130, beat / 4 + 12)) stream++;
		}
		const streamy = notes.length > 1 ? stream / (notes.length - 1) : 0;
		const held =
			notes.reduce((sum, n) => sum + (n.kind === 'circle' ? 0 : Math.min(n.end, to) - n.time), 0) /
			(to - from);
		const drop = kiaiCuts.has(from);
		const fits: Record<Mode, number> = {
			cube: 1.1 + (energy < 0.8 ? 0.3 : 0),
			ship: 0.45 + (held > 0.45 ? 1.3 : 0) + (energy < 0.6 ? 0.6 : 0),
			wave: preset.wave > 0 ? 0.12 + (streamy > 0.4 ? 1.8 : 0) : 0,
			ball: 0.6 + (streamy < 0.25 && energy > 0.7 ? 0.3 : 0),
			ufo: 0.55 + (streamy < 0.3 ? 0.2 : 0),
			swing: 0.45 + (kiai ? 0.4 : 0),
			spider: 0.3 + (streamy < 0.25 ? 0.15 : 0)
		};
		let mode: Mode = 'cube';
		if (i > 0) {
			const options = (preset.modes as Mode[]).map((m) => {
				let w = fits[m];
				// Not the same kind again and again, and at a drop something new
				const back = history.lastIndexOf(m);
				if (back >= 0) {
					const ago = history.length - back;
					w *= ago === 1 ? (m === 'cube' ? 0.5 : drop ? 0.05 : 0.25) : ago === 2 ? 0.6 : 0.9;
				}
				const share = history.filter((h) => h === m).length / Math.max(1, history.length);
				if (m === 'cube' && share < 0.35) w *= 1.8;
				if (m !== 'cube' && share > 0.3) w *= 0.4;
				return { m, w };
			});
			const total = options.reduce((s, o) => s + o.w, 0);
			let r = rng() * total;
			for (const o of options) {
				r -= o.w;
				if (r <= 0) {
					mode = o.m;
					break;
				}
			}
		}
		history.push(mode);
		const mini = i > 0 && mode !== 'ball' && rng() < preset.mini;
		parts.push({ start: from, end: to, mode, mini, kiai, energy });
	}
	// The end comes on the cube
	const last = parts[parts.length - 1];
	if (last.mode !== 'cube' && last.end - last.start > 11000) {
		const at = snap(last.end - 5000);
		if (at > last.start + 6000) {
			parts.push({ ...last, start: at, mode: 'cube', mini: false });
			last.end = at;
		}
	}
	return parts;
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
	let x = 0;
	let palette = Math.floor(rng() * 8);
	parts.forEach((part, index) => {
		// Faster in the kiai, slower in calm parts
		let speedIndex = part.kiai ? preset.speeds[1] : preset.speeds[0];
		if (!part.kiai && part.energy < 0.45 && preset.level >= 1)
			speedIndex = Math.max(0, speedIndex - 1);
		const speed = SPEEDS[speedIndex];
		world.segments.push({ time: part.start, x, speed });
		const x1 = x + ((part.end - part.start) / 1000) * speed;
		palette = (palette + 1 + Math.floor(rng() * 3)) % 8;
		world.sections.push({
			index,
			mode: part.mode,
			mini: part.mini,
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
	world.segments.push({ time: end, x, speed: world.sections[world.sections.length - 1].speed });

	const plan: InputEvent[] = [];
	const ctx: Context = { world, plan, rng, preset, chart, history: [], motifs: new Map() };
	let state = startState(world, start);
	const portals: Portal[] = [];
	for (const sec of world.sections) {
		state = simulate(world, state, sec.start + STEP, plan);
		const before = world.sections[sec.index - 1];
		if (before && (before.mode !== sec.mode || before.mini !== sec.mini))
			portals.push({
				kind: 'mode',
				mode: sec.mode,
				mini: sec.mini,
				x: sec.x0,
				y: state.y,
				x0: sec.x0 - 1,
				x1: sec.x0 + 1
			});
		if (before && before.speedIndex !== sec.speedIndex)
			portals.push({
				kind: 'speed',
				speedIndex: sec.speedIndex,
				x: sec.x0 - 1.5,
				y: state.y,
				x0: sec.x0 - 2.5,
				x1: sec.x0 - 0.5
			});
		const inside = notes.filter((n) => n.time >= sec.start && n.time < sec.end);
		const entry = state;
		if (sec.mode === 'cube') state = buildCube(ctx, sec, cubeClicks(chart, inside, sec, preset), state);
		else if (sec.mode === 'wave') state = buildWave(ctx, sec, inside, state);
		else {
			// The UFO and swing click often, the ball and spider like the cube
			const gap =
				sec.mode === 'ufo' || sec.mode === 'swing'
					? Math.max(preset.gap, 0.22)
					: sec.mode === 'spider'
						? Math.max(preset.gap, 0.42)
						: Math.max(preset.gap, 0.3);
			const theirs =
				sec.mode === 'ship' || sec.mode === 'swing'
					? []
					: chooseClicks(chart, inside, gap, preset.cost * 0.9);
			state = buildFlight(ctx, sec, inside, theirs, state);
		}
		plan.sort((a, b) => a.time - b.time);
		state = repair(world, plan, entry, sec);
		if (sec.mode !== 'ship' && sec.mode !== 'wave')
			fairness(world, plan, entry, sec, preset, options.seed);
		state = simulate(world, entry, sec.end, plan);
		// Never left dead for the parts after it: what's in the way goes, else the part is cleared
		for (let k = 0; k < 30 && state.dead; k++) {
			removeNear(world, state.x, sec.mode);
			state = simulate(world, entry, sec.end, plan);
		}
		if (state.dead) {
			const inside = (o: { x0: number; x1: number }) => o.x1 > sec.x0 && o.x0 < sec.x1;
			world.hazards.removeIf(inside);
			world.walls.removeIf(inside);
			world.solids.removeIf((o) => inside(o) && o.style !== 0);
			state = simulate(world, entry, sec.end, plan);
		}
		if (state.dead) state = { ...state, dead: false };
	}
	plan.sort((a, b) => a.time - b.time);

	// Played through once more: whatever still stops it goes
	for (let attempt = 0; attempt < 80; attempt++) {
		const run = simulate(world, startState(world, start), end, plan);
		if (!run.dead) break;
		removeNear(world, run.x, world.sectionAt(run.time).mode);
	}

	fillEmpty(world, plan, start, end, chart);

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
		clicks: plan.filter((e) => e.down && !['ship', 'swing'].includes(world.sectionAt(e.time).mode))
			.length,
		title: chart.title,
		artist: chart.artist,
		creator: chart.creator,
		version: chart.version
	};
}

/**
 * Never long without anything (but in the beatmap's breaks): where nothing is for a while,
 * spikes on the floor and ceiling of the part, far enough from the way through
 */
function fillEmpty(world: World, plan: InputEvent[], start: number, end: number, chart: DashChart) {
	const trace: { x: number; y: number; time: number }[] = [];
	simulate(world, startState(world, start), end, plan, { trace });
	const busy = (a: number, b: number) =>
		world.hazards.near(a, b).length +
		world.orbs.near(a, b).length +
		world.pads.near(a, b).length +
		world.walls.near(a, b).length +
		world.solids.near(a, b).filter((s) => s.x0 > a - 1 || s.style !== 0).length;
	const entries = new Map<number, ReturnType<typeof startState>>();
	const entryOf = (index: number) => {
		if (!entries.has(index))
			entries.set(
				index,
				simulate(world, startState(world, start), world.sections[index].start + STEP, plan)
			);
		return entries.get(index)!;
	};
	for (let t = start + 1500; t < end - 1500; t += 500) {
		if (chart.breaks.some((b) => t > b.start - 500 && t < b.end + 500)) continue;
		const sec = world.sectionAt(t);
		if (sec.ceil === null || t < sec.start + 800 || t > sec.end - 800) continue;
		const a = world.xAt(t);
		const b = world.xAt(t + 1500);
		if (busy(a, b)) continue;
		const box = hitbox(sec.mode, sec.mini);
		for (let x = Math.ceil(a); x + 1 <= b; x++) {
			let low = Infinity;
			let high = -Infinity;
			for (const p of trace) {
				if (Math.abs(p.x - (x + 0.5)) > box.w + 1) continue;
				low = Math.min(low, p.y - box.h);
				high = Math.max(high, p.y + box.h);
			}
			if (!isFinite(low)) continue;
			const added = [];
			if (low - sec.floor > 1.8) added.push(world.spike(x + 0.5, sec.floor, 1));
			if (sec.ceil - high > 1.8) added.push(world.spike(x + 0.5, sec.ceil, -1));
			if (!added.length) continue;
			const run = simulate(world, entryOf(sec.index), Math.min(sec.end, world.timeAt(x + 3)), plan);
			if (run.dead || !legalAround(world, x - 1, x + 2))
				for (const h of added) world.hazards.remove(h);
		}
	}
}

/** Takes out what's in the way at a place: spikes first, then the blocks of flying parts */
function removeNear(world: World, x: number, mode: Mode) {
	const near = (o: { x0: number; x1: number }) => o.x1 > x - 1.8 && o.x0 < x + 1.3;
	if (world.hazards.items.some(near)) world.hazards.removeIf(near);
	else if (world.solids.items.some((o) => near(o) && o.style === 2)) {
		// Blocks of a flying part: one lower (higher) just there, the rest stays
		const sec = world.sectionAt(world.timeAt(x));
		for (const o of world.solids.items.filter((o) => near(o) && o.style === 2)) {
			world.solids.remove(o);
			const cut0 = Math.max(o.x0, Math.floor(x - 1.8));
			const cut1 = Math.min(o.x1, Math.ceil(x + 1.3));
			if (cut0 > o.x0) world.solids.add({ ...o, x1: cut0 });
			if (cut1 < o.x1) world.solids.add({ ...o, x0: cut1 });
			const fromFloor = o.y0 <= sec.floor + 1e-6;
			const middle = fromFloor
				? { ...o, x0: cut0, x1: cut1, y1: o.y1 - 1 }
				: { ...o, x0: cut0, x1: cut1, y0: o.y0 + 1 };
			if (middle.y1 - middle.y0 >= 1) world.solids.add(middle);
		}
		world.solids.touch();
	} else if (world.solids.items.some((o) => near(o) && (o.style !== 0 || mode !== 'cube')))
		world.solids.removeIf((o) => near(o) && (o.style !== 0 || mode !== 'cube'));
	else if (world.walls.items.some(near)) world.walls.removeIf(near);
	else world.solids.removeIf(near);
	// What lost its surface goes too
	world.hazards.removeIf(
		(h) => near({ x0: h.x0 - 2, x1: h.x1 + 2 }) && !legalAround(world, h.x0, h.x1)
	);
}

/** A part that can't be played as planned: what stops it goes */
function repair(
	world: World,
	plan: InputEvent[],
	entry: ReturnType<typeof startState>,
	sec: World['sections'][number]
) {
	let state = simulate(world, entry, sec.end, plan);
	for (let k = 0; k < 40 && state.dead; k++) {
		removeNear(world, state.x, sec.mode);
		state = simulate(world, entry, sec.end, plan);
	}
	return state;
}

/**
 * Played like a person would: a bit early or late, short and long presses. Where that
 * keeps crashing, the obstacles go.
 */
function fairness(
	world: World,
	plan: InputEvent[],
	entry: ReturnType<typeof startState>,
	sec: World['sections'][number],
	preset: Preset,
	seed: string
) {
	const own = plan.filter((e) => e.time >= sec.start && e.time < sec.end);
	let s = hash(`${seed}:${sec.index}`) || 1;
	const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
	let clean = 0;
	for (let k = 0; k < 70 && clean < 10; k++) {
		const inputs: InputEvent[] = [];
		for (const e of own) {
			if (!e.down) continue;
			const at = e.time + (rnd() * 2 - 1) * preset.tolerance * 0.75;
			inputs.push({ time: at, down: true }, { time: at + 60 + rnd() * 110, down: false });
		}
		inputs.sort((a, b) => a.time - b.time);
		const run = simulate(world, entry, sec.end, inputs);
		if (!run.dead) {
			clean++;
			continue;
		}
		clean = 0;
		removeNear(world, run.x, sec.mode);
	}
}

void clamp;
void freshness;
void beatStrength;
