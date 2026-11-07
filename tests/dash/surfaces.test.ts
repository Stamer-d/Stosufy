// The ball and spider parts are clicked all through: from hard on there's no stretch where the
// music plays and nothing needs doing (the presses there are needed: without one it crashes),
// and they're clicked about as often as the cube. Their gravity turns by their presses, not by
// portals, and the ball's room is as tall as lets it switch on the beat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, type DashChart } from '../../src/lib/dash/chart';
import { generateLevel, type Difficulty, type Level } from '../../src/lib/dash/generate';
import { hearSong } from '../../src/lib/dash/audio';
import { musicalRest } from '../../src/lib/dash/composition';
import { simulate, startState, type PlayerState } from '../../src/lib/dash/physics';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

const SONGS: Record<string, SongOptions> = {
	mixed: { bpm: 128, length: 80, style: 'mixed', kiai: [[40000, 70000]] },
	fast: { bpm: 174, length: 70, style: 'intense', sliders: 6, kiai: [[25000, 55000]] }
};

const made = new Map<string, { level: Level; beat: number; chart: DashChart }>();
async function level(name: string, difficulty: Difficulty, seed: string) {
	const key = `${name}:${difficulty}:${seed}`;
	if (!made.has(key)) {
		const song = SONGS[name];
		const chart = parseChart(makeOsu(song))!;
		chart.sound = await hearSong(makeAudio(song).buffer);
		const level = generateLevel(chart, { difficulty, seed, duration: song.length * 1000 });
		made.set(key, { level, beat: 60000 / song.bpm, chart });
	}
	return made.get(key)!;
}

/** The presses it can't do without: each one left out (and its letting go), it crashes */
function needed(l: Level) {
	const w = l.world;
	const states: PlayerState[] = [];
	let s = startState(w, l.start);
	for (let time = l.start; time <= l.end; time += 250) {
		s = simulate(w, s, time, l.plan);
		states.push(s);
	}
	const out: number[] = [];
	l.plan.forEach((e, k) => {
		if (!e.down) return;
		const release = l.plan.findIndex((u, n) => n > k && !u.down);
		const inputs = l.plan.filter((_, n) => n !== k && n !== release);
		const from = states[Math.max(0, Math.floor((e.time - 300 - l.start) / 250))];
		if (simulate(w, from, Math.min(l.end, e.time + 2500), inputs).dead) out.push(e.time);
	});
	return out;
}

const SEEDS = ['a', 'b', 'c'];

test('from hard on the ball and spider never go long without a press that is needed', async () => {
	let time = 0;
	let idle = 0;
	let parts = 0;
	const worst: string[] = [];
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS) {
				const { level: l, beat, chart } = await level(name, difficulty, seed);
				const w = l.world;
				const need = needed(l);
				for (const sec of w.sections) {
					if (sec.mode !== 'ball' && sec.mode !== 'spider') continue;
					parts++;
					const pads = w.pads.items.map((p) => w.timeAt(p.x));
					const marks = [
						sec.start,
						...[...need, ...pads].filter((t) => t > sec.start && t < sec.end).sort((a, b) => a - b),
						sec.end
					];
					for (let i = 1; i < marks.length; i++) {
						// (where the music rests, nothing needs doing)
						let rest = 0;
						for (let t = marks[i - 1]; t < marks[i]; t += 50) if (musicalRest(chart, t)) rest += 50;
						const gap = marks[i] - marks[i - 1] - rest;
						time += gap;
						// (a stretch of more than two beats with nothing to do)
						if (gap > beat * 2.05) {
							idle += gap;
							worst.push(`${name} ${difficulty} ${seed} ${sec.mode}@${Math.round(marks[i - 1])}`);
						}
						assert.ok(
							gap <= beat * 4.05,
							`${name} ${difficulty} ${seed}: ${sec.mode} ${Math.round(marks[i - 1])}–${Math.round(marks[i])} ms with nothing to do`
						);
					}
				}
			}
	assert.ok(parts >= 8, `${parts} ball and spider parts`);
	// (an orb jump, a pad, the way into a part: now and then two beats or so; not more)
	assert.ok(idle / time < 0.12, `${((100 * idle) / time).toFixed(0)}% idle: ${worst.slice(0, 6)}`);
});

test('the ball and spider are clicked about as often as the cube on the hard levels', async () => {
	const rate = (modes: string[]) => {
		let presses = 0;
		let seconds = 0;
		for (const { level: l } of made.values()) {
			if (l.difficulty === 'normal') continue;
			for (const sec of l.world.sections) {
				if (!modes.includes(sec.mode)) continue;
				seconds += (sec.end - sec.start) / 1000;
				presses += l.plan.filter((e) => e.down && e.time >= sec.start && e.time < sec.end).length;
			}
		}
		return presses / seconds;
	};
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS) await level(name, difficulty, seed);
	const surfaces = rate(['ball', 'spider']);
	const cube = rate(['cube', 'robot']);
	assert.ok(
		surfaces >= cube * 0.9,
		`ball and spider ${surfaces.toFixed(2)}/s, cube ${cube.toFixed(2)}/s`
	);
});

test('from hard on the ball and spider turn gravity by their presses, not by portals', async () => {
	for (const name of Object.keys(SONGS))
		for (const seed of SEEDS) {
			const w = (await level(name, 'extreme', seed)).level.world;
			const portals = w.gravityPortals.items.filter(
				(g) => !g.sectionEntry && ['ball', 'spider'].includes(w.sectionAt(w.timeAt(g.x)).mode)
			);
			assert.equal(portals.length, 0, `${name} ${seed}`);
		}
});

test('the ball part is as tall as lets it switch on the beat, the spider part of varied heights', async () => {
	const spider = new Set<number>();
	for (const name of Object.keys(SONGS))
		for (const seed of SEEDS) {
			const { level: l } = await level(name, 'extreme', seed);
			for (const sec of l.world.sections) {
				if (sec.mode === 'spider') spider.add(sec.ceil!);
				if (sec.mode !== 'ball') continue;
				// (128 BPM: a beat of 469 ms takes the tallest room, 8, now and then 7; 174 BPM: 345 ms, 5)
				if (name === 'fast') assert.equal(sec.ceil, 5);
				else assert.ok(sec.ceil! >= 7 && sec.ceil! <= 8, `${sec.ceil}`);
			}
		}
	assert.ok(spider.size >= 2, `spider heights ${[...spider]}`);
});

test('musicalRest is still respected: no clicks are forced into the beatmap breaks', async () => {
	const song: SongOptions = { bpm: 140, length: 60, style: 'intense', breaks: [[25000, 33000]] };
	const chart = parseChart(makeOsu(song))!;
	chart.sound = await hearSong(makeAudio(song).buffer);
	const l = generateLevel(chart, { difficulty: 'extreme', seed: 'rest', duration: 60000 });
	const inBreak = l.plan.filter(
		(e) =>
			e.down &&
			musicalRest(chart, e.time) &&
			['ball', 'spider'].includes(l.world.sectionAt(e.time).mode)
	);
	assert.equal(inBreak.length, 0, inBreak.map((e) => Math.round(e.time)).join(', '));
});
