// The ball, spider, UFO and swing parts built from their presses on the music
// (builders/rooms.ts): the UFO's and the swing's presses are on the beat grid, every one of
// them; the ball and the spider go from platform to platform, each press needed, with spikes
// right where a platform ends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/dash/chart';
import { generateLevel, type Level } from '../../src/lib/dash/generate';
import { hearSong } from '../../src/lib/dash/audio';
import { simulate, startState, type Mode } from '../../src/lib/dash/physics';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

const SONG: SongOptions = { bpm: 150, length: 70, style: 'mixed', kiai: [[40000, 60000]] };
const BEAT = 60000 / SONG.bpm;

const made = new Map<string, Level>();
async function level(modes: Mode[], difficulty: 'normal' | 'hard' | 'extreme') {
	const key = `${modes}:${difficulty}`;
	if (!made.has(key)) {
		const chart = parseChart(makeOsu(SONG))!;
		chart.sound = await hearSong(makeAudio(SONG).buffer);
		made.set(
			key,
			generateLevel(chart, { difficulty, seed: 'rooms', duration: SONG.length * 1000, modes })
		);
	}
	return made.get(key)!;
}

test('the UFO and the swing are pressed on the beat grid only, and get through', async () => {
	for (const difficulty of ['normal', 'hard', 'extreme'] as const) {
		const l = await level(['cube', 'ufo', 'swing'], difficulty);
		const w = l.world;
		assert.ok(!simulate(w, startState(w, l.start), l.end, l.plan).dead, difficulty);
		const presses = l.plan.filter(
			(e) => e.down && ['ufo', 'swing'].includes(w.sectionAt(e.time).mode)
		);
		assert.ok(presses.length > 20, `${difficulty}: ${presses.length} presses`);
		// (the song's beats are at 1000 ms + k beats, moved by what the level found it off by)
		const off = presses.filter((e) => {
			const quarters = (e.time - 1000 - (l.offset ?? 0)) / (BEAT / 4);
			return Math.abs(quarters - Math.round(quarters)) * (BEAT / 4) > 6;
		});
		assert.equal(off.length, 0, `${difficulty}: ${off.length} of ${presses.length} off the grid`);
		// (and most of them on the beats and their halves, not between)
		const halves = presses.filter((e) => {
			const h = (e.time - 1000 - (l.offset ?? 0)) / (BEAT / 2);
			return Math.abs(h - Math.round(h)) * (BEAT / 2) <= 6;
		});
		assert.ok(halves.length >= presses.length * 0.85, `${difficulty}: ${halves.length} on halves`);
	}
});

test('the ball and the spider go from platform to platform: spikes right where one ends', async () => {
	for (const difficulty of ['normal', 'hard', 'extreme'] as const) {
		const l = await level(['cube', 'ball', 'spider'], difficulty);
		const w = l.world;
		assert.ok(!simulate(w, startState(w, l.start), l.end, l.plan).dead, difficulty);
		let presses = 0;
		let needed = 0;
		l.plan.forEach((e, k) => {
			if (!e.down || !['ball', 'spider'].includes(w.sectionAt(e.time).mode)) return;
			presses++;
			// (left out, with its letting go: it crashes within a second and a half)
			const release = l.plan.findIndex((u, n) => n > k && !u.down);
			const inputs = l.plan.filter((_, n) => n !== k && n !== release);
			const from = simulate(w, startState(w, l.start), e.time - 300, l.plan);
			if (simulate(w, from, Math.min(l.end, e.time + 1500), inputs).dead) needed++;
		});
		assert.ok(presses > 15, `${difficulty}: ${presses} presses`);
		assert.ok(needed >= presses * 0.9, `${difficulty}: ${needed} of ${presses} presses needed`);
	}
});
