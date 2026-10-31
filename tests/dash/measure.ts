// Measures the Dash physics and the levels made from the test songs, and prints the tables in
// docs/dash.md:
//   node --experimental-transform-types --no-warnings --import ./tests/dash/register.mjs tests/dash/measure.ts

import {
	PHYSICS,
	SPEEDS,
	STEP,
	cubeAt,
	hitbox,
	press,
	startState,
	step,
	type InputEvent,
	type Mode
} from '../../src/lib/dash/physics';
import { parseChart } from '../../src/lib/dash/chart';
import { generateLevel, DIFFICULTIES } from '../../src/lib/dash/generate';
import { hearSong } from '../../src/lib/dash/audio';
import { checkLevel } from '../../src/lib/dash/validate';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';
import { tap, world, type PartOptions } from './worlds';

function trace(
	part: PartOptions,
	until: number,
	inputs: InputEvent[],
	y?: number,
	setup?: (w: ReturnType<typeof world>) => void
) {
	const w = world(part);
	setup?.(w);
	const s = startState(w, 0, y);
	const points: { time: number; y: number; vy: number }[] = [];
	const events: { time: number; name: string }[] = [];
	let k = 0;
	while (s.time + STEP <= until + 1e-6 && !s.dead) {
		const next = s.time + STEP;
		while (k < inputs.length && inputs[k].time <= next) press(s, inputs[k++].down);
		for (const name of step(w, s, next)) events.push({ time: next, name });
		points.push({ time: s.time, y: s.y, vy: s.vy });
	}
	return { points, events };
}

const f = (v: number, digits = 2) => v.toFixed(digits).replace('.', ',');
const rows: string[] = [];
const row = (...cells: string[]) => rows.push(`| ${cells.join(' | ')} |`);

console.log('## Physik (gemessen, 240 Schritte/s)\n');
row('Größe', 'Wert');
row('---', '---');
SPEEDS.forEach((speed, i) => row(`Geschwindigkeit Stufe ${i}`, `${f(speed, 3)} Blöcke/s`));
SPEEDS.forEach((_, i) => {
	const { points, events } = trace({ speedIndex: i }, 1500, tap(100));
	const jump = events.find((e) => e.name === 'jump')!;
	const land = events.find((e) => e.name === 'land' && e.time > jump.time)!;
	const apex = Math.max(...points.map((p) => p.y)) - 0.5;
	const c = cubeAt(i);
	row(
		`Cube-Sprung Stufe ${i}`,
		`${f(apex)} Blöcke hoch, ${Math.round(land.time - jump.time)} ms in der Luft (g ${f(c.gravity, 1)}, Impuls ${f(c.jump, 2)} Blöcke/s)`
	);
});
row('Max. Fallgeschwindigkeit', `${f(PHYSICS.maxFall)} Blöcke/s`);
{
	const { points } = trace(
		{ mode: 'ship' },
		2000,
		[
			{ time: 0, down: true },
			{ time: 800, down: false }
		],
		3
	);
	row(
		'Ship steigen / sinken max.',
		`${f(Math.max(...points.map((p) => p.vy)))} / ${f(-Math.min(...points.map((p) => p.vy)))} Blöcke/s`
	);
}
for (const mini of [false, true]) {
	const { points } = trace({ mode: 'wave', mini }, 300, [{ time: 0, down: true }], 3);
	row(
		`Wave${mini ? ' (mini)' : ''}`,
		`${f(points[20].vy / SPEEDS[1])} Blöcke hoch pro Block vorwärts`
	);
}
{
	const { points } = trace({ mode: 'ufo' }, 1500, tap(100));
	row('UFO-Hüpfer', `${f(Math.max(...points.map((p) => p.y)) - 0.5)} Blöcke hoch`);
}
for (const kind of ['pink', 'yellow', 'red'] as const) {
	const { points } = trace({}, 2000, [], undefined, (w) =>
		w.pads.add({ id: 1, kind, x: 4, y: 0, dir: 1, x0: 3.5, x1: 4.5 })
	);
	row(`Pad ${kind}`, `${f(Math.max(...points.map((p) => p.y)) - 0.5)} Blöcke hoch`);
}
for (const mode of ['cube', 'ship', 'wave'] as Mode[])
	for (const mini of [false, true]) {
		const b = hitbox(mode, mini);
		row(
			`Hitbox ${mode}${mini ? ' mini' : ''}`,
			`außen ${f(b.w * 2)} × ${f(b.h * 2)}, innen ${f(b.inner * 2)} Blöcke`
		);
	}
row('Spike (tödlich)', '0,20 × 0,40 Blöcke in der Mitte (0,3–0,7 über der Basis)');
console.log(rows.join('\n'));

console.log('\n## Level (Testsongs, Prüfung mit validate.ts)\n');
const SONGS: Record<string, SongOptions> = {
	'90 BPM ruhig': { bpm: 90, length: 70, style: 'calm' },
	'128 BPM gemischt': {
		bpm: 128,
		length: 80,
		style: 'mixed',
		kiai: [[40000, 70000]],
		breaks: [[20000, 26000]]
	},
	'174 BPM intensiv': { bpm: 174, length: 70, style: 'intense', sliders: 6 },
	'110→165 BPM': {
		bpm: 110,
		length: 70,
		style: 'mixed',
		change: { at: 30000, bpm: 165 },
		kiai: [[45000, 65000]]
	}
};
rows.length = 0;
row(
	'Song',
	'Schwierigkeit',
	'durchspielbar',
	'Klicks',
	'engstes Fenster',
	'Median-Fenster',
	'kürzester Abstand',
	'Sichtzeit min.'
);
row('---', '---', '---', '---', '---', '---', '---', '---');
for (const [name, song] of Object.entries(SONGS)) {
	const sound = await hearSong(makeAudio(song).buffer);
	for (const difficulty of DIFFICULTIES) {
		const chart = parseChart(makeOsu(song))!;
		chart.sound = sound;
		const level = generateLevel(chart, { difficulty, seed: 'tests', duration: song.length * 1000 });
		const r = checkLevel(level);
		row(
			name,
			difficulty,
			r.finishes ? 'ja' : `nein (${r.crash})`,
			String(r.clicks.length),
			`${Math.round(r.narrowest)} ms`,
			`${Math.round(r.median)} ms`,
			`${Math.round(r.closest)} ms`,
			`${Math.round(r.sight)} ms`
		);
	}
}
console.log(rows.join('\n'));
