import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeAt, press, step, STEP, startState, type OrbKind } from '../../src/lib/dash/physics';
import { world } from './worlds';
import { robotStep } from '../../src/lib/dash/native-robot';
import { orbVelocity } from '../../src/lib/dash/native-orbs';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('REA Robot orb dispatch uses its own yellow and red factors', () => {
	near(orbVelocity('robot', 'yellow', false, 1, 20.1240572), 18.1116);
	near(orbVelocity('robot', 'red', false, 1, 20.1240572), 25.758);
	near(orbVelocity('robot', 'pink', false, 1, 20.1240572), 14.49);
});
test('REA Robot launches with half the native cube impulse and mini .8 scaling', () => {
	for (const [mini, expected] of [
		[false, 10.062],
		[true, 8.0496]
	] as const) {
		const w = world({ mode: 'robot', mini }),
			s = startState(w, 0);
		press(s, true);
		assert.ok(step(w, s, STEP).includes('jump'));
		near(s.vy, expected);
	}
});

test('REA Robot holding uses the bounded native charge; release permanently ends the boost', () => {
	const c = cubeAt(1);
	let i = {
		vy: 0,
		gravity: 1 as const,
		mini: false,
		grounded: true,
		held: true,
		buffered: true,
		active: false,
		released: true,
		charge: 1.5
	};
	let out = robotStep(i, c, 1 / 240);
	near(out.vy, 10.062);
	i = { ...i, ...out, grounded: false, buffered: false };
	out = robotStep(i, c, 1 / 240);
	near(out.vy, 10.062);
	out = robotStep({ ...i, ...out, held: false, released: true }, c, 1 / 240);
	near(out.vy, 9.7128);
	const next = robotStep({ ...i, ...out, held: true }, c, 1 / 240);
	assert.ok(next.vy < out.vy);
	let state = { ...i, vy: 10.062, charge: 0, active: true, released: false };
	for (let k = 0; k < 67; k++) {
		const r = robotStep(state, c, 1 / 240);
		state = { ...state, ...r };
	}
	near(state.vy, 10.062);
	assert.ok(state.charge >= 1.5);
	assert.ok(robotStep(state, c, 1 / 240).vy < state.vy);
});

test('Robot hold height varies, and holding through landing does not auto-jump', () => {
	const jump = (hold: number) => {
		const w = world({ mode: 'robot' }),
			s = startState(w, 0);
		press(s, true);
		let top = s.y,
			jumps = 0;
		for (let k = 1; k < 480; k++) {
			if (k * STEP > hold) press(s, false);
			jumps += step(w, s, k * STEP).filter((e) => e === 'jump').length;
			top = Math.max(top, s.y);
		}
		return { top, jumps };
	};
	assert.ok(jump(300).top > jump(35).top + 1.5);
	assert.equal(jump(10000).jumps, 1);
});

for (const kind of [
	'yellow',
	'pink',
	'red',
	'green',
	'blue',
	'black',
	'dash',
	'spider'
] as OrbKind[])
	test(`ground ${kind} orb takes priority over the ordinary cube jump`, () => {
		const w = world(),
			s = startState(w, 0);
		w.sections[0].ceil = 8;
		w.orbs.add({ id: 1, kind, x: 0, y: 0.5, x0: -0.6, x1: 0.6 });
		press(s, true);
		const events = step(w, s, STEP);
		assert.ok(events.includes('orb'));
		assert.ok(!events.includes('jump'));
		assert.deepEqual(s.used, [1]);
	});

test('a consumed held press does not automatically activate a new orb after landing', () => {
	const w = world(),
		s = startState(w, 0);
	press(s, true);
	step(w, s, STEP);
	for (let k = 2; k < 95; k++) step(w, s, k * STEP);
	w.orbs.add({ id: 2, kind: 'yellow', x: s.x, y: s.y, x0: s.x - 0.6, x1: s.x + 0.6 });
	assert.ok(!step(w, s, 95 * STEP).includes('orb'));
	press(s, false);
	press(s, true);
	assert.ok(step(w, s, 96 * STEP).includes('orb'));
});
