import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunner } from '../../src/lib/dash/builders/runner';
import { PRESETS, random } from '../../src/lib/dash/build';
import { parseChart } from '../../src/lib/dash/chart';
import { generateLevel } from '../../src/lib/dash/generate';
import { makeOsu, makeSound } from './fixtures';
import { world, levelOf, tap } from './worlds';
import { simulate, startState, type InputEvent } from '../../src/lib/dash/physics';
import { unsupportedSpikes, removeUnsupportedSpikes } from '../../src/lib/dash/geometry';
import { DashGame } from '../../src/lib/dash/game';

test('removing a distant support cannot leave a floating spike in the final world', () => {
	const w = world();
	const support = w.solids.add({ x0: 20, x1: 50, y0: 4, y1: 5, style: 1 });
	const hazard = w.spike(44, 4, -1);
	assert.deepEqual(unsupportedSpikes(w), []);
	w.solids.remove(support);
	assert.deepEqual(unsupportedSpikes(w), [hazard]);
	assert.equal(removeUnsupportedSpikes(w), 1);
	assert.equal(w.hazards.items.length, 0);
});

for (const mode of ['cube', 'robot'] as const)
	test(`${mode} terrain has connected support and a required path, without a stray upper lane`, () => {
		const w = world({ mode, length: 30000 }),
			plan: InputEvent[] = [];
		const song = { bpm: 100, length: 30, style: 'mixed' as const, sliders: 2 };
		const chart = parseChart(makeOsu(song))!;
		chart.sound = makeSound(song);
		const clicks = chart.notes.filter((_, i) => i % 2 === 0).map((n) => n.time);
		buildRunner(
			{
				world: w,
				plan,
				rng: random(71),
				preset: PRESETS.hard,
				chart,
				history: [],
				motifs: new Map()
			},
			w.sections[0],
			clicks,
			startState(w, 0)
		);
		assert.ok(plan.length > 10);
		assert.ok(
			w.solids.items.some((s) => s.y1 >= 1),
			'planned elevated terrain'
		);
		assert.ok(
			w.solids.items.every((s) => s.style === 0 && s.y0 === 0),
			'terrain supported from the floor'
		);
		assert.ok(w.hazards.items.every((h) => h.kind === 'saw' || h.dir === 1));
		assert.deepEqual(unsupportedSpikes(w), []);
		assert.equal(simulate(w, startState(w, 0), 30000, plan).dead, false);
		assert.equal(
			simulate(w, startState(w, 0), 30000, []).dead,
			true,
			'the route cannot be bypassed by running below it'
		);
	});

test('generated ground-mode sections keep all their spikes supported after final repair', () => {
	const song = { bpm: 174, length: 70, style: 'intense' as const, sliders: 6 };
	const chart = parseChart(makeOsu(song))!;
	chart.sound = makeSound(song);
	for (const difficulty of ['normal', 'hard', 'insane', 'extreme'] as const) {
		const l = generateLevel(chart, { difficulty, seed: 'tests', duration: 70000 });
		assert.deepEqual(unsupportedSpikes(l.world), [], difficulty);
		assert.ok(
			l.world.hazards.items
				.filter((h) => ['cube', 'robot'].includes(l.world.sectionAt(l.world.timeAt(h.x)).mode))
				.every((h) => h.kind === 'saw' || h.dir === 1),
			difficulty
		);
	}
});

test('the route planner retains automatic pads and held-note dash bridges', () => {
	const w = world({ length: 30000 }),
		plan: InputEvent[] = [];
	const chart = parseChart(makeOsu({ bpm: 100, length: 30, style: 'calm' }))!;
	chart.notes = Array.from({ length: 22 }, (_, i) => ({
		...chart.notes[0],
		time: 1000 + i * 1200,
		end: 1000 + i * 1200 + (i % 3 === 0 ? 900 : 300),
		kind: 'slider' as const,
		sound: 0
	}));
	buildRunner(
		{ world: w, plan, rng: random(3), preset: PRESETS.hard, chart, history: [], motifs: new Map() },
		w.sections[0],
		chart.notes.map((n) => n.time),
		startState(w, 0)
	);
	assert.ok(w.pads.items.length > 0, 'short sustained events create automatic pad bridges');
	assert.ok(
		w.orbs.items.some((o) => o.kind === 'dash'),
		'long sustained events create dash bridges'
	);
	assert.equal(simulate(w, startState(w, 0), 30000, plan).dead, false);
});

test('Robot input and its hold counter replay identically across render frame rates', () => {
	const plan = [...tap(300, 240), ...tap(1100, 80), ...tap(2000, 180)];
	const run = (fps: number) => {
		const game = new DashGame(levelOf(world({ mode: 'robot', length: 4000 }), plan));
		game.auto = true;
		game.begin();
		for (let t = 0; t < 4200; t += 1000 / fps) game.update(t);
		game.update(4200);
		return { state: game.state, status: game.status };
	};
	for (const fps of [24, 30, 60, 144, 240, 360]) assert.deepEqual(run(fps), run(60));
});

test('restoring a Robot checkpoint releases the old thrust before new input', () => {
	const g = new DashGame(levelOf(world({ mode: 'robot' })));
	g.practice = true;
	g.begin();
	g.input(true, 100);
	g.update(220);
	assert.equal(g.state.robotActive, true);
	const saved = { ...g.state, used: [...g.state.used] };
	g.checkpoints.push({ state: saved, x: saved.x, y: saved.y });
	g.begin(true);
	assert.equal(g.state.held, false);
	assert.equal(g.state.robotReleased, true);
	g.input(true, g.state.time + 5);
	g.update(g.state.time + 30);
	assert.ok(g.state.vy < saved.vy);
});

test('the real input queue also activates a grounded orb rather than issuing a cube jump', () => {
	const w = world();
	w.orbs.add({ id: 1, kind: 'yellow', x: 0, y: 0.5, x0: -0.6, x1: 0.6 });
	const game = new DashGame(levelOf(w));
	game.begin();
	game.input(true, 0);
	const events = game.update(10);
	assert.ok(events.includes('orb'));
	assert.ok(!events.includes('jump'));
});
