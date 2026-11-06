// How fast the parts of a level go: the speed changes where the music does (a new tempo, the
// kiai, a drop heard in the song even when the map's kiai is elsewhere), and stays where it
// doesn't (a song that stays the same stays at one speed, whatever the parts' ranks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/dash/chart';
import {
	generateLevel,
	musicalChanges,
	paces,
	type Difficulty,
	type Level
} from '../../src/lib/dash/generate';
import { hearSong } from '../../src/lib/dash/audio';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

const SONGS: Record<string, SongOptions> = {
	/** The same all through, no kiai */
	same: { bpm: 150, length: 100, style: 'intense' },
	/** Faster from 50 s on */
	faster: { bpm: 140, length: 100, style: 'calm', change: { at: 50000, bpm: 185 } },
	/** The same tempo and notes all through, the mapper's sliders faster from 49 s to 75 s */
	sliders: { bpm: 150, length: 100, style: 'intense', sv: [[49000, 75000, 1.4]] },
	/**
	 * Calm, a build-up from 37.8 s (a snare roll, no kick, streamed in the map: more notes than the
	 * drop), the drop at 50.6 s (kick, louder); the kiai only later
	 */
	buildup: {
		bpm: 150,
		length: 100,
		style: 'calm',
		buildup: [37800, 50600],
		drop: [50600, 77000],
		kiai: [[86000, 95000]]
	},
	/** Calm, then from the middle busy and loud; the map's kiai only near the end */
	drop: { bpm: 150, length: 100, style: 'mixed', kiai: [[82000, 94000]] }
};

const made = new Map<string, Level>();
async function level(name: string, difficulty: Difficulty) {
	const key = `${name}:${difficulty}`;
	if (!made.has(key)) {
		const song = SONGS[name];
		const chart = parseChart(makeOsu(song))!;
		chart.sound = await hearSong(makeAudio(song).buffer);
		made.set(
			key,
			generateLevel(chart, { difficulty, seed: 'speeds', duration: song.length * 1000 })
		);
	}
	return made.get(key)!;
}

/** The speed of the part at a time */
const speedAt = (l: Level, time: number) => l.world.sectionAt(time).speedIndex;

test('a part starts where the tempo changes, the kiai starts and the song drops', async () => {
	const faster = parseChart(makeOsu(SONGS.faster))!;
	faster.sound = await hearSong(makeAudio(SONGS.faster).buffer);
	const tempo = musicalChanges(faster, 0, 100000).filter((c) => c.kind === 'tempo');
	assert.deepEqual(
		tempo.map((c) => [c.time, c.up]),
		[[50000, true]]
	);

	const drop = parseChart(makeOsu(SONGS.drop))!;
	drop.sound = await hearSong(makeAudio(SONGS.drop).buffer);
	const changes = musicalChanges(drop, 0, 100000);
	// (the fixture's busy half starts at 50 s, in the middle of a bar)
	assert.ok(
		changes.some((c) => c.kind === 'energy' && c.up && Math.abs(c.time - 50000) < 1700),
		JSON.stringify(changes)
	);
	assert.ok(changes.some((c) => c.kind === 'kiai' && c.up && Math.abs(c.time - 82000) < 500));
	// (the same song all through: nothing changes, up to where it ends)
	const same = parseChart(makeOsu(SONGS.same))!;
	same.sound = await hearSong(makeAudio(SONGS.same).buffer);
	assert.deepEqual(
		musicalChanges(same, 0, 100000).filter((c) => c.kind === 'energy' && c.time < 94000),
		[]
	);
});

test('a song that stays the same stays at one speed', async () => {
	for (const difficulty of ['normal', 'hard', 'extreme'] as const) {
		const l = await level('same', difficulty);
		const speeds = new Set(l.world.sections.map((s) => s.speedIndex));
		assert.equal(
			speeds.size,
			1,
			`${difficulty}: ${l.world.sections.map((s) => `${s.mode}@${s.speedIndex}`).join(' ')}`
		);
	}
});

test('a faster tempo is faster, from the moment it starts', async () => {
	for (const difficulty of ['normal', 'hard'] as const) {
		const l = await level('faster', difficulty);
		const cut = l.world.sections.find((s) => Math.abs(s.start - 50000) < 5);
		assert.ok(cut, `${difficulty}: no part starts at the new tempo`);
		assert.ok(
			speedAt(l, 50500) > speedAt(l, 49500),
			`${difficulty}: ${speedAt(l, 49500)} → ${speedAt(l, 50500)}`
		);
		// (and it stays: the tempo doesn't come back down)
		for (const s of l.world.sections.filter((s) => s.start >= 50000))
			assert.ok(s.speedIndex >= speedAt(l, 50500), `${difficulty}: slower again at ${s.start}`);
	}
});

