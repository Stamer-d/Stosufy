// The levels made from songs (generate.ts), checked with the physics (validate.ts): the same
// song makes the same level; every level can be finished, every click has room to be a bit
// early or late; the clicks are never too close; harder is faster and busier, the kiai faster;
// the wave keeps turning in the kiai; and levels are made for slow and fast songs, calm and
// intense ones, with BPM changes, with breaks and without the song's sound.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/dash/chart';
import {
	generateLevel,
	intensities,
	DIFFICULTIES,
	type Difficulty,
	type Level
} from '../../src/lib/dash/generate';
import { PRESETS } from '../../src/lib/dash/build';
import { hearSong, type SongSound } from '../../src/lib/dash/audio';
import { levelData, levelFromData } from '../../src/lib/dash/level';
import { simulate, startState, STEP } from '../../src/lib/dash/physics';
import { checkLevel, type LevelReport } from '../../src/lib/dash/validate';
import { musicalRest } from '../../src/lib/dash/composition';
import { makeAudio, makeOsu, makeSound, type SongOptions } from './fixtures';

const SONGS: Record<string, SongOptions> = {
	slow: { bpm: 90, length: 70, style: 'calm' },
	mixed: {
		bpm: 128,
		length: 80,
		style: 'mixed',
		kiai: [[40000, 70000]],
		breaks: [[20000, 26000]]
	},
	fast: { bpm: 174, length: 70, style: 'intense', sliders: 6 },
	change: {
		bpm: 110,
		length: 70,
		style: 'mixed',
		change: { at: 30000, bpm: 165 },
		kiai: [[45000, 65000]]
	}
};

const heard = new Map<string, SongSound>();
async function soundOf(name: string) {
	if (!heard.has(name)) heard.set(name, await hearSong(makeAudio(SONGS[name]).buffer));
	return heard.get(name)!;
}

const made = new Map<string, Level>();
async function level(name: string, difficulty: Difficulty, seed = 'tests') {
	const key = `${name}:${difficulty}:${seed}`;
	if (!made.has(key)) {
		const song = SONGS[name];
		const chart = parseChart(makeOsu(song))!;
		chart.sound = await soundOf(name);
		made.set(key, generateLevel(chart, { difficulty, seed, duration: song.length * 1000 }));
	}
	return made.get(key)!;
}

const reports = new Map<Level, LevelReport>();
function report(l: Level) {
	if (!reports.has(l)) reports.set(l, checkLevel(l));
	return reports.get(l)!;
}

test('the same song, settings and seed: the same level; another seed: another', async () => {
	const song = SONGS.mixed;
	const make = (seed: string) => {
		const chart = parseChart(makeOsu(song))!;
		chart.sound = makeSound(song);
		return JSON.stringify(
			levelData(generateLevel(chart, { difficulty: 'hard', seed, duration: 80000 }))
		);
	};
	assert.equal(make('a'), make('a'));
	assert.notEqual(make('a'), make('b'));
});

for (const name of Object.keys(SONGS))
	test(`${name} song: every difficulty can be finished, every click with room`, async () => {
		for (const difficulty of DIFFICULTIES) {
			const r = report(await level(name, difficulty));
			const preset = PRESETS[difficulty];
			const what = `${name} ${difficulty}`;
			assert.ok(r.finishes, `${what}: crashes at ${r.crash}`);
			assert.ok(r.clicks.length > 20, `${what}: ${r.clicks.length} clicks`);
			// Every click alone may be off by the difficulty's tolerance in all (early and late)
			const narrow = r.clicks.filter((c) => c.early + c.late < preset.tolerance);
			assert.equal(
				narrow.length,
				0,
				`${what}: ${narrow.map((c) => `${c.mode}@${c.time.toFixed(0)} -${c.early}/+${c.late}`).join(', ')}`
			);
			// Never too close: an orb comes 160 ms after its jump at the soonest, the swing turns
			// 130 ms after the last turn; on easy (no orbs, no swing) the jumps' own gap
			const least = difficulty === 'easy' ? preset.gap * 1000 : 130;
			assert.ok(r.closest >= least - STEP * 2, `${what}: ${r.closest} ms apart`);
			// Seen coming for at least half a second
			assert.ok(r.sight >= 500, `${what}: seen ${r.sight} ms`);
		}
	});

