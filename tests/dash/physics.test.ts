// The Dash physics, measured: how fast, how high and how long each kind of part moves, what
// kills and what doesn't, and that nothing depends on anything but the presses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	PHYSICS,
	SPEEDS,
	STEP,
	cubeAt,
	hitbox,
	press,
	simulate,
	startState,
	step,
	type InputEvent
} from '../../src/lib/addons/dash/physics';
import { tap, world } from './worlds';

/** Runs from the start with presses; where it was each step and what happened */
function run(w: ReturnType<typeof world>, until: number, inputs: InputEvent[] = [], y?: number) {
	const s = startState(w, 0, y);
	const trace: { time: number; x: number; y: number; vy: number; gravity: number }[] = [];
	const events: { time: number; name: string }[] = [];
	let k = 0;
	while (s.time + STEP <= until + 1e-6 && !s.dead) {
		const next = s.time + STEP;
		while (k < inputs.length && inputs[k].time <= next) press(s, inputs[k++].down);
		for (const name of step(w, s, next)) events.push({ time: next, name });
		trace.push({ time: s.time, x: s.x, y: s.y, vy: s.vy, gravity: s.gravity });
	}
	return { state: s, trace, events };
}

const near = (actual: number, expected: number, within: number, what: string) =>
	assert.ok(
		Math.abs(actual - expected) <= within,
		`${what}: ${actual.toFixed(4)}, expected ${expected.toFixed(4)} ± ${within}`
	);

test('240 steps a second', () => assert.equal(STEP, 1000 / 240));

test('moves on at the speed of its part, at every speed', () => {
	SPEEDS.forEach((speed, speedIndex) => {
		const { state } = run(world({ speedIndex }), 1000);
		near(state.x, speed, 1e-6, `x after 1 s at speed ${speedIndex}`);
	});
});

test('the cube jumps as high and as long as its jump and gravity say, at every speed', () => {
	SPEEDS.forEach((_, speedIndex) => {
		const { jump, gravity } = cubeAt(speedIndex);
		const { trace, events } = run(world({ speedIndex }), 1500, tap(100));
		const jumped = events.find((e) => e.name === 'jump')!;
		const landed = events.find((e) => e.name === 'land' && e.time > jumped.time)!;
		const apex = Math.max(...trace.map((p) => p.y)) - 0.5;
		// (the steps are whole: a little higher than the smooth curve, at most half a step's rise)
		near(apex, (jump * jump) / (2 * gravity), (jump * STEP) / 1000, `apex at speed ${speedIndex}`);
		near(landed.time - jumped.time, ((2 * jump) / gravity) * 1000, STEP * 2, 'time in the air');
	});
});

test('the jump starts on the step the press comes in', () => {
	const { events } = run(world(), 1000, tap(200));
	const jump = events.find((e) => e.name === 'jump')!;
	assert.ok(jump.time >= 200 && jump.time < 200 + STEP + 1e-9, `jumped at ${jump.time}`);
});

test('held, the cube jumps again the moment it lands', () => {
	const { events } = run(world(), 2600, [
		{ time: 100, down: true },
		{ time: 2500, down: false }
	]);
	const jumps = events.filter((e) => e.name === 'jump').map((e) => e.time);
	const air = ((2 * cubeAt(1).jump) / cubeAt(1).gravity) * 1000;
	assert.equal(jumps.length, Math.floor(2400 / (air + STEP)) + 1);
	for (let i = 1; i < jumps.length; i++)
		near(jumps[i] - jumps[i - 1], air, STEP * 2, 'between jumps');
});

test('a tap in the air is no jump on landing', () => {
	const { events } = run(world(), 1500, [...tap(100), ...tap(300, 50)]);
	assert.equal(events.filter((e) => e.name === 'jump').length, 1);
});

