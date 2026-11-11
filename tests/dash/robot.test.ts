import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	cubeAt,
	press,
	step,
	STEP,
	startState,
	type OrbKind
} from '../../src/lib/addons/dash/physics';
import { world } from './worlds';
import { robotStep } from '../../src/lib/addons/dash/native-robot';
import { orbVelocity } from '../../src/lib/addons/dash/native-orbs';

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

test('Robot hold height varies, and held through a landing it jumps again at once', () => {
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
	assert.ok(jump(10000).jumps > 2, 'held: one full jump after another');
});

test('Robot: a press made a moment before landing jumps on the landing', () => {
	const w = world({ mode: 'robot' }),
		s = startState(w, 0);
	press(s, true);
	const events: { time: number; name: string }[] = [];
	let landed = -1;
	for (let k = 1; k < 480; k++) {
		const time = k * STEP;
		// A full jump, let go, and pressed again 40 ms before it comes down
		if (time > 400 && s.held && landed < 0) press(s, false);
		for (const name of step(w, s, time)) events.push({ time, name });
		if (landed < 0 && events.some((e) => e.name === 'land')) landed = time;
	}
	const firstLand = events.find((e) => e.name === 'land')!.time;
	// Again, with the press just before that landing
	const w2 = world({ mode: 'robot' }),
		s2 = startState(w2, 0);
	press(s2, true);
	const jumps: number[] = [];
	for (let k = 1; k < 480; k++) {
		const time = k * STEP;
		if (time > 400 && time < firstLand - 40 && s2.held) press(s2, false);
		if (time >= firstLand - 40 && !s2.held && jumps.length === 1) press(s2, true);
		for (const name of step(w2, s2, time)) if (name === 'jump') jumps.push(time);
	}
	assert.ok(jumps.length >= 2, `jumps at ${jumps}`);
	assert.ok(Math.abs(jumps[1] - firstLand) <= STEP * 2, `${jumps[1]} vs landing ${firstLand}`);
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