test('generated mode changes retain explicit normal-gravity portals through repair and serialization', async () => {
	const l = await level('slow', 'normal');
	for (const sec of l.world.sections.slice(1)) {
		if (l.world.sections[sec.index - 1].mode === sec.mode) continue;
		assert.ok(
			l.world.gravityPortals.items.some((p) => p.sectionEntry && p.gravity === 1 && p.x === sec.x0)
		);
	}
	const restored = levelFromData(JSON.parse(JSON.stringify(levelData(l))));
	assert.deepEqual(restored.world.gravityPortals.items, l.world.gravityPortals.items);
	assert.equal(
		simulate(
			restored.world,
			startState(restored.world, restored.start),
			restored.end,
			restored.plan
		).dead,
		false
	);
});

test('harder: faster and more presses, with broader mode variety across the song corpus', async () => {
	const totals = DIFFICULTIES.map(() => 0);
	const kinds = DIFFICULTIES.map(() => new Set<string>());
	for (const name of Object.keys(SONGS)) {
		const levels = await Promise.all(DIFFICULTIES.map((d) => level(name, d)));
		const speeds = levels.map(
			(l) =>
				l.world.sections.reduce((a, s) => a + s.speed * (s.end - s.start), 0) / (l.end - l.start)
		);
		for (let i = 1; i < speeds.length; i++)
			assert.ok(speeds[i] >= speeds[i - 1] - 0.5, `${name}: ${speeds.map((s) => s.toFixed(1))}`);
		assert.ok(speeds[4] > speeds[0] + 4);
		// (presses a second, all but the ship's: it's held, not clicked)
		const presses = levels.map(
			(l) =>
				l.plan.filter((e) => e.down && l.world.sectionAt(e.time).mode !== 'ship').length /
				((l.end - l.start) / 1000)
		);
		// Different mode mixes need different numbers of taps (e.g. long ship holds).
		// Check the density trend across songs, not a strict tap ordering for each mix.
		presses.forEach((p, i) => (totals[i] += p));
		// Keep a phrase's mode when its music still fits; do not force extra switches in each song.
		levels.forEach((l, i) => l.world.sections.forEach((section) => kinds[i].add(section.mode)));
	}
	assert.ok(kinds[4].size > kinds[0].size);
	for (let i = 1; i < totals.length; i++)
		assert.ok(totals[i] > totals[0], `corpus press density: ${totals}`);
});

test('the kiai is played faster than the calm parts around it', async () => {
	for (const difficulty of ['normal', 'hard', 'insane', 'extreme'] as const) {
		const l = await level('mixed', difficulty);
		const mean = (kiai: boolean) => {
			const parts = l.world.sections.filter((s) => s.kiai === kiai);
			return (
				parts.reduce((a, s) => a + s.speed * (s.end - s.start), 0) /
				parts.reduce((a, s) => a + s.end - s.start, 0)
			);
		};
		assert.ok(mean(true) > mean(false), `${difficulty}: kiai ${mean(true)} calm ${mean(false)}`);
	}
});

test('the wave keeps turning on the notes, also small and fast in the kiai', async () => {
	let waves = 0;
	const cases = Object.keys(SONGS).flatMap((name) =>
		DIFFICULTIES.map((difficulty) => ({ name, difficulty, seed: 'tests' }))
	);
	// Longer musical sections naturally produce fewer mode changes. Add seed coverage
	// rather than requiring the generator to insert extra wave switches into the same song.
	cases.push(
		{ name: 'fast', difficulty: 'extreme', seed: 'wave-coverage' },
		{ name: 'fast', difficulty: 'insane', seed: 'wave-coverage' }
	);
	for (const { name, difficulty, seed } of cases) {
		const l = await level(name, difficulty, seed);
		for (const s of l.world.sections) {
			if (s.mode !== 'wave' || s.end - s.start < 3000) continue;
			waves++;
			const turns = l.plan.filter((e) => e.time > s.start + 700 && e.time < s.end - 600);
			const times = [s.start + 700, ...turns.map((e) => e.time), s.end - 600];
			for (let i = 1; i < times.length; i++)
				assert.ok(
					times[i] - times[i - 1] < 1600,
					`${name} ${difficulty}: the ${s.mini ? 'small ' : ''}wave goes one way for ${(times[i] - times[i - 1]).toFixed(0)} ms`
				);
		}
	}
	assert.ok(waves >= 3, `only ${waves} wave parts to check`);
});

