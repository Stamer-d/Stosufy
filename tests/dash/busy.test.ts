// The intense parts of the hardest levels are busy like the song: the kinds change by phrase
// (every two or four bars), gravity turns on the bars and the song's accents, and pads take the
// beat by themselves. Each part its own kind or size, and the level can still be finished.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/addons/dash/chart';
import { generateLevel, type Difficulty, type Level } from '../../src/lib/addons/dash/generate';
import { hearSong } from '../../src/lib/addons/dash/audio';
import { simulate, startState } from '../../src/lib/addons/dash/physics';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

/** 174 BPM, intense all through, the kiai from 30 s to 75 s (a bar is 1.38 s) */
const SONG: SongOptions = {
	bpm: 174,
	length: 90,
	style: 'intense',
	sliders: 6,
	kiai: [[30000, 75000]]
};
const KIAI = SONG.kiai![0];

const made = new Map<string, Level>();
async function level(difficulty: Difficulty, seed: string) {
	const key = `${difficulty}:${seed}`;
	if (!made.has(key)) {
		const chart = parseChart(makeOsu(SONG))!;
		chart.sound = await hearSong(makeAudio(SONG).buffer);
		made.set(key, generateLevel(chart, { difficulty, seed, duration: 90000 }));
	}
	return made.get(key)!;
}
const inKiai = (l: Level) =>
	l.world.sections.filter((s) => s.end > KIAI[0] + 100 && s.start < KIAI[1] - 100);

test('on extreme the kind changes every few bars in the kiai, never the same part twice (only its speed)', async () => {
	for (const seed of ['a', 'b']) {
		const l = await level('extreme', seed);
		const parts = inKiai(l);
		const shown = parts
			.map((s) => `${s.start}:${s.mode}${s.mini ? '·' : ''}${s.speedIndex}`)
			.join(' ');
		// (45 s of kiai: four bars are 5.5 s)
		assert.ok(parts.length >= 7, `${seed}: ${shown}`);
		for (const s of parts.slice(1, -1)) assert.ok(s.end - s.start <= 6000, `${seed}: ${shown}`);
		for (let i = 1; i < parts.length; i++)
			// (the same kind and size again only with another speed: a speed portal, as levels made
			// by hand have them, often without a new kind)
			assert.ok(
				parts[i].mode !== parts[i - 1].mode ||
					parts[i].mini !== parts[i - 1].mini ||
					parts[i].speedIndex !== parts[i - 1].speedIndex,
				`${seed}: the same part twice: ${shown}`
			);
		assert.equal(simulate(l.world, startState(l.world, l.start), l.end, l.plan).dead, false);
	}
});

test('on extreme gravity turns on the bars and accents of the kiai, and pads take beats', async () => {
	let portals = 0;
	let flying = 0;
	let pads = 0;
	// (four levels: which kinds of parts a kiai gets, and so its portals and pads, is up to each)
	for (const seed of ['a', 'b', 'c', 'd']) {
		const l = await level('extreme', seed);
		const w = l.world;
		const there = (x: number) => w.timeAt(x) >= KIAI[0] && w.timeAt(x) < KIAI[1];
		// (the portals of the flying parts: the ball and spider have none, their presses turn
		// gravity; the cube and robot only now and then)
		const turned = (s: (typeof w.sections)[number]) =>
			['ship', 'ufo', 'wave', 'swing'].includes(s.mode);
		portals += w.gravityPortals.items.filter(
			(g) => there(g.x) && !g.sectionEntry && turned(w.sectionAt(w.timeAt(g.x)))
		).length;
		for (const s of inKiai(l))
			if (turned(s)) flying += (Math.min(s.end, KIAI[1]) - Math.max(s.start, KIAI[0])) / 1000;
		pads += w.pads.items.filter((p) => there(p.x)).length;
	}
	// (about one turn every two bars there: a bar is 1.38 s; a pad now and then)
	assert.ok(flying > 20, `${flying} s of flying parts`);
	// (a portal that would turn nothing where the way gets to it isn't put. Levels made by hand
	// have one about every 3.3 s in the ship and UFO, every 7 s in the wave (docs/dash.md §29); the
	// kiai's parts are short now, a chain's part of a bar or two has room for one or none)
	assert.ok(portals >= flying / 4.5, `${portals} gravity portals in ${flying.toFixed(0)} s`);
	assert.ok(pads >= 8, `${pads} pads`);
});

test('the calmer difficulties keep their longer parts', async () => {
	const l = await level('normal', 'a');
	const parts = inKiai(l);
	assert.ok(parts.length <= 5, parts.map((s) => s.mode).join(' '));
});

test('a change of part is no break: something to do right after it and right before the next', async () => {
	const heads: number[] = [];
	const tails: number[] = [];
	for (const seed of ['a', 'b', 'c', 'd']) {
		const l = await level('extreme', seed);
		const w = l.world;
		const events = [
			...l.plan.filter((e) => e.down).map((e) => e.time),
			...w.pads.items.map((p) => w.timeAt(p.x))
		].sort((a, b) => a - b);
		for (const s of inKiai(l).slice(1, -1)) {
			const own = events.filter((t) => t >= s.start && t < s.end);
			heads.push((own[0] ?? s.end) - s.start);
			tails.push(s.end - (own[own.length - 1] ?? s.start));
		}
	}
	const median = (list: number[]) => [...list].sort((a, b) => a - b)[list.length >> 1];
	// (a beat is 345 ms: the first press on about the next beat, the last about a beat before)
	assert.ok(median(heads) <= 600, `after a portal: ${median(heads)} ms`);
	assert.ok(median(tails) <= 750, `before the next: ${median(tails)} ms`);
});

test('the colours change where the music does, not at every part', async () => {
	for (const seed of ['a', 'b']) {
		const parts = inKiai(await level('extreme', seed));
		const turns = parts.slice(1).filter((s, i) => s.palette !== parts[i].palette).length;
		// (the kiai of this song is the same all through)
		assert.ok(turns <= 1, `${seed}: ${parts.map((s) => s.palette).join(' ')}`);
	}
});
