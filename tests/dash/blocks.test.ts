// The levels built from blocks (builders/blocks.ts, builders/ship.ts, rhythm.ts): 56 pieces;
// the cube's clicks on the beat grid, a whole jump apart on easy; the levels can be finished;
// every press of a cube or robot part is needed, there's always something to do, and the old
// way of making them is still there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/addons/dash/chart';
import {
	generateLevel,
	withBeats,
	type Difficulty,
	type Level
} from '../../src/lib/addons/dash/generate';
import { PRESETS } from '../../src/lib/addons/dash/build';
import { BLOCKS } from '../../src/lib/addons/dash/builders/blocks';
import { SHIP_PIECES } from '../../src/lib/addons/dash/builders/ship';
import { drumClicks } from '../../src/lib/addons/dash/rhythm';
import { simulate, startState } from '../../src/lib/addons/dash/physics';
import { musicalRest } from '../../src/lib/addons/dash/composition';
import { allowedModes, modesMark } from '../../src/lib/addons/dash/modes';
import { makeOsu, type SongOptions } from './fixtures';

const SONGS: Record<string, SongOptions> = {
	calm: { bpm: 100, length: 60, style: 'calm' },
	fast: { bpm: 172, length: 60, style: 'intense', kiai: [[30000, 50000]] }
};

const made = new Map<string, Level>();
function level(name: string, difficulty: Difficulty, generator: 'blocks' | 'classic' = 'blocks') {
	const key = `${name}:${difficulty}:${generator}`;
	if (!made.has(key)) {
		const song = SONGS[name];
		const chart = parseChart(makeOsu(song))!;
		made.set(
			key,
			generateLevel(chart, {
				difficulty,
				seed: 'blocks',
				duration: song.length * 1000,
				generator
			})
		);
	}
	return made.get(key)!;
}

test('57 building blocks: 45 for the cube and robot (6 with pads, one by blue pads), 12 for the ship, each its own', () => {
	assert.equal(BLOCKS.length, 45);
	assert.equal(BLOCKS.filter((b) => b.upside === 'pads').length, 1);
	assert.equal(BLOCKS.filter((b) => b.leaps?.some((l) => l.pad)).length, 6);
	assert.equal(SHIP_PIECES.length, 12);
	assert.equal(new Set(BLOCKS.map((b) => b.id)).size, 45);
	assert.equal(new Set(SHIP_PIECES).size, 12);
	// (easy has its own few, every level some more)
	for (let level = 0; level <= 4; level++)
		assert.ok(BLOCKS.filter((b) => b.level === level).length > 0 || level === 4);
});

test('the clicks are on the beat grid, on easy a whole jump apart', () => {
	const song = SONGS.fast;
	const chart = parseChart(makeOsu(song))!;
	const notes = withBeats(chart);
	const beat = 60000 / song.bpm;
	for (const difficulty of ['easy', 'hard', 'extreme'] as const) {
		const preset = PRESETS[difficulty];
		const least = difficulty === 'easy' ? 520 : 0;
		const clicks = drumClicks(chart, notes, preset, 5000, 30000, least);
		assert.ok(clicks.length > 10, `${difficulty}: ${clicks.length} clicks`);
		const quarter = beat / 4;
		for (const t of clicks) {
			const off = (t - chart.timing[0].time) / quarter;
			assert.ok(Math.abs(off - Math.round(off)) < 0.05, `${difficulty}: ${t} not on the grid`);
		}
		for (let k = 1; k < clicks.length; k++)
			assert.ok(clicks[k] - clicks[k - 1] >= Math.max(80, least * 0.9) - 1);
	}
	// (harder: more of them)
	const count = (d: Difficulty) =>
		drumClicks(chart, notes, PRESETS[d], 5000, 30000, d === 'easy' ? 520 : 0).length;
	assert.ok(count('extreme') > count('easy'));
});

test('levels from blocks can be finished, on every difficulty', () => {
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['easy', 'normal', 'hard', 'extreme'] as const) {
			const l = level(name, difficulty);
			const run = simulate(l.world, startState(l.world, l.start), l.end, l.plan);
			assert.equal(run.dead, false, `${name} ${difficulty} at ${Math.round(run.x)}`);
		}
});

test('every press of a cube or robot part is needed, and there is always something to do', () => {
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['normal', 'hard', 'extreme'] as const) {
			const l = level(name, difficulty);
			const w = l.world;
			const chart = parseChart(makeOsu(SONGS[name]))!;
			let state = startState(w, l.start);
			let unneeded = 0;
			let presses = 0;
			for (let i = 0; i < l.plan.length; i++) {
				const e = l.plan[i];
				if (!e.down) continue;
				const s = w.sectionAt(e.time);
				if (s.mode !== 'cube' && s.mode !== 'robot') continue;
				presses++;
				state = simulate(w, state, e.time - 30, l.plan);
				const release = l.plan.findIndex((u, k) => k > i && !u.down);
				const without = l.plan.filter((_, k) => k !== i && k !== release);
				const until = Math.min(s.end - 200, e.time + 1200);
				if (until - e.time < 600) continue;
				if (!simulate(w, state, until, without).dead) unneeded++;
			}
			assert.ok(presses > 10, `${name} ${difficulty}: ${presses} presses`);
			assert.ok(
				unneeded <= presses * 0.03,
				`${name} ${difficulty}: ${unneeded}/${presses} unneeded`
			);
			// Nothing to do for long while the music goes on: rare
			let idle = 0;
			let length = 0;
			// (a pad takes its beat by itself: it counts as something to do, as a press)
			const downs = [
				...l.plan.filter((e) => e.down).map((e) => e.time),
				...w.pads.items.map((p) => w.timeAt(p.x))
			].sort((a, b) => a - b);
			for (const s of w.sections) {
				if (s.mode !== 'cube' && s.mode !== 'robot') continue;
				length += s.end - s.start;
				const marks = [s.start, ...downs.filter((t) => t >= s.start && t < s.end), s.end];
				for (let k = 1; k < marks.length; k++) {
					const gap = marks[k] - marks[k - 1];
					if (gap < 1400) continue;
					const notes = chart.notes.filter(
						(n) =>
							n.time > marks[k - 1] + 150 && n.time < marks[k] - 150 && !musicalRest(chart, n.time)
					).length;
					if (notes >= 3) idle += gap;
				}
			}
			if (length)
				assert.ok(
					idle / length < 0.15,
					`${name} ${difficulty}: ${Math.round((idle / length) * 100)}% idle`
				);
		}
});

test('the older way (classic) still makes levels that can be finished', () => {
	const l = level('fast', 'hard', 'classic');
	const run = simulate(l.world, startState(l.world, l.start), l.end, l.plan);
	assert.equal(run.dead, false);
	// (and another level than from blocks)
	assert.notDeepEqual(l.plan.slice(0, 20), level('fast', 'hard').plan.slice(0, 20));
});

test('the blocks or the older way: a setting of its own, with its own best', () => {
	assert.equal(allowedModes({ off: [], noGravity: [] }).generator, 'blocks');
	assert.equal(allowedModes({ off: [], noGravity: [], classic: true }).generator, 'classic');
	assert.equal(modesMark({ off: [], noGravity: [] }), '');
	assert.equal(modesMark({ off: [], noGravity: [], classic: true }), 'c');
	assert.notEqual(
		modesMark({ off: ['wave'], noGravity: [], classic: true }),
		modesMark({ off: ['wave'], noGravity: [] })
	);
});
