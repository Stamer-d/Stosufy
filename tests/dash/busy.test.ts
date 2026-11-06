// The intense parts of the hardest levels are busy like the song: the kinds change by phrase
// (every two or four bars), gravity turns on the bars and the song's accents, and pads take the
// beat by themselves. Each part its own kind or size, and the level can still be finished.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/dash/chart';
import { generateLevel, type Difficulty, type Level } from '../../src/lib/dash/generate';
import { hearSong } from '../../src/lib/dash/audio';
import { simulate, startState } from '../../src/lib/dash/physics';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

/** 174 BPM, intense all through, the kiai from 30 s to 75 s (a bar is 1.38 s) */
const SONG: SongOptions = {
	bpm: 174,
	length: 90,
	style: 'intense',
	sliders: 6,
	kiai: [[30000, 75000]]
};
const KIAI = SONG.kiai![0];

const made = new Map<string, Level>();
async function level(difficulty: Difficulty, seed: string) {
	const key = `${difficulty}:${seed}`;
	if (!made.has(key)) {
		const chart = parseChart(makeOsu(SONG))!;
		chart.sound = await hearSong(makeAudio(SONG).buffer);
		made.set(key, generateLevel(chart, { difficulty, seed, duration: 90000 }));
	}
	return made.get(key)!;
}
const inKiai = (l: Level) =>
	l.world.sections.filter((s) => s.end > KIAI[0] + 100 && s.start < KIAI[1] - 100);

test('on extreme the kind changes every few bars in the kiai, never the same part twice', async () => {
	for (const seed of ['a', 'b']) {
		const l = await level('extreme', seed);
		const parts = inKiai(l);
		const shown = parts.map((s) => `${s.start}:${s.mode}${s.mini ? '·' : ''}`).join(' ');
		// (45 s of kiai: four bars are 5.5 s)
		assert.ok(parts.length >= 7, `${seed}: ${shown}`);
		for (const s of parts.slice(1, -1)) assert.ok(s.end - s.start <= 6000, `${seed}: ${shown}`);
		for (let i = 1; i < parts.length; i++)
			assert.ok(
				parts[i].mode !== parts[i - 1].mode || parts[i].mini !== parts[i - 1].mini,
				`${seed}: the same part twice: ${shown}`
			);
		assert.equal(simulate(l.world, startState(l.world, l.start), l.end, l.plan).dead, false);
	}
});

test('on extreme gravity turns on the bars and accents of the kiai, and pads take beats', async () => {
	let portals = 0;
	let pads = 0;
	for (const seed of ['a', 'b']) {
		const w = (await level('extreme', seed)).world;
		const there = (x: number) => w.timeAt(x) >= KIAI[0] && w.timeAt(x) < KIAI[1];
		portals += w.gravityPortals.items.filter((g) => there(g.x)).length;
		pads += w.pads.items.filter((p) => there(p.x)).length;
	}
	// (two kiai of 45 s: about one turn every two bars, a pad now and then)
	assert.ok(portals >= 30, `${portals} gravity portals`);
	assert.ok(pads >= 4, `${pads} pads`);
});

test('the calmer difficulties keep their longer parts', async () => {
	const l = await level('normal', 'a');
	const parts = inKiai(l);
	assert.ok(parts.length <= 5, parts.map((s) => s.mode).join(' '));
});
