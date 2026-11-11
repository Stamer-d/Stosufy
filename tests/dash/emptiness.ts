// Where levels are empty, on songs as real maps are: uneven rhythms, syncopation, triplets, empty
// bars, long sliders, quiet intros, a build-up and drop, breaks; with and without the song's
// sound. It measures the presses a person really needs (without one, they crash), the longest
// stretch of a part without one, parts with (almost) nothing to do, and how often a press at the
// wrong time in a spider or ball part is free (then nothing for 1.5 s, still alive):
//   node --experimental-transform-types --no-warnings --import ./tests/dash/register.mjs tests/dash/emptiness.ts [difficulties] [heard,silent]
// One level part by part (SHOW=<mode> lists that kind's presses, (x) where one isn't needed):
//   node ... tests/dash/emptiness.ts x x dnb174:normal:q:heard
import { parseChart } from '../../src/lib/addons/dash/chart';
import { generateLevel, type Difficulty, type Level } from '../../src/lib/addons/dash/generate';
import { simulate, startState, type PlayerState } from '../../src/lib/addons/dash/physics';
import { musicalRest } from '../../src/lib/addons/dash/composition';
import type { SongSound } from '../../src/lib/addons/dash/audio';

function numbers(seed: number) {
	let s = seed || 1;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

interface Stretch {
	bars: number;
	kind: 'intro' | 'verse' | 'build' | 'drop' | 'break' | 'calm';
}
/** A song: its BPM and its stretches; the map's notes and the sound made from them */
function song(bpm: number, plan: Stretch[], seed: number, withSound: boolean) {
	const rnd = numbers(seed);
	const beat = 60000 / bpm;
	const offset = 800;
	const lines: string[] = [
		'osu file format v14',
		'',
		'[General]',
		'Mode: 0',
		'',
		'[Metadata]',
		`Title:Real ${bpm} ${seed}`,
		'Artist:Probe',
		'Creator:probe',
		'Version:insane',
		'',
		'[Difficulty]',
		'CircleSize:4',
		'SliderMultiplier:1.6',
		'',
		'[Events]'
	];
	const notes: { t: number; strong: number }[] = [];
	const hits: string[] = [];
	const loudAt: [number, number, number][] = [];
	const kickBars: [number, number][] = [];
	let t = offset;
	const kiai: [number, number][] = [];
	const breaks: [number, number][] = [];
	// Rhythms in quarter beats within a bar (16 slots)
	const RHYTHMS: Record<string, number[][]> = {
		sparse: [[0, 8], [0, 6, 8], [0], [0, 12], [4, 8, 14]],
		verse: [
			[0, 3, 6, 8, 12],
			[0, 4, 6, 10, 12, 14],
			[0, 2, 6, 8, 11, 14],
			[2, 6, 10, 14],
			[0, 8, 10, 12]
		],
		triplet: [
			[0, 5, 11, 16 * 0.5, 13],
			[0, 5.33, 10.67, 16 * 0.5]
		],
		drop: [
			[0, 2, 4, 6, 8, 10, 12, 14],
			[0, 3, 4, 6, 8, 11, 12, 14],
			[0, 2, 3, 4, 6, 8, 10, 11, 12, 14]
		],
		build: [
			[0, 4, 8, 12],
			[0, 2, 4, 6, 8, 10, 12, 14],
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
		]
	};
	for (const st of plan) {
		const from = t;
		for (let b = 0; b < st.bars; b++) {
			const barStart = t;
			let pattern: number[] = [];
			if (st.kind === 'intro') pattern = rnd() < 0.3 ? [] : RHYTHMS.sparse[Math.floor(rnd() * 5)];
			else if (st.kind === 'calm')
				pattern = rnd() < 0.15 ? [] : RHYTHMS.sparse[Math.floor(rnd() * 5)];
			else if (st.kind === 'verse')
				pattern =
					rnd() < 0.15
						? RHYTHMS.triplet[Math.floor(rnd() * 2)]
						: RHYTHMS.verse[Math.floor(rnd() * 5)];
			else if (st.kind === 'build')
				pattern = RHYTHMS.build[Math.min(2, Math.floor((b / st.bars) * 3))];
			else if (st.kind === 'drop')
				pattern = rnd() < 0.08 ? [0, 8] : RHYTHMS.drop[Math.floor(rnd() * 3)];
			for (const slot of pattern) {
				const nt = Math.round(barStart + (slot / 4) * beat + (rnd() - 0.5) * 6);
				// (a long slider now and then in the verse and calm parts)
				const slider = (st.kind === 'verse' || st.kind === 'calm') && rnd() < 0.18;
				const strong = slot === 0 ? 1 : slot % 4 === 0 ? 0.7 : 0.4;
				if (slider)
					lines.push(
						`256,192,${nt},2,${strong > 0.9 ? 4 : 0},B|330:192,1,${Math.round(140 + rnd() * 160)}`
					);
				else
					lines.push(
						`${Math.round(64 + rnd() * 384)},${Math.round(48 + rnd() * 288)},${nt},${slot === 0 ? 5 : 1},${strong > 0.9 && st.kind === 'drop' ? 4 : 0},0:0:0:0:`
					);
				notes.push({ t: nt, strong });
			}
			if (st.kind === 'drop') kickBars.push([barStart, barStart + beat * 4]);
			t = barStart + beat * 4;
		}
		const loud =
			st.kind === 'intro'
				? 0.18
				: st.kind === 'calm'
					? 0.35
					: st.kind === 'verse'
						? 0.55
						: st.kind === 'build'
							? 0.7
							: st.kind === 'drop'
								? 1
								: 0.03;
		loudAt.push([from, t, loud]);
		if (st.kind === 'drop') kiai.push([from, t]);
		if (st.kind === 'break') breaks.push([from + 200, t - 200]);
	}
	lines.push(...breaks.map(([a, b]) => `2,${a},${b}`));
	lines.push('', '[TimingPoints]', `${offset},${beat},4,2,0,70,1,0`);
	for (const [a, b] of kiai) lines.push(`${a},-100,4,2,0,80,0,1`, `${b},-100,4,2,0,70,0,0`);
	// (notes need to come after the header, sorted)
	const objects = lines.filter((l) => /^\d+,\d+,\d+,\d/.test(l));
	const header = lines.filter(
		(l) =>
			!/^\d+,\d+,\d+,\d/.test(l) ||
			l.startsWith(`${offset},`) ||
			/^\d+,-100/.test(l) ||
			/^2,\d+,\d+$/.test(l)
	);
	const text = [...header, '', '[HitObjects]', ...objects].join('\n');
	const chart = parseChart(text)!;
	if (withSound) {
		const hop = 10;
		const n = Math.ceil(t / hop) + 200;
		const loud = new Float32Array(n);
		const h = new Float32Array(n);
		const k = new Float32Array(n);
		for (const [a, b, v] of loudAt)
			for (let i = Math.floor(a / hop); i < b / hop && i < n; i++)
				loud[i] = v * (0.9 + rnd() * 0.1);
		for (const note of notes) {
			const i = Math.round(note.t / hop);
			if (i < n) h[i] = Math.max(h[i], 0.4 + note.strong * 0.6);
		}
		for (const [a, b] of kickBars)
			for (let x = a; x < b; x += beat) {
				const i = Math.round(x / hop);
				if (i < n) k[i] = 1;
			}
		chart.sound = { hop, loud, hits: h, kicks: k } as SongSound;
	}
	return { chart, length: t + 1500 };
}

const SONGS = [
	{
		name: 'edm 128',
		bpm: 128,
		plan: [
			{ bars: 8, kind: 'intro' },
			{ bars: 16, kind: 'verse' },
			{ bars: 8, kind: 'build' },
			{ bars: 16, kind: 'drop' },
			{ bars: 4, kind: 'break' },
			{ bars: 8, kind: 'calm' },
			{ bars: 16, kind: 'drop' }
		]
	},
	{
		name: 'dnb 174',
		bpm: 174,
		plan: [
			{ bars: 8, kind: 'intro' },
			{ bars: 16, kind: 'verse' },
			{ bars: 8, kind: 'build' },
			{ bars: 24, kind: 'drop' },
			{ bars: 8, kind: 'calm' },
			{ bars: 16, kind: 'drop' }
		]
	},
	{
		name: 'pop 100',
		bpm: 100,
		plan: [
			{ bars: 4, kind: 'intro' },
			{ bars: 16, kind: 'verse' },
			{ bars: 8, kind: 'drop' },
			{ bars: 16, kind: 'verse' },
			{ bars: 8, kind: 'drop' },
			{ bars: 4, kind: 'calm' }
		]
	},
	{
		name: 'rock 150',
		bpm: 150,
		plan: [
			{ bars: 4, kind: 'calm' },
			{ bars: 16, kind: 'verse' },
			{ bars: 16, kind: 'drop' },
			{ bars: 8, kind: 'verse' },
			{ bars: 16, kind: 'drop' }
		]
	}
] as { name: string; bpm: number; plan: Stretch[] }[];

const difficulties = (process.argv[2] ?? 'normal,hard,extreme').split(',') as Difficulty[];
const sounds = (process.argv[3] ?? 'heard,silent').split(',');

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
		const mode = w.sectionAt(e.time).mode;
		if (mode === 'ship' || mode === 'wave' || mode === 'swing') {
			out.push(e.time);
			return;
		}
		const release = l.plan.findIndex((u, n) => n > k && !u.down);
		const inputs = l.plan.filter((_, n) => n !== k && n !== release);
		const from = states[Math.max(0, Math.floor((e.time - 300 - l.start) / 250))];
		if (simulate(w, from, Math.min(l.end, e.time + 2500), inputs).dead) out.push(e.time);
	});
	return out;
}

