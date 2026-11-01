import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	composePhrases,
	musicalPosition,
	musicalRest,
	orderPatterns
} from '../../src/lib/dash/composition';
import { parseChart } from '../../src/lib/dash/chart';
import { generateLevel } from '../../src/lib/dash/generate';
import { levelData } from '../../src/lib/dash/level';
import { simulate, startState } from '../../src/lib/dash/physics';
import { checkLevel } from '../../src/lib/dash/validate';
import { makeOsu, makeSound } from './fixtures';

const chart = () => parseChart(makeOsu({ bpm: 120, length: 40, style: 'mixed' }))!;

test('the same rhythm in consecutive two-bar phrases has one musical signature', () => {
	const p = composePhrases(chart(), [1000, 1500, 2500, 3500, 5000, 5500, 6500, 7500]);
	assert.equal(p.length, 2);
	assert.equal(p[0].rhythm, p[1].rhythm);
	assert.notEqual(p[0].key, p[1].key);
	assert.equal(p[0].end, p[1].start);
});

test('phrase boundaries respect BPM and meter changes without activating the new timing early', () => {
	const c = chart();
	c.timing = [
		{ time: 1000, beatLength: 500, meter: 3 },
		{ time: 7000, beatLength: 400, meter: 5 }
	];
	assert.equal(musicalPosition(c, 6999).point.meter, 3);
	assert.equal(musicalPosition(c, 6999).end, 7000);
	assert.equal(musicalPosition(c, 7000).start, 7000);
	assert.equal(musicalPosition(c, 7000).end, 11000);
	assert.notEqual(composePhrases(c, [1000])[0].rhythm, composePhrases(c, [7000])[0].rhythm);
});

test('a repeated feasible shape is tried before novelty, while fallbacks remain available', () => {
	const p = [{ id: 'saw' }, { id: 'stairs' }, { id: 'spikes2' }, { id: 'leap0s' }];
	const ordered = orderPatterns(p, 'spikes2', 'steps', new Set(['stairs']));
	assert.equal(ordered[0].id, 'spikes2');
	assert.equal(ordered[1].id, 'stairs');
	assert.equal(ordered.length, p.length);
	assert.equal(orderPatterns(p, 'leap-2s', 'steps', new Set())[0].id, 'leap0s');
});

test('a new phrase alternates a principal family and a counter-motif instead of one endless shape', () => {
	const p = [{ id: 'hop' }, { id: 'saw' }, { id: 'spikes2' }];
	assert.equal(orderPatterns(p, undefined, 'pulse', new Set(), 0)[0].id, 'spikes2');
	assert.equal(orderPatterns(p, undefined, 'pulse', new Set(['spikes']), 1)[0].id, 'hop');
	assert.equal(
		orderPatterns(p, undefined, 'pulse', new Set(['spikes', 'hop']), 2)[0].id,
		'spikes2'
	);
});

test('declared breaks and measured silence are rests, not a request for filler', () => {
	const c = chart();
	c.breaks = [{ start: 10000, end: 15000 }];
	assert.equal(musicalRest(c, 12000), true);
	assert.equal(musicalRest(c, 9000), false);
	c.sound = { hop: 10, loud: new Float32Array(4000) };
	assert.equal(musicalRest(c, 9000), true);
});

test('a silent song does not acquire hazards just to force input', () => {
	const c = chart();
	c.sound = { hop: 10, loud: new Float32Array(4000) };
	const l = generateLevel(c, { difficulty: 'normal', seed: 'silence', duration: 40000 });
	assert.equal(l.world.hazards.items.length, 0);
	assert.equal(l.kiai.length, 0, 'silence is not a musical drop');
	assert.equal(simulate(l.world, startState(l.world, l.start), l.end, l.plan).dead, false);
});

test('a song ending between fixed ticks can finish without a false crash report', () => {
	const song = { bpm: 83, length: 55, style: 'calm' as const };
	const c = parseChart(makeOsu(song))!;
	c.sound = makeSound(song);
	const l = generateLevel(c, { difficulty: 'hard', seed: 'quality-a', duration: 55000 });
	const before = simulate(l.world, startState(l.world, l.start), l.end, l.plan);
	assert.equal(before.dead, false);
	assert.ok(before.x < l.xEnd);
	assert.equal(checkLevel(l, { windows: false }).finishes, true);
});

test('changing only osu! note height cannot masquerade as a different audio melody', () => {
	const c = chart();
	c.sound = makeSound({ bpm: 120, length: 40, style: 'mixed' });
	const other = { ...c, notes: c.notes.map((n) => ({ ...n, height: 1 - n.height })) };
	const options = { difficulty: 'hard' as const, seed: 'height-is-not-pitch', duration: 40000 };
	assert.deepEqual(levelData(generateLevel(c, options)), levelData(generateLevel(other, options)));
});

test('generated musical breaks contain no added hazards or forced tap inputs', () => {
	const song = {
		bpm: 128,
		length: 60,
		style: 'mixed' as const,
		breaks: [[20000, 26000] as [number, number]]
	};
	const c = parseChart(makeOsu(song))!;
	c.sound = makeSound(song);
	for (const difficulty of ['easy', 'normal', 'hard'] as const) {
		const l = generateLevel(c, { difficulty, seed: 'rests', duration: 60000 });
		const inside = (time: number) => time > 20400 && time < 25600;
		assert.deepEqual(
			l.world.hazards.items.filter((h) => inside(l.world.timeAt(h.x))),
			[],
			difficulty
		);
		assert.deepEqual(
			l.plan.filter(
				(e) =>
					e.down && inside(e.time) && !['ship', 'swing'].includes(l.world.sectionAt(e.time).mode)
			),
			[],
			difficulty
		);
		assert.equal(
			simulate(l.world, startState(l.world, l.start), l.end, l.plan).dead,
			false,
			difficulty
		);
	}
});
