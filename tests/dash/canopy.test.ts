// What's built over the cube's and robot's way (builders/canopy.ts): there is something, the
// level plays as before, and nothing of it is where a jump goes. And a mapper's break the song
// plays on through isn't an empty stretch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/addons/dash/chart';
import { generateLevel, type Difficulty } from '../../src/lib/addons/dash/generate';
import { hearSong } from '../../src/lib/addons/dash/audio';
import { musicalRest } from '../../src/lib/addons/dash/composition';
import { simulate, startState } from '../../src/lib/addons/dash/physics';
import { checkLevel } from '../../src/lib/addons/dash/validate';
import { makeAudio, makeOsu, makeSound, type SongOptions } from './fixtures';

const SONG: SongOptions = { bpm: 128, length: 70, style: 'mixed', kiai: [[40000, 60000]] };

function level(difficulty: Difficulty, modes?: ('cube' | 'robot')[]) {
	const chart = parseChart(makeOsu(SONG))!;
	chart.sound = makeSound(SONG);
	return generateLevel(chart, { difficulty, seed: 'canopy', duration: SONG.length * 1000, modes });
}

test('over the cube and robot there are ceilings, and the level plays as planned', () => {
	for (const difficulty of ['normal', 'hard', 'extreme'] as const) {
		const made = level(difficulty, ['cube', 'robot']);
		const w = made.world;
		const trace: { x: number; y: number; time: number }[] = [];
		const run = simulate(w, startState(w, made.start), made.end, made.plan, { trace });
		assert.ok(!run.dead, `${difficulty}: the plan gets through`);
		// Blocks with nothing under them down to the ground, over the way
		const top = new Map<number, number>();
		for (const p of trace) top.set(Math.floor(p.x), Math.max(top.get(Math.floor(p.x)) ?? 0, p.y));
		const over = w.solids.items.filter((o) => {
			if (o.style !== 0 || o.y0 < 3) return false;
			for (let c = Math.floor(o.x0); c < o.x1; c++)
				if ((top.get(c) ?? Infinity) + 0.5 > o.y0) return false;
			return true;
		});
		assert.ok(over.length >= 4, `${difficulty}: ${over.length} blocks over the way`);
		const report = checkLevel(made);
		assert.ok(report.finishes, `${difficulty}: can be finished`);
	}
});

test("a mapper's break the song plays on through is no rest, a quiet one is", async () => {
	const options: SongOptions = { bpm: 128, length: 60, style: 'intense', breaks: [[20000, 30000]] };
	const loud = parseChart(makeOsu(options))!;
	// (the same song without the quiet stretch: it plays on through the map's break)
	loud.sound = await hearSong(makeAudio({ ...options, breaks: [] }).buffer);
	assert.ok(!musicalRest(loud, 25000));
	const quiet = parseChart(makeOsu(options))!;
	quiet.sound = await hearSong(makeAudio(options).buffer);
	assert.ok(musicalRest(quiet, 25000));
	const unheard = parseChart(makeOsu(options))!;
	assert.ok(musicalRest(unheard, 25000));
});