const detail = process.argv[4];
if (detail) {
	const [name, difficulty, seed, sound] = detail.split(':');
	const sg = SONGS.find((x) => x.name.replace(' ', '') === name)!;
	const { chart, length } = song(
		sg.bpm,
		sg.plan,
		sg.bpm * 7 + (seed === 'p' ? 1 : 2),
		sound === 'heard'
	);
	const l = generateLevel(chart, { difficulty: difficulty as Difficulty, seed, duration: length });
	const w = l.world;
	const need = new Set(needed(l));
	for (const sec of w.sections.slice(1)) {
		const near = l.plan
			.filter((e) => e.time > sec.start - 400 && e.time < sec.start + 300)
			.map((e) => `${Math.round(e.time - sec.start)}${e.down ? 'v' : '^'}`);
		const st = simulate(w, startState(w, l.start), sec.start + 1, l.plan);
		console.log(`  edge ${sec.mode} ${sec.start}: held ${st.held} events ${near.join(' ')}`);
		if (sec.mode === 'robot' && sec.start > 32000 && sec.start < 34000) {
			const evs = l.plan
				.filter((e) => e.time > sec.start - 2000 && e.time < sec.start + 3000)
				.map((e) => `${Math.round(e.time)}${e.down ? 'v' : '^'}`);
			console.log('   plan', evs.join(' '));
			for (let t = sec.start - 100; t < sec.start + 1500; t += 200) {
				const q = simulate(w, startState(w, l.start), t, l.plan);
				console.log(
					'   ',
					Math.round(t),
					'held',
					q.held,
					'mode',
					q.mode,
					'y',
					q.y.toFixed(2),
					'grounded',
					q.grounded,
					'robotActive',
					(q as any).robotActive
				);
			}
		}
	}
	for (const sec of w.sections) {
		if (process.env.SHOW && sec.mode === process.env.SHOW) {
			const ps = l.plan.filter((e) => e.down && e.time >= sec.start && e.time < sec.end);
			console.log(
				'   presses',
				ps.map((e) => `${(e.time / 1000).toFixed(2)}${need.has(e.time) ? '' : '(x)'}`).join(' ')
			);
			console.log(
				'   notes',
				chart.notes
					.filter((n) => n.time >= sec.start && n.time < sec.end)
					.map((n) => (n.time / 1000).toFixed(2))
					.join(' ')
			);
		}
		const inX = (o: { x0: number; x1: number }) => o.x1 > sec.x0 && o.x0 < sec.x1;
		const presses = l.plan.filter((e) => e.down && e.time >= sec.start && e.time < sec.end);
		const notesIn = chart.notes.filter((n) => n.time >= sec.start && n.time < sec.end).length;
		console.log(
			`${sec.mode.padEnd(6)}${sec.mini ? '·' : ' '} ${(sec.start / 1000).toFixed(1).padStart(6)}-${(sec.end / 1000).toFixed(1).padEnd(6)} notes ${String(notesIn).padStart(3)} presses ${String(presses.length).padStart(3)} needed ${String(presses.filter((e) => need.has(e.time)).length).padStart(3)} hazards ${String(w.hazards.items.filter(inX).length).padStart(3)} solids ${String(w.solids.items.filter(inX).length).padStart(3)} orbs ${w.orbs.items.filter(inX).length} pads ${w.pads.items.filter(inX).length}`
		);
	}
	process.exit(0);
}
const rows: string[] = [];
for (const sound of sounds)
	for (const sg of SONGS)
		for (const difficulty of difficulties)
			for (const seed of ['p', 'q']) {
				const { chart, length } = song(
					sg.bpm,
					sg.plan,
					sg.bpm * 7 + (seed === 'p' ? 1 : 2),
					sound === 'heard'
				);
				const l = generateLevel(chart, { difficulty, seed, duration: length });
				const w = l.world;
				const need = needed(l);
				// A press at the wrong time in a spider or ball part, then nothing for 1.5 s: still alive?
				{
					let s0 = startState(w, l.start);
					let tries = 0;
					let free = 0;
					for (const sec of w.sections) {
						if (sec.mode !== 'spider' && sec.mode !== 'ball') continue;
						for (let t = sec.start + 600; t < sec.end - 1800; t += 500) {
							if (musicalRest(chart, t)) continue;
							s0 = simulate(w, startState(w, l.start), t, l.plan);
							if (s0.dead || !s0.grounded) continue;
							if (l.plan.some((e) => e.down && Math.abs(e.time - t) < 150)) continue;
							tries++;
							const later = l.plan.filter((e) => e.time < t);
							if (
								!simulate(w, s0, t + 1500, [
									...later,
									{ time: t + 10, down: true },
									{ time: t + 90, down: false }
								]).dead
							)
								free++;
						}
					}
					(globalThis as any).__wrong = ((globalThis as any).__wrong ?? 0) + free;
					(globalThis as any).__wrongTries = ((globalThis as any).__wrongTries ?? 0) + tries;
				}
				let heldEdges = 0;
				for (const sec of w.sections.slice(1))
					if (simulate(w, startState(w, l.start), sec.start + 1, l.plan).held) heldEdges++;
				(globalThis as any).__held = ((globalThis as any).__held ?? 0) + heldEdges;
				(globalThis as any).__edges = ((globalThis as any).__edges ?? 0) + w.sections.length - 1;
				const beat = 60000 / sg.bpm;
				let emptyParts = 0;
				let worst = 0;
				let worstAt = '';
				let unneeded = 0;
				const presses = l.plan.filter((e) => e.down).length;
				unneeded = presses - need.length;
				for (const sec of w.sections) {
					let rest = 0;
					for (let t = sec.start; t < sec.end; t += 100) if (musicalRest(chart, t)) rest += 100;
					if (rest > (sec.end - sec.start) * 0.5) continue;
					const own = need.filter((t) => t >= sec.start && t < sec.end);
					const pads = w.pads.items
						.map((p) => w.timeAt(p.x))
						.filter((t) => t >= sec.start && t < sec.end);
					const marks = [sec.start, ...[...own, ...pads].sort((a, b) => a - b), sec.end];
					let gap = 0;
					let gapAt = 0;
					for (let i = 1; i < marks.length; i++) {
						let r = 0;
						for (let t = marks[i - 1]; t < marks[i]; t += 100) if (musicalRest(chart, t)) r += 100;
						const g = marks[i] - marks[i - 1] - r;
						if (g > gap) {
							gap = g;
							gapAt = marks[i - 1];
						}
					}
					if (own.length + pads.length < ((sec.end - sec.start) / beat) * 0.2) emptyParts++;
					if (gap / beat > worst) {
						worst = gap / beat;
						worstAt = `${sec.mode}@${(gapAt / 1000).toFixed(1)}s`;
					}
				}
				rows.push(
					`${sound.padEnd(6)} ${sg.name.padEnd(9)} ${difficulty.padEnd(8)} ${seed}  parts ${String(w.sections.length).padStart(2)}  empty ${String(emptyParts).padStart(2)}  presses ${String(presses).padStart(4)} unneeded ${String(unneeded).padStart(3)} (${((100 * unneeded) / Math.max(1, presses)).toFixed(0).padStart(2)}%)  worst gap ${worst.toFixed(1).padStart(4)} beats ${worstAt}`
				);
			}
console.log(rows.join('\n'));
console.log(
	'a wrong switch, then nothing for 1.5 s, survived:',
	(globalThis as any).__wrong,
	'of',
	(globalThis as any).__wrongTries
);
console.log('held at a part start:', (globalThis as any).__held, 'of', (globalThis as any).__edges);
const st = (globalThis as any).__stat ?? [];
const by = new Map<string, { n: number; dead: number; built: number }>();
for (const x of st) {
	const r = by.get(x.mode) ?? { n: 0, dead: 0, built: 0 };
	r.n++;
	if (x.dead) r.dead++;
	r.built += x.built;
	by.set(x.mode, r);
}
console.log([...by].map(([m, r]) => `${m}: ${r.dead}/${r.n} dead after its builder`).join('\n'));