test('a drop heard in the song is faster, also where the map has its kiai elsewhere', async () => {
	for (const difficulty of ['normal', 'hard'] as const) {
		const l = await level('drop', difficulty);
		const cut = l.world.sections.find((s) => Math.abs(s.start - 50000) < 1700);
		assert.ok(cut, `${difficulty}: no part starts at the drop`);
		assert.ok(
			speedAt(l, cut.start + 100) > speedAt(l, cut.start - 100),
			`${difficulty}: ${speedAt(l, cut.start - 100)} → ${speedAt(l, cut.start + 100)}`
		);
		// (the busy half keeps its speed up to the kiai)
		for (const s of l.world.sections.filter((s) => s.start >= cut.start && s.end <= 82000))
			assert.equal(s.speedIndex, cut.speedIndex, `${difficulty}: changes at ${s.start}`);
	}
});

test('the pace only changes where the music does', () => {
	const part = (energy: number, more: Partial<Parameters<typeof paces>[0][number]> = {}) => ({
		energy,
		kiai: false,
		tempo: 1,
		drive: 1,
		change: false,
		drop: false,
		...more
	});
	// (ranks would make the busiest of these fast: they're all about the same)
	assert.deepEqual(
		paces([part(0.95), part(1.05), part(1.12), part(1.0), part(0.92)], 2),
		[1, 1, 1, 1, 1]
	);
	// Clearly busier from a change on: faster there, and it stays
	assert.deepEqual(
		paces([part(0.8), part(0.85), part(1.4, { change: true, drop: true }), part(1.3)], 2),
		[1, 1, 2, 2]
	);
	// The kiai, and a higher tempo
	assert.deepEqual(paces([part(1), part(1, { kiai: true }), part(1)], 2), [1, 2, 1]);
	assert.deepEqual(paces([part(1), part(1, { tempo: 1.3, change: true })], 2), [1, 2]);
	// Calm parts are slower, from normal on (easy keeps one speed)
	assert.deepEqual(paces([part(1), part(0.4, { change: true })], 2), [1, 0]);
	assert.deepEqual(paces([part(1), part(0.4, { change: true })], 0), [1, 1]);
	// The run-up to a faster drop isn't fast already
	assert.deepEqual(
		paces(
			[part(1), part(1.3, { change: true }), part(1.6, { change: true, drop: true, kiai: true })],
			2
		),
		[1, 1, 2]
	);
	// The mapper's faster sliders alone, where it's calm, aren't a reason
	assert.deepEqual(paces([part(1), part(0.8, { drive: 1.5, change: true })], 2), [1, 1]);
});

test("where the mapper's sliders speed up, at the same tempo, it goes faster", async () => {
	for (const difficulty of ['normal', 'hard'] as const) {
		const l = await level('sliders', difficulty);
		const cut = l.world.sections.find((s) => Math.abs(s.start - 49000) < 5);
		assert.ok(cut, `${difficulty}: no part starts where the sliders speed up`);
		assert.ok(
			speedAt(l, 49500) > speedAt(l, 48500),
			`${difficulty}: ${l.world.sections.map((s) => `${s.start}:${s.speedIndex}`).join(' ')}`
		);
		assert.ok(speedAt(l, 80000) < speedAt(l, 60000), `${difficulty}: not slower again after`);
	}
});

test('the drop after a build-up is faster, not the build-up with its stream', async () => {
	for (const difficulty of ['normal', 'hard'] as const) {
		const l = await level('buildup', difficulty);
		const shown = l.world.sections.map((s) => `${s.start}:${s.speedIndex}`).join(' ');
		assert.ok(
			l.world.sections.some((s) => Math.abs(s.start - 50600) < 5),
			`${difficulty}: no part starts at the drop: ${shown}`
		);
		assert.ok(speedAt(l, 51000) > speedAt(l, 50000), `${difficulty}: ${shown}`);
		assert.ok(speedAt(l, 45000) <= speedAt(l, 30000), `${difficulty}: the build-up: ${shown}`);
	}
});
