// The ball and spider parts are clicked all through: from hard on there's no stretch where the
// music plays and nothing needs doing (the presses there are needed: without one it crashes),
// and they're clicked about as often as the cube; the UFO and swing rarely go long without one
// either. The ball's and spider's gravity turns by their presses, not by portals, and the ball's
// room is as tall as lets it switch on the beat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, type DashChart } from '../../src/lib/addons/dash/chart';
import { generateLevel, type Difficulty, type Level } from '../../src/lib/addons/dash/generate';
import { hearSong } from '../../src/lib/addons/dash/audio';
import { musicalRest } from '../../src/lib/addons/dash/composition';
import { simulate, startState, type PlayerState } from '../../src/lib/addons/dash/physics';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

const SONGS: Record<string, SongOptions> = {
	mixed: { bpm: 128, length: 80, style: 'mixed', kiai: [[40000, 70000]] },
	fast: { bpm: 174, length: 70, style: 'intense', sliders: 6, kiai: [[25000, 55000]] }
};

const made = new Map<string, { level: Level; beat: number; chart: DashChart }>();
async function level(name: string, difficulty: Difficulty, seed: string) {
	const key = `${name}:${difficulty}:${seed}`;
	if (!made.has(key)) {
		const song = SONGS[name];
		const chart = parseChart(makeOsu(song))!;
		chart.sound = await hearSong(makeAudio(song).buffer);
		const level = generateLevel(chart, { difficulty, seed, duration: song.length * 1000 });
		made.set(key, { level, beat: 60000 / song.bpm, chart });
	}
	return made.get(key)!;
}

/** The presses it can't do without: each one left out (and its letting go), it crashes */
function needed(l: Level) {
	const w = l.world;
	const states: PlayerState[] = [];
	let s = startState(w, l.start);
	for (let time = l.start; time <= l.end; time += 250) {
		s = simulate(w, s, time, l.plan);
		states.push(s);
	}
	const out: number[] = [];
	l.plan.forEach((e, k) => {
		if (!e.down) return;
		const release = l.plan.findIndex((u, n) => n > k && !u.down);
		const inputs = l.plan.filter((_, n) => n !== k && n !== release);
		const from = states[Math.max(0, Math.floor((e.time - 300 - l.start) / 250))];
		if (simulate(w, from, Math.min(l.end, e.time + 2500), inputs).dead) out.push(e.time);
	});
	return out;
}

const SEEDS = ['a', 'b', 'c'];

const neededOf = new Map<Level, number[]>();

/**
 * The stretches of a kind of part with nothing to do, on hard, insane and extreme: how much of
 * its time is in stretches of more than two beats without a needed press (where the music
 * plays), the longest of them (beats), and how many of its presses are needed
 */
async function idleOf(modes: string[]) {
	let time = 0;
	let idle = 0;
	let worst = 0;
	let worstAt = '';
	let parts = 0;
	let presses = 0;
	let needs = 0;
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS) {
				const { level: l, beat, chart } = await level(name, difficulty, seed);
				const w = l.world;
				if (!neededOf.has(l)) neededOf.set(l, needed(l));
				const need = neededOf.get(l)!;
				for (const sec of w.sections) {
					if (!modes.includes(sec.mode)) continue;
					parts++;
					const inside = (t: number) => t > sec.start && t < sec.end;
					presses += l.plan.filter((e) => e.down && inside(e.time)).length;
					needs += need.filter(inside).length;
					const pads = w.pads.items.map((p) => w.timeAt(p.x));
					const marks = [
						sec.start,
						...[...need, ...pads].filter(inside).sort((a, b) => a - b),
						sec.end
					];
					for (let i = 1; i < marks.length; i++) {
						// (where the music rests, nothing needs doing)
						let rest = 0;
						for (let t = marks[i - 1]; t < marks[i]; t += 50) if (musicalRest(chart, t)) rest += 50;
						const gap = marks[i] - marks[i - 1] - rest;
						time += gap;
						// (a stretch of more than two beats with nothing to do)
						if (gap > beat * 2.05) idle += gap;
						if (gap / beat > worst) {
							worst = gap / beat;
							worstAt = `${name} ${difficulty} ${seed} ${sec.mode}@${Math.round(marks[i - 1])}`;
						}
					}
				}
			}
	return { parts, idle: idle / time, worst, worstAt, needed: needs / Math.max(1, presses) };
}

test('from hard on the ball and spider never go long without a press that is needed', async () => {
	const r = await idleOf(['ball', 'spider']);
	assert.ok(r.parts >= 8, `${r.parts} ball and spider parts`);
	// (an orb jump, the way into a part: now and then two beats or so; not more)
	assert.ok(r.worst <= 4.05, `${r.worst.toFixed(1)} beats with nothing to do: ${r.worstAt}`);
	assert.ok(r.idle < 0.12, `${(100 * r.idle).toFixed(0)}% idle`);
});

test('from hard on the UFO and swing rarely go long without a press that is needed', async () => {
	// (a hop left out: the UFO a bit lower, where its ways a bit early or late go too, so not
	// every one can be made needed; a turn left out runs the swing into its walls' spikes)
	const ufo = await idleOf(['ufo']);
	const swing = await idleOf(['swing']);
	assert.ok(ufo.parts >= 6 && swing.parts >= 6, `${ufo.parts} UFO, ${swing.parts} swing parts`);
	assert.ok(ufo.idle < 0.17, `UFO ${(100 * ufo.idle).toFixed(0)}% idle (${ufo.worstAt})`);
	assert.ok(swing.idle < 0.07, `swing ${(100 * swing.idle).toFixed(0)}% idle (${swing.worstAt})`);
	assert.ok(swing.needed >= 0.72, `swing ${(100 * swing.needed).toFixed(0)}% of turns needed`);
});