test('falls with the cube gravity, never faster than the most', () => {
	const { gravity } = cubeAt(1);
	const { trace } = run(world(), 600, [], 25);
	near(trace[23].vy, (-gravity * (24 * STEP)) / 1000, gravity * 0.005, 'speed after 100 ms');
	near(Math.min(...trace.map((p) => p.vy)), -PHYSICS.maxFall, 1e-9, 'the fastest fall');
});

test('the ship climbs while held and sinks when let go, up and down to its limits', () => {
	const w = world({ mode: 'ship' });
	const { trace } = run(
		w,
		2000,
		[
			{ time: 0, down: true },
			{ time: 600, down: false }
		],
		3
	);
	const held = trace.filter((p) => p.time < 600);
	const free = trace.filter((p) => p.time > 900);
	assert.ok(held[held.length - 1].y > 3, 'climbed');
	near(Math.max(...held.map((p) => p.vy)), PHYSICS.shipMaxUp, 1e-9, 'fastest climb');
	near(Math.min(...free.map((p) => p.vy)), -PHYSICS.shipMaxDown, 1e-9, 'fastest sink');
});

test('the ship slides along the ceiling held against it', () => {
	const { state } = run(world({ mode: 'ship', ceil: 6 }), 3000, [{ time: 0, down: true }]);
	assert.equal(state.dead, false);
	near(state.y, 6 - hitbox('ship').h, 1e-9, 'under the ceiling');
});

test('the wave goes up at 45° while held, down when not, and twice as steep small', () => {
	for (const mini of [false, true]) {
		const w = world({ mode: 'wave', mini });
		const { trace } = run(
			w,
			400,
			[
				{ time: 0, down: true },
				{ time: 200, down: false }
			],
			5
		);
		const speed = SPEEDS[1] * (mini ? 2 : 1);
		near(trace[10].vy, speed, 1e-9, `up${mini ? ' (small)' : ''}`);
		near(trace[60].vy, -speed, 1e-9, `down${mini ? ' (small)' : ''}`);
	}
});

test('the ball turns its gravity around once a press, however long it is held', () => {
	const { trace } = run(world({ mode: 'ball' }), 2000, [
		{ time: 200, down: true },
		{ time: 1800, down: false }
	]);
	let turns = 0;
	for (let i = 1; i < trace.length; i++) if (trace[i].gravity !== trace[i - 1].gravity) turns++;
	assert.equal(turns, 1);
});

test('the UFO hops once a press, holding is no second hop', () => {
	const { events } = run(world({ mode: 'ufo' }), 2000, [
		...tap(100),
		{ time: 700, down: true },
		{ time: 1600, down: false }
	]);
	assert.equal(events.filter((e) => e.name === 'jump').length, 2);
});

test('the spider is on the ceiling the step it is pressed', () => {
	const w = world({ mode: 'spider', ceil: 9 });
	const { events, trace } = run(w, 600, tap(200));
	const jump = events.find((e) => e.name === 'jump')!;
	const after = trace.find((p) => p.time === jump.time)!;
	near(after.y, 9 - hitbox('spider').h, 1e-9, 'on the ceiling');
	assert.equal(after.gravity, -1);
});

test('the swing turns its gravity around on every press', () => {
	const { trace } = run(
		world({ mode: 'swing' }),
		2000,
		[...tap(200), ...tap(700), ...tap(1200)],
		5
	);
	let turns = 0;
	for (let i = 1; i < trace.length; i++) if (trace[i].gravity !== trace[i - 1].gravity) turns++;
	assert.equal(turns, 3);
});

// --- What kills -------------------------------------------------------------------------

test('a spike kills by its middle only', () => {
	const w = world();
	w.spike(5, 0);
	const { state } = run(w, 2000);
	assert.equal(state.dead, true);
	// The middle of the spike is 0.2 wide: the cube's edge reaches it at 4.9
	assert.ok(
		state.x > 4.4 && state.x <= 4.4 + (SPEEDS[1] * STEP) / 1000 + 1e-9,
		`died at ${state.x}`
	);
});

