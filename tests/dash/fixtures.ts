// Beatmaps for the Dash tests, written on the spot: a song of some BPM and length, calm or
// intense or both, with a kiai and a break where asked. Always the same for the same options.

import type { SongSound } from '../../src/lib/addons/dash/audio';

export interface SongOptions {
	bpm: number;
	/** Seconds */
	length: number;
	/** Where the first beat is (ms) */
	offset?: number;
	/** calm: a note on most beats; intense: eighths, streams, finishes; mixed: calm, then intense */
	style: 'calm' | 'intense' | 'mixed';
	kiai?: [number, number][];
	/** Where the mapper's sliders go faster (from, to, how much) */
	sv?: [number, number, number][];
	/**
	 * A build-up (a snare roll getting louder, no kick; streams in the map) and the drop after it
	 * (kick and eighths, as intense), without a kiai
	 */
	buildup?: [number, number];
	drop?: [number, number];
	/** Where the song is louder still (at the same tempo and notes): from, to, how loud (1.1) */
	louder?: [number, number, number?][];
	breaks?: [number, number][];
	/** A slider every so many notes (0: none) */
	sliders?: number;
	/**
	 * Another BPM from a time on (ms). The map's timing point for it may be set elsewhere than
	 * where the song changes (`mapAt`, on the new grid), or its beats a few ms off the song's
	 * (`shift`, the notes after it snapped to them with them)
	 */
	change?: { at: number; bpm: number; mapAt?: number; shift?: number };
	title?: string;
}