test('spider parts are built up: platforms on most of the way, not a bare floor and ceiling', async () => {
	let columns = 0;
	let bare = 0;
	let empty = 0;
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS) {
				const { level: l, chart } = await level(name, difficulty, seed);
				const w = l.world;
				for (const s of w.sections) {
					if (s.mode !== 'spider') continue;
					for (let x = Math.ceil(s.x0 + 2); x < s.x1 - 2; x++) {
						if (musicalRest(chart, w.timeAt(x))) continue;
						columns++;
						const block = w.solids.items.some((o) => o.x1 > x && o.x0 < x + 1);
						if (!block) bare++;
						if (!block && !w.hazards.near(x - 0.5, x + 1.5).length) empty++;
					}
				}
			}
	assert.ok(columns > 200, `${columns} spider columns`);
	// (a column without a block of its own: only the part's floor and ceiling; it was 38%)
	assert.ok(bare / columns < 0.3, `${((100 * bare) / columns).toFixed(0)}% without a block`);
	// (nor a spike near: it was 14%)
	assert.ok(empty / columns < 0.12, `${((100 * empty) / columns).toFixed(0)}% with nothing`);
});

test('wave parts zigzag evenly: most turns the same time apart, on the beat grid', async () => {
	let turns = 0;
	let even = 0;
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS) {
				const { level: l } = await level(name, difficulty, seed);
				for (const s of l.world.sections) {
					if (s.mode !== 'wave') continue;
					// (every press and letting go is a turn; the gravity portals' turns aside)
					const times = l.plan
						.filter((e) => e.time > s.start + 300 && e.time < s.end - 400)
						.map((e) => e.time);
					const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]) / 10) * 10);
					if (gaps.length < 4) continue;
					const counts = new Map<number, number>();
					for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
					turns += gaps.length;
					// (the most common gap, and the ones twice or half as long: a climb's long stroke)
					const most = [...counts].sort((a, b) => b[1] - a[1])[0][0];
					even += gaps.filter((g) =>
						[most, most * 2, most / 2].some((m) => Math.abs(g - m) <= 15)
					).length;
				}
			}
	assert.ok(turns > 60, `${turns} turns`);
	assert.ok(even / turns > 0.75, `${((100 * even) / turns).toFixed(0)}% even`);
});

test('the ball and spider are clicked about as often as the cube on the hard levels', async () => {
	const rate = (modes: string[]) => {
		let presses = 0;
		let seconds = 0;
		for (const { level: l } of made.values()) {
			if (l.difficulty === 'normal') continue;
			for (const sec of l.world.sections) {
				if (!modes.includes(sec.mode)) continue;
				seconds += (sec.end - sec.start) / 1000;
				presses += l.plan.filter((e) => e.down && e.time >= sec.start && e.time < sec.end).length;
			}
		}
		return presses / seconds;
	};
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS) await level(name, difficulty, seed);
	const surfaces = rate(['ball', 'spider']);
	const cube = rate(['cube', 'robot']);
	assert.ok(
		surfaces >= cube * 0.9,
		`ball and spider ${surfaces.toFixed(2)}/s, cube ${cube.toFixed(2)}/s`
	);
});

test('from hard on the ball and spider turn gravity by their presses, not by portals', async () => {
	for (const name of Object.keys(SONGS))
		for (const seed of SEEDS) {
			const w = (await level(name, 'extreme', seed)).level.world;
			const portals = w.gravityPortals.items.filter(
				(g) => !g.sectionEntry && ['ball', 'spider'].includes(w.sectionAt(w.timeAt(g.x)).mode)
			);
			assert.equal(portals.length, 0, `${name} ${seed}`);
		}
});

test('the ball part is as tall as lets it switch on the beat, the spider and UFO parts of varied heights', async () => {
	const spider = new Set<number>();
	for (const name of Object.keys(SONGS))
		for (const seed of SEEDS) {
			const { level: l } = await level(name, 'extreme', seed);
			for (const sec of l.world.sections) {
				if (sec.mode === 'spider') spider.add(sec.ceil!);
				if (sec.mode !== 'ball') continue;
				// (128 BPM: a beat of 469 ms takes a room of 7, now and then 6; 174 BPM: 345 ms, 5)
				if (name === 'fast') assert.equal(sec.ceil, 5);
				else assert.ok(sec.ceil! >= 6 && sec.ceil! <= 7, `${sec.ceil}`);
			}
		}
	assert.ok(spider.size >= 2, `spider heights ${[...spider]}`);
	// (the UFO's rooms of different heights too, from hard on)
	const ufo = new Set<number>();
	for (const name of Object.keys(SONGS))
		for (const difficulty of ['hard', 'insane', 'extreme'] as const)
			for (const seed of SEEDS)
				for (const sec of (await level(name, difficulty, seed)).level.world.sections)
					if (sec.mode === 'ufo') ufo.add(sec.ceil!);
	assert.ok(ufo.size >= 2, `UFO heights ${[...ufo]}`);
});

test('musicalRest is still respected: no clicks are forced into the beatmap breaks', async () => {
	const song: SongOptions = { bpm: 140, length: 60, style: 'intense', breaks: [[25000, 33000]] };
	const chart = parseChart(makeOsu(song))!;
	chart.sound = await hearSong(makeAudio(song).buffer);
	const l = generateLevel(chart, { difficulty: 'extreme', seed: 'rest', duration: 60000 });
	const inBreak = l.plan.filter(
		(e) =>
			e.down &&
			musicalRest(chart, e.time) &&
			['ball', 'spider'].includes(l.world.sectionAt(e.time).mode)
	);
	assert.equal(inBreak.length, 0, inBreak.map((e) => Math.round(e.time)).join(', '));
});