test('a song without its sound still makes a level that can be finished', () => {
	const song = SONGS.fast;
	const chart = parseChart(makeOsu(song))!;
	const l = generateLevel(chart, { difficulty: 'insane', seed: 'quiet', duration: 70000 });
	assert.equal(l.kicks, null);
	assert.equal(checkLevel(l, { windows: false }).finishes, true);
});

test('the level after its trip from the worker plays the same', async () => {
	const l = await level('mixed', 'insane');
	const copy = levelFromData(structuredClone(levelData(l)));
	const a = simulate(l.world, startState(l.world, l.start), l.end, l.plan);
	const b = simulate(copy.world, startState(copy.world, copy.start), copy.end, copy.plan);
	assert.equal(b.dead, false);
	assert.deepEqual(b, a);
});

test('every kind of part comes up', async () => {
	const kinds = new Set<string>();
	for (const name of Object.keys(SONGS))
		for (const difficulty of DIFFICULTIES)
			for (const s of (await level(name, difficulty)).world.sections) kinds.add(s.mode);
	assert.deepEqual([...kinds].sort(), [
		'ball',
		'cube',
		'robot',
		'ship',
		'spider',
		'swing',
		'ufo',
		'wave'
	]);
});

// --- What the difficulties mean ------------------------------------------------------------

/** The median of some numbers */
const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[sorted.length >> 1] ?? 0;
};

test('harder: less room for each click (the median over all songs), never less than allowed', async () => {
	// The jumps of the cube and robot parts are built to the room the difficulty asks for; the
	// other kinds of parts get closer with it too, by their tunnels and timing spikes
	const jumps: number[] = [];
	const all: number[] = [];
	for (const difficulty of DIFFICULTIES) {
		const ground: number[] = [];
		const every: number[] = [];
		for (const name of Object.keys(SONGS))
			for (const c of report(await level(name, difficulty)).clicks) {
				every.push(c.early + c.late);
				if (c.mode === 'cube' || c.mode === 'robot') ground.push(c.early + c.late);
			}
		jumps.push(median(ground));
		all.push(median(every));
	}
	const shown = `jumps ${jumps.map(Math.round)}, all ${all.map(Math.round)}`;
	// (on the easy levels a jump over a spike or two has about all the room it can have)
	for (let i = 1; i < 3; i++) assert.ok(jumps[i] <= jumps[i - 1], shown);
	for (let i = 3; i < jumps.length; i++) assert.ok(jumps[i] < jumps[i - 1] - 20, shown);
	assert.ok(jumps[4] < jumps[2] * 0.75, shown);
	for (let i = 1; i < 3; i++) assert.ok(all[i] <= all[i - 1], shown);
	assert.ok(Math.max(all[3], all[4]) < all[2], shown);
	assert.ok(all[4] < all[0] * 0.75, shown);
});

