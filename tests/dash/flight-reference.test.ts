// Static-derived fixtures from the saved native instruction order, not production constants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightStep, type FlightInput } from '../../src/lib/dash/native-flight';
import { orbVelocity } from '../../src/lib/dash/native-orbs';
import { padVelocity } from '../../src/lib/dash/native-pads';
import { nativeRound } from '../../src/lib/dash/native-number';
import { startState, step, STEP } from '../../src/lib/dash/physics';
import { world } from './worlds';
const base: FlightInput = {
	vy: 0,
	gravity: 1,
	mini: false,
	held: false,
	buffered: false,
	boosted: false,
	storedGravity: 0.9581990242004395
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

const cases: [string, 'ship' | 'ufo' | 'swing', Partial<FlightInput>, number, number, boolean][] = [
	['ship thrust', 'ship', { held: true }, 0.1944, 1, false],
	['UFO flap includes gravity', 'ufo', { held: true, buffered: true }, 12.3678, 1, false],
	['mini UFO flap', 'ufo', { held: true, buffered: true, mini: true }, 11.9664, 1, false],
	['inverted UFO predicate', 'ufo', { gravity: -1 }, 0.2322, -1, false],
	['swing flip damps momentum', 'swing', { vy: 9, held: true, buffered: true }, 7.3548, -1, false],
	['swing falling cap', 'swing', { vy: -14.4 }, -14.4, 1, false],
	['inverted swing falling cap', 'swing', { vy: 14.4, gravity: -1 }, 14.4, -1, false],
	[
		'boost endpoint remains excluded',
		'ship',
		{ vy: 16.94117546081543, mini: true, held: true, boosted: true },
		16.7958,
		1,
		true
	],
	[
		'boost clears at native float lower threshold',
		'ship',
		{ vy: -11.520000000000001, boosted: true },
		-11.52,
		1,
		false
	]
];
for (const [label, mode, input, vy, gravity, boosted] of cases)
	test(`REA flight: ${label}`, () => {
		const out = flightStep(mode, { ...base, ...input }, 1 / 240);
		near(out.vy, vy);
		assert.equal(out.gravity, gravity);
		assert.equal(out.boosted, boosted);
	});

test('REA setter rounds the fractional part in native double precision', () => {
	assert.equal(nativeRound(8.0055), 8.005);
	assert.equal(nativeRound(-8.0055), -8.005);
	const r = flightStep('ship', { ...base, vy: 14.4099, boosted: true }, 0);
	near(r.vy, 14.409000000000002);
});

test('REA orb powers distinguish ship and UFO instead of using a common .75 scale', () => {
	near(orbVelocity('ship', 'yellow', false, 1, 20.1240572), 20.124);
	near(orbVelocity('ship', 'pink', false, 1, 20.1240572), 7.4466);
	near(orbVelocity('ship', 'red', false, 1, 20.1240572), 20.124);
	near(orbVelocity('ship', 'red', true, 1, 20.1240572), 22.5396);
	near(orbVelocity('ufo', 'pink', false, 1, 20.1240572), 8.4528);
	near(orbVelocity('ufo', 'red', false, 1, 20.1240572), 20.5272);
});

test('REA black orb ignores size and uses mode-specific impulse', () => {
	for (const mini of [false, true]) {
		near(orbVelocity('cube', 'black', mini, 1, 20), -27);
		near(orbVelocity('ship', 'black', mini, 1, 20), -25.2);
		near(orbVelocity('ufo', 'black', mini, 1, 20), -20.16);
		near(orbVelocity('spider', 'black', mini, -1, 20), 29.7);
	}
});

test('REA pad dispatch uses color, mode and size', () => {
	near(padVelocity('ship', 'yellow', false, 1), 28.8);
	near(padVelocity('ship', 'pink', false, 1), 10.08);
	near(padVelocity('ufo', 'pink', false, 1), 11.52);
	near(padVelocity('ship', 'red', false, 1), 18.144);
	near(padVelocity('ship', 'red', true, 1), 21.888);
	near(padVelocity('ufo', 'red', true, 1), 22.5792);
	assert.ok(Math.abs(padVelocity('ball', 'yellow', false, 1) - 17.28) < 1e-6);
});

test('red-pad flight boost survives beyond the usual speed cap', () => {
	const w = world({ mode: 'ship' });
	w.pads.add({ id: 1, kind: 'red', x: 0, y: 0, dir: 1, x0: -0.5, x1: 0.5 });
	const s = startState(w, 0);
	step(w, s, STEP);
	assert.equal(s.velocityBoosted, true);
	near(s.vy, 18.144);
	step(w, s, 2 * STEP);
	assert.equal(s.velocityBoosted, true);
	assert.ok(s.vy > 14.4);
});

test('REA blue pad propels before flipping gravity and enables boost', () => {
	near(padVelocity('cube', 'blue', false, 1), 11.52);
	assert.ok(Math.abs(padVelocity('ball', 'blue', false, 1) - 6.912) < 1e-6);
	const w = world();
	w.pads.add({ id: 1, kind: 'blue', x: 0, y: 0, dir: 1, x0: -0.5, x1: 0.5 });
	const s = startState(w, 0);
	step(w, s, STEP);
	assert.equal(s.gravity, -1);
	near(s.vy, 11.52);
	assert.equal(s.velocityBoosted, true);
});

test('a blue pad does not invert gravity a second time from its wrong side', () => {
	const w = world();
	w.pads.add({ id: 1, kind: 'blue', x: 0, y: 0, dir: 1, x0: -0.5, x1: 0.5 });
	const s = startState(w, 0);
	s.gravity = -1;
	step(w, s, STEP);
	assert.equal(s.gravity, -1);
	assert.deepEqual(s.used, []);
});
