// Frozen static-reference cases for the locally analyzed GD 2.2091-compatible EXE.
// SHA-256 and REA evidence IDs: docs/rea-status.md. These are derived from disassembly,
// NOT recordings of the running original game. Do not regenerate from production constants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	STEP,
	cubeAt,
	press,
	startState,
	step,
	quantizeVelocity
} from '../../src/lib/dash/physics';
import { world } from './worlds';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('REA: cube moves on the very tick of its press, at every speed', () => {
	// updateTimeMod -> float jump -> setYVelocity (.001) -> dy = v * .225; 30 units/block.
	const impulses = [19.116, 20.124, 20.556, 20.214, 20.214];
	const rises = [0.07965, 0.08385, 0.08565, 0.084225, 0.084225];
	for (let i = 0; i < 5; i++) {
		const w = world({ speedIndex: i });
		const s = startState(w, 0);
		press(s, true);
		step(w, s, STEP);
		near(s.vy, impulses[i]);
		near(s.y, 0.5 + rises[i]);
	}
});

test('REA: fixed normal cube launch trace, independent of production gravity', () => {
	const w = world();
	const s = startState(w, 0);
	press(s, true);
	const trace = [
		[0.58385, 20.124],
		[0.66608, 19.7352],
		[0.74669, 19.3464],
		[0.82568, 18.9576]
	];
	for (let i = 0; i < trace.length; i++) {
		step(w, s, (i + 1) * STEP);
		near(s.y, trace[i][0]);
		near(s.vy, trace[i][1]);
	}
});

test('REA: mini cube keeps gravity but launches with .8 of the impulse', () => {
	const w = world({ mini: true });
	const s = startState(w, 0);
	press(s, true);
	step(w, s, STEP);
	near(s.y, 0.36708);
	near(s.vy, 16.0992);
	step(w, s, 2 * STEP);
	near(s.y, 0.43254);
	near(s.vy, 15.7104);
});

test('REA: falling velocity is updated before displacement', () => {
	const w = world();
	const s = startState(w, 0, 5);
	s.grounded = false;
	step(w, s, STEP);
	near(s.vy, -0.3888);
	near(s.y, 4.99838);
	step(w, s, 2 * STEP);
	near(s.vy, -0.7776);
	near(s.y, 4.99514);
});

test('REA: velocity quantization uses symmetric half-away-from-zero rounding', () => {
	near(quantizeVelocity(0.0625 * 1.8), 0.063 * 1.8);
	near(quantizeVelocity(-0.0625 * 1.8), -0.063 * 1.8);
	near(quantizeVelocity(20.12399), 20.124);
});

test('REA: red cube orb uses 1.38 and the native velocity grid', () => {
	const w = world();
	const s = startState(w, 0, 3);
	s.grounded = false;
	const x = w.xAt(STEP);
	w.orbs.add({ id: 1, kind: 'red', x, y: 3, x0: x - 0.6, x1: x + 0.6 });
	press(s, true);
	assert.ok(step(w, s, STEP).includes('orb'));
	near(s.vy, 27.7704);
});

// Frozen conversions of the native doubles, not calculated from production settings.
test('REA: gravity uses the observed speed-specific native constants', () => {
	const expected = [91.3873428, 93.13694515228272, 93.0397428, 93.4285428, 93.4285428];
	expected.forEach((g, i) => near(cubeAt(i).gravity, g));
});