test('a jump on time clears a spike', () => {
	const w = world();
	w.spike(5, 0);
	const at = ((5 - 2) / SPEEDS[1]) * 1000;
	assert.equal(run(w, 2000, tap(at)).state.dead, false);
});

test("a block's top carries the cube, its side kills it", () => {
	const block = () => {
		const w = world();
		w.solids.add({ x0: 5, x1: 8, y0: 0, y1: 1, style: 0 });
		return w;
	};
	const crashed = run(block(), 2000).state;
	assert.equal(crashed.dead, true);
	// (by the inner box: the cube's middle, 0.3 wide)
	assert.ok(crashed.x > 4.85 && crashed.x <= 4.85 + (SPEEDS[1] * STEP) / 1000 + 1e-9);
	const on = run(block(), (7 / SPEEDS[1]) * 1000, tap((2 / SPEEDS[1]) * 1000));
	assert.equal(on.state.dead, false);
	near(on.state.y, 1.5, 1e-9, 'standing on the block');
	assert.equal(on.state.grounded, true);
});

test('falling at the fastest, the cube lands on a thin slab instead of falling through', () => {
	for (const mini of [false, true]) {
		const w = world({ mini });
		w.solids.add({ x0: 0, x1: 40, y0: 4, y1: 4.5, style: 1 });
		const { state } = run(w, 1500, [], 25);
		assert.equal(state.dead, false);
		near(state.y, 4.5 + hitbox('cube', mini).h, 1e-9, `on the slab${mini ? ' (small)' : ''}`);
	}
});

test('the wave crashes into anything it touches', () => {
	const w = world({ mode: 'wave' });
	w.solids.add({ x0: 5, x1: 6, y0: 0, y1: 3, style: 2 });
	assert.equal(run(w, 2000).state.dead, true);
});

test('at the top speed, not even the small wave slips past a saw between two steps', () => {
	// Its way up from the floor, then saws on that line, a little further each time
	for (let k = 0; k < 24; k++) {
		const w = world({ mode: 'wave', mini: true, speedIndex: 4, ceil: 30 });
		const rise = SPEEDS[4] * 2;
		const x = 4 + k * 0.0173;
		const t = (x / SPEEDS[4]) * 1000;
		w.saw(x, hitbox('wave', true).h + (rise * t) / 1000, 0.3);
		const { state } = run(w, 1500, [{ time: 0, down: true }]);
		assert.equal(state.dead, true, `passed the saw at ${x.toFixed(3)}`);
	}
});

// --- Portals, orbs, pads ----------------------------------------------------------------

test('a gravity portal turns it upside down', () => {
	const w = world({ mode: 'ball' });
	w.gravityPortals.add({ x: 3, y: 5, gravity: -1, x0: 2.4, x1: 3.6 });
	const { trace, events, state } = run(w, 2000);
	assert.ok(events.some((e) => e.name === 'gravity'));
	assert.ok(trace.every((p) => (p.x <= 3 ? p.gravity === 1 : p.gravity === -1)));
	near(state.y, 10 - hitbox('ball').h, 1e-9, 'fallen onto the ceiling');
});

test('the next part changes the kind and the size: a portal', () => {
	const w = world({ length: 1000 }, { mode: 'ship', mini: true, length: 3000 });
	const { events, state } = run(w, 1500);
	const portal = events.find((e) => e.name === 'portal');
	assert.ok(portal && portal.time > 1000 && portal.time <= 1000 + STEP + 1e-9);
	assert.equal(state.mode, 'ship');
	assert.equal(state.mini, true);
	assert.equal(hitbox(state.mode, state.mini).h, 0.3);
});

test('a speed change: the way goes on at the new speed from its time', () => {
	const w = world({ speedIndex: 1, length: 1000 }, { speedIndex: 4, length: 1000 });
	near(run(w, 1500).state.x, SPEEDS[1] + SPEEDS[4] * 0.5, 1e-6, 'x at 1.5 s');
	near(w.timeAt(w.xAt(1234)), 1234, 1e-6, 'time and place agree');
});

