// Makes a Dash level out of a beatmap. The song is cut into parts on its phrases, and each
// part gets a kind (cube, ship, ball, UFO, wave, swing, spider; some of them small) that
// fits its music: streams become wave turns, held notes ship flights, the kiai comes faster.
// The clicks are the notes that stand out most: on the strong beats, with the mapper's
// accents (a jump across the playfield, a louder hitsound) and on what's heard in the song
// (its hits, its loud parts: see audio.ts, where it could be heard). The parts are built by
// the builders (builders/*.ts) from the notes, and every obstacle is checked with the
// physics: the level is played on time, early and late, short and long presses, and what
// can't be passed is taken out again. So every level can be finished, and nowhere can it be
// played on for long without pressing.

import { beatAt, beatStrength, type DashChart, type DashNote } from './chart';
import {
	SPEEDS,
	STEP,
	World,
	copyState,
	cubeAt,
	hitbox,
	press,
	simulate,
	startState,
	type Hazard,
	type InputEvent,
	type Mode,
	type PlayerState,
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
import { heardAt, loudness } from './audio';
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

/** How much each note stands out beyond its beat and hitsounds (set by `accents`) */
const ACCENT = new WeakMap<DashNote, number>();

/**
 * The accents of the notes: a jump to it on the playfield, a louder hitsound, a hit heard in
 * the song there (most of all the kick). Around 0 on average, so the song's own level of
 * them doesn't change how many clicks there are, only which notes they are.
 */
function accents(chart: DashChart, notes: DashNote[], own: Set<DashNote>) {
	const sound = chart.sound;
	const raw = notes.map(
		(n) =>
			n.jump * 0.35 +
			n.volume * 0.3 +
			(sound ? heardAt(sound, n.time) * 0.8 + heardAt(sound, n.time, 'bass') * 0.35 : 0)
	);
	// (centred on the beatmap's own notes, not the beats added between them)
	let sum = 0;
	let count = 0;
	notes.forEach((n, i) => {
		if (!own.has(n)) return;
		sum += raw[i];
		count++;
	});
	const mean = sum / Math.max(1, count);
	notes.forEach((n, i) => ACCENT.set(n, raw[i] - mean));
}

function weight(chart: DashChart, note: DashNote) {
	let w = 0.55 + beatStrength(chart.timing, note.time) * 0.6;
	if (note.combo) w += 0.25;
	if (note.sound & 4) w += 0.45;
	if (note.sound & 8) w += 0.2;
	if (note.sound & 2) w += 0.1;
	if (note.kind !== 'circle') w += 0.1;
	if (inKiai(chart, note.time)) w += 0.1;
	return w + (ACCENT.get(note) ?? 0);
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
 * The notes, and in long stretches without any (an intro, a break, a held note) the beats
 * as notes too: those are still jumps on the music (in the beatmap's breaks every other one,
 * a calmer stretch but not an empty one). Where the song can be heard, only the beats with
 * something on them (not silence), and the off-beats where something hits.
 */
export function withBeats(chart: DashChart): DashNote[] {
	const notes = chart.notes;
	const sound = chart.sound;
	const from = notes[0].time;
	const to = Math.max(...notes.map((n) => n.end));
	const extra: DashNote[] = [];
	let k = 0;
	for (let i = 0; i < chart.timing.length; i++) {
		const point = chart.timing[i];
		const until = Math.min(chart.timing[i + 1]?.time ?? to, to);
		const firstBeat = Math.max(0, Math.ceil((from - point.time) / point.beatLength));
		for (let b = firstBeat * 2; ; b += 1) {
			const time = point.time + (b / 2) * point.beatLength;
			if (time >= until) break;
			const offBeat = b % 2 === 1;
			if (offBeat && (!sound || heardAt(sound, time) < 0.45)) continue;
			if (sound && heardAt(sound, time) < 0.08 && loudness(sound, time - 150, time + 150) < 0.06)
				continue;
			const resting = chart.breaks.some((br) => time > br.start - 500 && time < br.end + 300);
			if (resting && (offBeat || b % 4 !== 0)) continue;
			const near = point.beatLength * (offBeat ? 0.4 : 0.75);
			while (k < notes.length && notes[k].time < time - near) k++;
			if (k < notes.length && notes[k].time <= time + near) continue;
			// (nor inside a held note's start: its end is free)
			extra.push({
				time,
				end: time,
				kind: 'circle',
				height: 0.5,
				sound: 0,
				combo: false,
				jump: 0,
				volume: 0.6,
				sv: 1
			});
		}
	}
	return [...notes, ...extra].sort((a, b) => a.time - b.time);
}

/**
 * A map without kiai: its drops from the song itself, the stretches of four bars and more
 * as loud as its loudest parts
 */
function loudParts(chart: DashChart, start: number, end: number) {
	const sound = chart.sound;
	if (!sound) return [];
	const bars: { start: number; end: number; loud: number }[] = [];
	for (let i = 0; i < chart.timing.length; i++) {
		const point = chart.timing[i];
		const until = Math.min(chart.timing[i + 1]?.time ?? end, end);
		const bar = point.beatLength * point.meter;
		for (let t = point.time; t + bar <= until; t += bar)
			if (t >= start) bars.push({ start: t, end: t + bar, loud: loudness(sound, t, t + bar) });
	}
	if (bars.length < 8) return [];
	const sorted = bars.map((b) => b.loud).sort((a, b) => a - b);
	const threshold = Math.max(
		sorted[Math.floor(sorted.length * 0.7)],
		sorted[Math.floor(sorted.length * 0.92)] * 0.9
	);
	const parts: { start: number; end: number }[] = [];
	let run: { start: number; end: number; bars: number } | null = null;
	const close = () => {
		if (run && run.bars >= 4 && run.end - run.start >= 6000)
			parts.push({ start: run.start, end: run.end });
		run = null;
	};
	for (const b of bars) {
		if (b.loud < threshold) {
			close();
			continue;
		}
		if (run && Math.abs(run.end - b.start) < 5) {
			run.end = b.end;
			run.bars++;
		} else {
			close();
			run = { start: b.start, end: b.end, bars: 1 };
		}
	}
	close();
	return parts;
}

// --- The parts of the song ---------------------------------------------------------------

interface Part {
	start: number;
	end: number;
	mode: Mode;
	mini: boolean;
	kiai: boolean;
	/** Busier (and louder) than the song's middle (> 1) or calmer */
	energy: number;
	/** How much faster its sliders are than the song's usual (the mapper speeding it up) */
	drive: number;
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
	const sound = chart.sound;
	const meanLoud = sound ? Math.max(0.05, loudness(sound, start, end)) : 1;
	const svs = chart.notes.map((n) => n.sv).sort((a, b) => a - b);
	const usualSv = svs[svs.length >> 1] || 1;

	const parts: Part[] = [];
	const history: Mode[] = [];
	for (let i = 0; i < bounds.length - 1; i++) {
		const from = bounds[i];
		const to = bounds[i + 1];
		const notes = chart.notes.filter((n) => n.time >= from && n.time < to);
		const seconds = (to - from) / 1000;
		const kiai = inKiai(chart, (from + to) / 2);
		const density = notes.length / seconds / Math.max(0.1, meanDensity);
		// (as loud as it is busy: a loud part with few notes isn't calm)
		const energy = sound ? (density + loudness(sound, from, to) / meanLoud) / 2 : density;
		const partSv = notes.map((n) => n.sv).sort((a, b) => a - b);
		const drive = (partSv[partSv.length >> 1] ?? usualSv) / usualSv;
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
		parts.push({ start: from, end: to, mode, mini, kiai, energy, drive });
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
	const own = new Set(chart.notes);
	chart = { ...chart, notes: withBeats(chart) };
	const notes = chart.notes;
	accents(chart, notes, own);
	const first = notes[0].time;
	const lastEnd = Math.max(...notes.map((n) => n.end));
	const start = first > 2600 ? Math.round(first - 2000) : 0;
	const end = Math.min(
		options.duration > 0 ? options.duration - 100 : Infinity,
		Math.round(lastEnd + 1600)
	);
	// No kiai in the map: the song's loudest stretches are its drops
	if (!chart.kiai.length && chart.sound) chart = { ...chart, kiai: loudParts(chart, start, end) };
	const parts = planParts(chart, start, end, preset, rng);

	const world = new World();
	let x = 0;
	let palette = Math.floor(rng() * 8);
	parts.forEach((part, index) => {
		// Faster in the kiai (and where the mapper's sliders speed up), slower in calm parts
		let speedIndex = part.kiai || part.drive >= 1.3 ? preset.speeds[1] : preset.speeds[0];
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
		// (the steered parts are checked as a person steers them: see builders/flight.ts)
		if (sec.mode !== 'ship' && sec.mode !== 'wave' && sec.mode !== 'swing')
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
	requireInput(world, plan, start, end, preset);

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

/** How long the level may be played on without pressing (ms), by the kind of part */
const IDLE: Record<Mode, number> = {
	cube: 1600,
	ship: 1500,
	ball: 1300,
	ufo: 1300,
	wave: 1000,
	swing: 1300,
	spider: 1300
};

/**
 * Never long with nothing to do: where the level could be played on for a while without
 * pressing at all (an obstacle that was taken out again, a part drifting along its floor),
 * something on that way that only the planned presses get past: a spike on the surface it
 * would run along (or hang under), or, flying, a saw where it would drift. Played on time,
 * early and late, before it stays.
 */
function requireInput(
	world: World,
	plan: InputEvent[],
	start: number,
	end: number,
	preset: Preset
) {
	const EVERY = 250;
	const trace: { x: number; y: number; time: number }[] = [];
	simulate(world, startState(world, start), end, plan, { trace });
	// The planned run every quarter second, to start from there
	const states: PlayerState[] = [];
	let run = startState(world, start);
	for (let t = start; t <= end; t += EVERY) {
		run = simulate(world, run, t, plan);
		states.push(run);
	}
	const stateAt = (time: number) =>
		states[Math.max(0, Math.min(states.length - 1, Math.floor((time - start) / EVERY)))];
	/** Where the planned run is between two places: its lowest and highest middle */
	const planned = (x0: number, x1: number) => {
		let lo = 0;
		let hi = trace.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (trace[mid].x < x0) lo = mid + 1;
			else hi = mid;
		}
		let low = Infinity;
		let high = -Infinity;
		for (let i = lo; i < trace.length && trace[i].x <= x1; i++) {
			low = Math.min(low, trace[i].y);
			high = Math.max(high, trace[i].y);
		}
		return { low, high };
	};
	const steered = (mode: Mode) => mode === 'ship' || mode === 'wave' || mode === 'swing';
	// (not the swing: it turns around a moment late wherever it is, so only on its surfaces)
	const flying = (mode: Mode) => mode === 'ship' || mode === 'ufo';
	let seed = 1;
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	/**
	 * Whether the planned presses still get past it: on time, and (but steered) all early, all
	 * late, and each a bit early or late and held shorter or longer, as a person plays
	 */
	const passes = (hazard: Hazard, mode: Mode) => {
		if (hazard.kind !== 'saw' && !legalAround(world, hazard.x - 1.5, hazard.x + 1.5)) return false;
		const at = world.timeAt(hazard.x);
		const a = at - 1200;
		const b = at + 500;
		const from = stateAt(a - EVERY);
		const runs = [plan];
		const tolerance = preset.tolerance * 0.75;
		if (!steered(mode))
			for (let k = 0; k < 7; k++) {
				// (a press and its release move together)
				let shift = 0;
				let longer = 0;
				runs.push(
					plan
						.map((e) => {
							if (e.time < a || e.time > b) return e;
							if (e.down) {
								shift = k < 2 ? (k ? tolerance : -tolerance) : (rnd() * 2 - 1) * tolerance;
								longer = k < 2 ? 0 : (rnd() - 0.4) * 100;
							}
							return { ...e, time: e.time + shift + (e.down ? 0 : longer) };
						})
						.sort((p, q) => p.time - q.time)
				);
			}
		return runs.every((inputs) => !simulate(world, from, b + 400, inputs).dead);
	};

	const added: Hazard[] = [];
	for (let t = start + 1000; t < end - 1200; t += 500) {
		const sec = world.sectionAt(t);
		if (t < sec.start + 500) continue;
		const until = Math.min(t + IDLE[sec.mode], sec.end - 250);
		if (until - t < 900) continue;
		const idle = copyState(stateAt(t));
		if (idle.dead) break;
		press(idle, false);
		const path: { x: number; y: number; time: number }[] = [];
		if (simulate(world, idle, until, [], { trace: path }).dead) continue;

		// It got through without pressing: something on its way, where the planned run isn't
		const box = hitbox(sec.mode, sec.mini);
		const room = sec.mode === 'swing' ? 1.3 : steered(sec.mode) ? 0.9 : 0.25;
		let lastColumn = -Infinity;
		let fixed = false;
		for (const p of path) {
			if (fixed) break;
			const column = Math.floor(p.x);
			if (p.time < t + 200 || column === lastColumn || p.x > sec.x1 - 1.5) continue;
			lastColumn = column;
			// (where the planned run could touch it; played early and late below)
			const x = column + 0.5;
			const way = planned(x - box.w - 0.25, x + box.w + 0.25);
			if (!isFinite(way.low)) continue;
			const bottom = p.y - box.h;
			const top = p.y + box.h;
			const options: (() => Hazard | null)[] = [
				// On the surface it runs along (the planned run well above the spike)
				() =>
					world.surfaceAt(column + 0.05, column + 0.95, bottom, 1) &&
					way.low - box.h > bottom + 0.7 + room
						? world.spike(x, bottom, 1)
						: null,
				// Under the surface it slides along
				() =>
					world.surfaceAt(column + 0.05, column + 0.95, top, -1) &&
					way.high + box.h < top - 0.7 - room
						? world.spike(x, top, -1)
						: null,
				// Flying: a saw where it drifts
				() => {
					if (!flying(sec.mode)) return null;
					const reach = 0.6 * 0.72 + box.h + room + 0.2;
					if (way.low < p.y + reach && way.high > p.y - reach) return null;
					if (world.solidAt(x - 0.7, x + 0.7, p.y - 0.7, p.y + 0.7)) return null;
					if (world.hazards.near(x - 1.5, x + 1.5).length) return null;
					return world.saw(x, p.y, 0.6);
				}
			];
			for (const option of options) {
				const hazard = option();
				if (!hazard) continue;
				if (passes(hazard, sec.mode) && simulate(world, idle, until, []).dead) {
					added.push(hazard);
					fixed = true;
					break;
				}
				world.hazards.remove(hazard);
			}
		}
	}

	// Played through once more: what was added and stops it goes again
	for (let k = 0; k < 40 && added.length; k++) {
		const check = simulate(world, startState(world, start), end, plan);
		if (!check.dead) break;
		const near = added.filter((h) => Math.abs(h.x - check.x) < 2.5);
		if (!near.length) break;
		for (const h of near) {
			world.hazards.remove(h);
			added.splice(added.indexOf(h), 1);
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
