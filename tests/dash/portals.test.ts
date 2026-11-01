import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	STEP,
	copyState,
	startState,
	step,
	quantizeVelocity,
	cubeAt,
	type Mode
} from '../../src/lib/dash/physics';
import { world } from './worlds';

for (const mode of ['cube', 'robot', 'ship', 'ball', 'ufo', 'wave', 'swing', 'spider'] as Mode[]) {
	test(`section metadata alone does not change ${mode} player state`, () => {
		const plain = world({ mode });
		const split = world({ mode, length: 100 }, { mode });
		const s = startState(plain, 100 - STEP, 5);
		s.grounded = false;
		s.vy = 3;
		s.gravity = -1;
		s.held = true;
		s.buffered = false;
		s.switched = true;
		const other = copyState(s);
		const a = step(plain, s, 100);
		const b = step(split, other, 100);
		assert.deepEqual(b, a);
		assert.deepEqual({ ...other, section: 0 }, s);
	});
}

test('mini-only cube portal does not apply a second mode velocity conversion', () => {
	const w = world({ length: 100 }, { mini: true });
	const s = startState(w, 100 - STEP, 5);
	s.grounded = false;
	s.vy = 10;
	const events = step(w, s, 100);
	assert.equal(s.mini, true);
	assert.ok(events.includes('portal'));
	assert.ok(Math.abs(s.vy - quantizeVelocity(10 - (cubeAt(1).gravity * STEP) / 1000)) < 1e-9);
});

test('UFO does not manufacture a new press on a speed-only boundary', () => {
	const w = world({ mode: 'ufo', length: 100 }, { mode: 'ufo', speedIndex: 2 });
	const s = startState(w, 100 - STEP, 5);
	s.grounded = false;
	s.held = true;
	s.buffered = false;
	assert.ok(!step(w, s, 100).includes('jump'));
});

import { sectionPortals } from '../../src/lib/dash/portals';
import { DashGame } from '../../src/lib/dash/game';
import { levelOf } from './worlds';

test('portal cues use the actual activation plane, including both size directions', () => {
	const w = world(
		{ length: 100 },
		{ mini: true, speedIndex: 2, length: 100 },
		{ mini: false, length: 100 }
	);
	const a = sectionPortals(w.sections[0], w.sections[1], 3);
	assert.deepEqual(
		a.map((p) => p.kind),
		['size', 'speed']
	);
	assert.ok(a.every((p) => p.x === w.xAt(100)));
	const b = sectionPortals(w.sections[1], w.sections[2], 3);
	assert.ok(b.some((p) => p.kind === 'size' && p.mini === false));
	assert.ok(b.every((p) => p.x === w.xAt(200)));
});

test('size change is not rendered before its section activation time', () => {
	const w = world({ length: 100 }, { mini: true, length: 500 });
	const game = new DashGame(levelOf(w));
	game.begin();
	game.update(100.01);
	const view = game.view(100.02);
	assert.equal(view.mini, true);
	assert.ok(view.time >= 100);
	assert.equal(w.sectionAt(view.time).index, view.section);
});

test('mode portals preserve inverted gravity instead of silently inserting a gravity portal', () => {
	const w = world({ length: 100 }, { mode: 'ship' });
	const s = startState(w, 100, 5);
	s.section = 0;
	s.mode = 'cube';
	s.gravity = -1;
	s.vy = 3.6;
	s.grounded = false;
	step(w, s, 100);
	assert.equal(s.gravity, -1);
	assert.equal(s.vy, 1.8);
});

test('holding a consumed press across a UFO portal does not create a flap', () => {
	const w = world({ mode: 'ship', length: 100 }, { mode: 'ufo' });
	const s = startState(w, 100, 5);
	s.section = 0;
	s.mode = 'ship';
	s.held = true;
	s.buffered = false;
	assert.ok(!step(w, s, 100).includes('jump'));
});

test('a fresh press on the crossing tick still reaches swing', () => {
	const w = world({ length: 100 }, { mode: 'swing' });
	const s = startState(w, 100, 5);
	s.section = 0;
	s.mode = 'cube';
	s.grounded = false;
	s.held = true;
	s.buffered = true;
	assert.ok(step(w, s, 100).includes('jump'));
	assert.equal(s.gravity, -1);
});

test('native mode toggle damping is applied once on each entry/exit path', () => {
	const modes: Mode[] = ['cube', 'robot', 'ship', 'ball', 'ufo', 'wave', 'swing', 'spider'];
	const factors = [
		[1, 1, 0.5, 1, 0.5, 0.5, 0.5, 1],
		[1, 1, 0.5, 1, 0.5, 0.5, 0.5, 1],
		[0.5, 0.5, 1, 0.5, 0.25, 0.25, 0.25, 0.5],
		[1, 1, 0.5, 1, 0.5, 0.5, 0.5, 1],
		[0.5, 0.5, 0.25, 0.5, 1, 0.25, 0.25, 0.5],
		[0.5, 0.5, 0.25, 0.5, 0.25, 1, 0.25, 0.5],
		[0.5, 0.5, 0.25, 0.5, 0.25, 0.25, 1, 0.5],
		[1, 1, 0.5, 1, 0.5, 0.5, 0.5, 1]
	];
	for (let i = 0; i < modes.length; i++)
		for (let j = 0; j < modes.length; j++) {
			if (i === j || modes[j] === 'wave') continue; // Wave derives dy from horizontal speed, not stored vy.
			const w = world({ mode: modes[i], length: 100 }, { mode: modes[j] });
			const s = startState(w, 100, 5);
			s.section = 0;
			s.mode = modes[i];
			s.grounded = false;
			s.vy = 3.6;
			step(w, s, 100);
			assert.ok(Math.abs(s.vy - 3.6 * factors[i][j]) < 1e-9, `${modes[i]} -> ${modes[j]}: ${s.vy}`);
		}
});