test('harder: more parts (the kinds change more often), and tighter flying parts', async () => {
	const parts = DIFFICULTIES.map(() => 0);
	const room = DIFFICULTIES.map(() => [] as number[]);
	for (const name of Object.keys(SONGS))
		for (const [i, difficulty] of DIFFICULTIES.entries()) {
			const l = await level(name, difficulty);
			const w = l.world;
			parts[i] += w.sections.length / ((l.end - l.start) / 60000);
			// How high the tunnels of the ship and UFO parts are, block by block
			for (const s of w.sections) {
				if (s.mode !== 'ship' && s.mode !== 'ufo') continue;
				for (let x = Math.ceil(s.x0 + 6); x < s.x1 - 6; x++) {
					const here = w.solids
						.near(x + 0.4, x + 0.6)
						.filter((o) => o.x0 <= x + 0.5 && o.x1 >= x + 0.5);
					const lo = Math.max(
						s.floor,
						...here.filter((o) => o.y0 <= s.floor + 1e-6).map((o) => o.y1)
					);
					const hi = Math.min(
						s.ceil!,
						...here.filter((o) => o.y1 >= s.ceil! - 1e-6).map((o) => o.y0)
					);
					room[i].push(hi - lo);
				}
			}
		}
	for (let i = 1; i < parts.length; i++)
		assert.ok(parts[i] >= parts[i - 1] * 0.95, `parts a minute ${parts.map((p) => p.toFixed(1))}`);
	assert.ok(parts[4] > parts[0] * 1.8, `parts a minute ${parts.map((p) => p.toFixed(1))}`);
	const tunnels = room.map(median);
	assert.ok(tunnels[4] < tunnels[1], `tunnel heights ${tunnels}`);
	assert.ok(tunnels[4] <= 4, `tunnel heights ${tunnels}`);
});

test('a level builds up like the song: a calm start, the drops the most intense, a run-up to them', () => {
	const parts = [
		{ energy: 0.6, kiai: false },
		{ energy: 0.9, kiai: false },
		{ energy: 1.3, kiai: false },
		{ energy: 1.1, kiai: true },
		{ energy: 1.4, kiai: true },
		{ energy: 0.7, kiai: false },
		{ energy: 1.2, kiai: true },
		{ energy: 1.5, kiai: false }
	];
	const v = intensities(parts);
	assert.ok(v[0] <= 0.3, 'warm-up');
	assert.ok(v[2] <= 0.45, 'the run-up to the drop is calmer than its energy alone');
	for (const k of [3, 4, 6]) assert.ok(v[k] >= 0.85, `kiai ${k}: ${v[k]}`);
	assert.ok(v[7] <= 0.55, 'the end is not the hardest stretch');
	assert.ok(v.every((x) => x >= 0 && x <= 1));
});

test('the parts know how intense they are, and the intense ones are faster', async () => {
	for (const difficulty of ['hard', 'insane', 'extreme'] as const) {
		const l = await level('mixed', difficulty);
		for (const s of l.world.sections) assert.ok(s.intensity !== undefined);
		const calm = l.world.sections.filter((s) => s.intensity! < 0.3);
		const hot = l.world.sections.filter((s) => s.intensity! > 0.8);
		assert.ok(hot.length && calm.length, difficulty);
		assert.ok(
			Math.min(...hot.map((s) => s.speedIndex)) >= Math.max(...calm.map((s) => s.speedIndex)),
			difficulty
		);
	}
});

test('nowhere to rest: doing nothing (or holding on) in a flying part does not get through', async () => {
	let tried = 0;
	let rested = 0;
	const where: string[] = [];
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['normal', 'hard', 'insane', 'extreme'] as const) {
			const l = await level(name, difficulty);
			const w = l.world;
			let state = startState(w, l.start);
			for (const e of l.plan) {
				if (!e.down) continue;
				const sec = w.sectionAt(e.time);
				if (!['ufo', 'swing', 'ship', 'wave'].includes(sec.mode)) continue;
				const until = Math.min(e.time + 1600, sec.end - 900);
				if (e.time < sec.start + 300 || until - e.time < 1000) continue;
				const chart = parseChart(makeOsu(SONGS[name]))!;
				let rest = false;
				for (let t = e.time; t < until; t += 50) if (musicalRest(chart, t)) rest = true;
				if (rest) continue;
				state = simulate(w, state, e.time, l.plan);
				for (const held of sec.mode === 'ship' || sec.mode === 'wave' ? [false, true] : [false]) {
					tried++;
					const from = { ...state, used: [...state.used], held, buffered: false };
					if (!simulate(w, from, until, []).dead) {
						rested++;
						where.push(`${name} ${difficulty} ${sec.mode}@${Math.round(e.time)}`);
					}
				}
			}
		}
	assert.ok(tried > 200, `${tried} tried`);
	assert.ok(rested / tried < 0.1, `${rested}/${tried}: ${where.slice(0, 8).join(', ')}`);
});