/** A small random number generator (the same numbers for the same seed) */
function numbers(seed: number) {
	let s = seed || 1;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The text of an .osu file */
export function makeOsu(options: SongOptions) {
	const { bpm, length, style } = options;
	const offset = options.offset ?? 1000;
	let beat = 60000 / bpm;
	const end = length * 1000;
	const rnd = numbers(Math.round(bpm * 31 + length * 7 + style.length));
	const change = options.change;
	const kiai = options.kiai ?? [];
	const breaks = options.breaks ?? [];
	const lines: string[] = [
		'osu file format v14',
		'',
		'[General]',
		'Mode: 0',
		'',
		'[Metadata]',
		`Title:${options.title ?? `Test ${style} ${bpm}`}`,
		'Artist:Tests',
		'Creator:tests',
		`Version:${style}`,
		'',
		'[Difficulty]',
		'CircleSize:4',
		'SliderMultiplier:1.4',
		'',
		'[Events]',
		...breaks.map(([a, b]) => `2,${a},${b}`),
		'',
		'[TimingPoints]',
		`${offset},${beat},4,2,0,70,1,0`,
		...(change
			? [`${(change.mapAt ?? change.at) + (change.shift ?? 0)},${60000 / change.bpm},4,2,0,70,1,0`]
			: [])
	];
	for (const [a, b] of kiai) lines.push(`${a},-100,4,2,0,80,0,1`, `${b},-100,4,2,0,70,0,0`);
	for (const [a, b, by] of options.sv ?? [])
		lines.push(`${a + 1},${-100 / by},4,2,0,70,0,0`, `${b + 1},-100,4,2,0,70,0,0`);
	lines.push('', '[HitObjects]');

	const intenseAt = (t: number) =>
		style === 'intense' ||
		(style === 'mixed' && t > end / 2) ||
		kiai.some(([a, b]) => t >= a && t < b) ||
		(!!options.drop && t >= options.drop[0] && t < options.drop[1]);
	const rolling = (t: number) =>
		!!options.buildup && t >= options.buildup[0] && t < options.buildup[1];
	let x = 256;
	let y = 192;
	let count = 0;
	/** A note's time in the map (after the change, off as far as its timing point is) */
	const when = (t: number) =>
		Math.round(t + (change && t >= change.at - 1 ? (change.shift ?? 0) : 0));
	let base = offset;
	for (let t = offset; t < end - 1500;) {
		if (change && t >= change.at && base !== change.at) {
			t = base = change.at;
			beat = 60000 / change.bpm;
		}
		const inBreak = breaks.some(([a, b]) => t > a - 200 && t < b + 200);
		const intense = intenseAt(t);
		const beatIndex = Math.round((t - base) / beat);
		if (!inBreak) {
			const downbeat = Math.abs((t - base) / beat - beatIndex) < 0.01 && beatIndex % 4 === 0;
			x = Math.max(40, Math.min(472, x + (rnd() - 0.5) * (intense ? 300 : 120)));
			y = Math.max(40, Math.min(344, y + (rnd() - 0.5) * (intense ? 220 : 90)));
			const sound = downbeat && intense ? 4 : rnd() < 0.15 ? 8 : 0;
			const combo = downbeat ? 4 : 0;
			const slider = options.sliders && count % options.sliders === options.sliders - 1;
			if (slider)
				lines.push(
					`${Math.round(x)},${Math.round(y)},${when(t)},${2 | combo},${sound},B|${Math.round(x + 80)}:${Math.round(y)},1,140`
				);
			else
				lines.push(`${Math.round(x)},${Math.round(y)},${when(t)},${1 | combo},${sound},0:0:0:0:`);
			count++;
			if (slider) {
				t += beat * 2;
				continue;
			}
		}
		// Calm: a beat (now and then two); intense: eighths, now and then a run of sixteenths; a
		// build-up: a stream
		if (rolling(t)) t += beat / 4;
		else if (!intense) t += rnd() < 0.2 ? beat * 2 : beat;
		else if (rnd() < 0.12) {
			for (let k = 1; k < 4 && t + (beat / 4) * k < end - 1500; k++)
				lines.push(
					`${Math.round(x + k * 20)},${Math.round(y)},${when(t + (beat / 4) * k)},1,0,0:0:0:0:`
				);
			t += beat;
		} else t += beat / 2;
	}
	return lines.join('\n');
}

/** How the song sounds: loud where it's intense (and in the kiai), quiet in the breaks */
export function makeSound(options: SongOptions): SongSound {
	const hop = 10;
	const frames = Math.ceil((options.length * 1000) / hop);
	const loud = new Float32Array(frames);
	const end = options.length * 1000;
	for (let n = 0; n < frames; n++) {
		const t = n * hop;
		const intense =
			options.style === 'intense' ||
			(options.style === 'mixed' && t > end / 2) ||
			(options.kiai ?? []).some(([a, b]) => t >= a && t < b);
		const quiet = (options.breaks ?? []).some(([a, b]) => t > a && t < b);
		loud[n] = quiet ? 0.12 : intense ? 0.9 : 0.45;
	}
	return { hop, loud };
}

/**
 * The song as sound: a fake AudioBuffer (mono, 22 050 Hz) with a kick on every beat and a
 * hi-hat on every off-beat, louder where it's intense, almost silent in the breaks; and when
 * the kicks and hats are (ms)
 */
export function makeAudio(options: SongOptions) {
	const rate = 22050;
	const length = Math.floor(options.length * rate);
	const data = new Float32Array(length);
	const offset = options.offset ?? 1000;
	const end = options.length * 1000;
	const rnd = numbers(7);
	const kicks: number[] = [];
	const hats: number[] = [];
	// (half beats: on the song's tempo, and its other one from where it changes)
	const halves: { t: number; kick: boolean }[] = [];
	const change = options.change;
	let kick = true;
	for (let t = offset, beat = 60000 / options.bpm; t < end - 500; t += beat / 2) {
		if (change && t >= change.at - 1 && beat !== 60000 / change.bpm) {
			t = change.at;
			beat = 60000 / change.bpm;
			kick = true;
		}
		halves.push({ t, kick });
		kick = !kick;
	}
	for (const { t, kick } of halves) {
		const quiet = (options.breaks ?? []).some(([a, b]) => t > a && t < b);
		const intense =
			options.style === 'intense' ||
			(options.style === 'mixed' && t > end / 2) ||
			(options.kiai ?? []).some(([a, b]) => t >= a && t < b) ||
			(!!options.drop && t >= options.drop[0] && t < options.drop[1]);
		const louder = (options.louder ?? []).find(([a, b]) => t >= a && t < b);
		const gain = quiet ? 0.03 : louder ? (louder[2] ?? 1.1) : intense ? 0.8 : 0.4;
		const start = Math.floor((t / 1000) * rate);
		const roll = options.buildup;
		if (roll && t >= roll[0] && t < roll[1]) {
			// (the roll: a snare on every half beat, louder and louder, no kick)
			const up = 0.5 + (0.5 * (t - roll[0])) / (roll[1] - roll[0]);
			hats.push(t);
			for (let i = 0; i < rate * 0.07 && start + i < length; i++)
				data[start + i] += up * 0.9 * (rnd() * 2 - 1) * Math.exp(-i / (0.02 * rate));
		} else if (kick) {
			kicks.push(t);
			for (let i = 0; i < rate * 0.15 && start + i < length; i++)
				data[start + i] +=
					gain * Math.sin((2 * Math.PI * 55 * i) / rate) * Math.exp(-i / (0.05 * rate));
		} else {
			hats.push(t);
			for (let i = 0; i < rate * 0.04 && start + i < length; i++)
				data[start + i] += gain * 0.35 * (rnd() * 2 - 1) * Math.exp(-i / (0.008 * rate));
		}
	}
	const buffer = {
		sampleRate: rate,
		length,
		numberOfChannels: 1,
		duration: options.length,
		getChannelData: () => data
	} as unknown as AudioBuffer;
	return { buffer, kicks, hats };
}
