// The player's choice of the kinds of parts and where gravity turns around (modes.ts): the
// levels keep to it, and their best progress is kept apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/addons/dash/chart';
import { generateLevel } from '../../src/lib/addons/dash/generate';
import { allowedModes, modesMark } from '../../src/lib/addons/dash/modes';
import { bestKey, bestOfSet, saveBest } from '../../src/lib/addons/dash/game';
import { simulate, startState, type Mode } from '../../src/lib/addons/dash/physics';
import { makeOsu, makeSound } from './fixtures';

const song = {
	bpm: 140,
	length: 70,
	style: 'mixed' as const,
	kiai: [[35000, 60000]] as [number, number][]
};
const make = (difficulty: 'hard' | 'extreme', modes?: Mode[], gravity?: Mode[], seed = 'modes') => {
	const chart = parseChart(makeOsu(song))!;
	chart.sound = makeSound(song);
	return generateLevel(chart, { difficulty, seed, duration: 70000, modes, gravity });
};

test('the settings: the cube always, and a mark only for other settings than all', () => {
	assert.deepEqual(
		allowedModes({ off: ['cube', 'wave'], noGravity: [] }).modes.includes('cube'),
		true
	);
	assert.equal(allowedModes({ off: ['wave'], noGravity: [] }).modes.includes('wave'), false);
	assert.deepEqual(allowedModes({ off: [], noGravity: ['ship'] }).gravity.includes('ship'), false);
	assert.equal(modesMark({ off: [], noGravity: [] }), '');
	assert.notEqual(modesMark({ off: ['wave'], noGravity: [] }), '');
	assert.notEqual(
		modesMark({ off: ['wave'], noGravity: [] }),
		modesMark({ off: [], noGravity: ['wave'] })
	);
});

test('a kind of part turned off never comes up, and the level can still be finished', () => {
	for (const difficulty of ['hard', 'extreme'] as const) {
		const without = make(difficulty, ['cube', 'robot', 'ship', 'ball', 'ufo', 'swing', 'spider']);
		assert.ok(
			without.world.sections.every((s) => s.mode !== 'wave'),
			difficulty
		);
		assert.equal(
			simulate(without.world, startState(without.world, without.start), without.end, without.plan)
				.dead,
			false
		);
		const cube = make(difficulty, ['cube']);
		assert.ok(
			cube.world.sections.every((s) => s.mode === 'cube'),
			difficulty
		);
		assert.equal(
			simulate(cube.world, startState(cube.world, cube.start), cube.end, cube.plan).dead,
			false
		);
	}
});

test('gravity portals only in the kinds of parts they are on for', () => {
	const none = make('extreme', undefined, []);
	assert.deepEqual(
		none.world.gravityPortals.items.filter((g) => !g.sectionEntry),
		[],
		'no portals at all'
	);
	assert.ok(
		none.world.solids.items.every(
			(s) =>
				s.style !== 1 ||
				!['cube', 'robot'].includes(none.world.sectionAt(none.world.timeAt(s.x0)).mode)
		),
		'no cube upside down'
	);
	let portals = 0;
	for (const seed of ['modes', 'modes-2', 'modes-3']) {
		const onlyShip = make('extreme', undefined, ['ship'], seed);
		for (const g of onlyShip.world.gravityPortals.items.filter((g) => !g.sectionEntry))
			assert.equal(onlyShip.world.sectionAt(onlyShip.world.timeAt(g.x)).mode, 'ship');
		const all = make('extreme', undefined, undefined, seed);
		portals += all.world.gravityPortals.items.filter((g) => !g.sectionEntry).length;
	}
	assert.ok(portals > 0, 'with all on, portals come up');
});

test('the best progress of levels with other settings is kept apart', () => {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v)
	};
	const mark = modesMark({ off: ['wave'], noGravity: [] });
	saveBest(bestKey('77:1', 'hard', mark), 100, false, 3);
	saveBest(bestKey('77:1', 'hard'), 40, false, 9);
	assert.equal(bestOfSet(77, 'hard').normal, 40);
	assert.equal(bestOfSet(77, 'hard', mark).normal, 100);
	assert.equal(bestOfSet(77, 'hard', modesMark({ off: [], noGravity: ['ship'] })).normal, 0);
});