test('a press on a yellow orb in the air jumps again', () => {
	const w = world();
	const air = run(world(), 1500, tap(96)).trace;
	const single = Math.max(...air.map((p) => p.y));
	w.orbs.add({ id: 1, kind: 'yellow', x: 3.2, y: 2.6, x0: 2.6, x1: 3.8 });
	const { events, trace } = run(w, 1500, [...tap(96), ...tap(289)]);
	assert.ok(events.some((e) => e.name === 'orb'));
	assert.ok(Math.max(...trace.map((p) => p.y)) > single + 1);
});

test('a yellow pad launches it without a press', () => {
	const w = world();
	w.pads.add({ id: 1, kind: 'yellow', x: 4, y: 0, dir: 1, x0: 3.5, x1: 4.5 });
	const { events, trace } = run(w, 1500);
	assert.ok(events.some((e) => e.name === 'pad'));
	const apex = Math.max(...trace.map((p) => p.y)) - 0.5;
	near(apex, PHYSICS.pad.yellow ** 2 / (2 * cubeAt(1).gravity), 0.15, 'height from the pad');
});

test('a red pad launches higher than a yellow one, a pink one lower', () => {
	const apex = (kind: 'yellow' | 'red' | 'pink') => {
		const w = world();
		w.pads.add({ id: 1, kind, x: 4, y: 0, dir: 1, x0: 3.5, x1: 4.5 });
		return Math.max(...run(w, 2000).trace.map((p) => p.y));
	};
	assert.ok(apex('red') > apex('yellow') + 1, 'red over yellow');
	assert.ok(apex('yellow') > apex('pink') + 1, 'yellow over pink');
});

test('the same presses, the same run', () => {
	const w = world({ length: 2000 }, { mode: 'ship', length: 2000 }, { mode: 'wave', length: 2000 });
	const inputs = [
		...tap(300),
		...tap(900),
		{ time: 2300, down: true },
		{ time: 2900, down: false }
	];
	const a = simulate(w, startState(w, 0), 6000, inputs);
	const b = simulate(w, startState(w, 0), 6000, inputs);
	assert.deepEqual(a, b);
});

test('a corridor of slopes is deadly to the ship, as to the wave; between its walls it flies on', () => {
	const w = world({ mode: 'ship' });
	// (from 20 to 40 blocks a corridor from 3 to 7 blocks up)
	w.walls.add({ xs: [20, 40], lo: [3, 3], hi: [7, 7], x0: 20, x1: 40 });
	const start = startState(w, 0, 5);
	// (let go: it sinks into the floor slope)
	assert.ok(simulate(w, start, 4000, []).dead);
	// (holding on: it rises into the ceiling slope)
	assert.ok(simulate(w, start, 4000, [{ time: 0, down: true }]).dead);
	// (before the corridor it flies as ever)
	assert.ok(!simulate(w, start, 1500, []).dead);
});

test("the spider's jump to the other side crashes into a saw or spike on its way", () => {
	const w = world({ mode: 'spider', ceil: 8 });
	const start = startState(w, 0);
	// (a press at 500 ms: it's at the ceiling right away)
	const free = simulate(w, start, 1000, tap(500));
	assert.ok(!free.dead && free.gravity < 0, 'without anything on its way it gets over');
	// (a saw in the middle of the room where it jumps)
	const x = w.xAt(500 + 1000 / 240);
	w.saw(x, 4, 0.7);
	assert.ok(simulate(w, start, 1000, tap(500)).dead, 'through a saw');
	w.hazards.removeIf(() => true);
	// (a spike hanging down into its way, short of the ceiling)
	w.solids.add({ x0: x - 1, x1: x + 1, y0: 5, y1: 6, style: 1 });
	w.spike(x, 5, -1);
	const run = simulate(w, start, 1000, tap(500));
	assert.ok(run.dead, 'into a spike under a block on its way');
});
