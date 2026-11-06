import { beatStrength, type DashChart } from './chart';
import { hitAt, loudness } from './audio';

export type Theme = 'pulse' | 'steps' | 'leaps' | 'sustain';
export interface MusicalPhrase {
	start: number;
	end: number;
	key: string;
	rhythm: string;
	theme: Theme;
}

/** Musical coordinates stay tied to timing points, including BPM and meter changes. */
export function musicalPosition(chart: DashChart, time: number) {
	let point = chart.timing[0];
	for (const p of chart.timing) {
		if (p.time <= time + 1e-6) point = p;
		else break;
	}
	const beat = (time - point.time) / point.beatLength;
	const bar = Math.floor((beat + 1e-6) / point.meter);
	const pair = Math.floor(bar / 2);
	const start = point.time + pair * point.meter * point.beatLength * 2;
	const next = chart.timing.find((p) => p.time > time)?.time ?? Infinity;
	return {
		beat,
		bar,
		inBar: beat - bar * point.meter,
		start,
		end: Math.min(next, start + point.meter * point.beatLength * 2),
		key: `${point.time}:${pair}`,
		point
	};
}

/**
 * How hard the song hits at a moment (0–1): what's heard there (its hits and kick), else how
 * strong the beat is there. Where a level's events go: a portal, a pad, a new part
 */
export function accentAt(chart: DashChart, time: number) {
	const sound = chart.sound;
	if (!sound?.hits) return beatStrength(chart.timing, time) * 0.8;
	let kick = 0;
	if (sound.kicks) {
		const a = Math.max(0, Math.floor((time - 30) / sound.hop));
		const b = Math.min(sound.kicks.length - 1, Math.ceil((time + 30) / sound.hop));
		for (let n = a; n <= b; n++) kick = Math.max(kick, sound.kicks[n]);
	}
	return Math.min(1, hitAt(sound, time) * 0.6 + kick * 0.4);
}

/** Rest is a level-design decision from real data, never a random empty column. */
export function musicalRest(chart: DashChart, time: number) {
	return (
		chart.breaks.some((b) => time >= b.start && time < b.end) ||
		(!!chart.sound && loudness(chart.sound, time - 150, time + 150) < 0.05)
	);
}

/** A phrase program for the actual selected clicks, not a library of prebuilt levels. */
export function composePhrases(chart: DashChart, clicks: number[]): MusicalPhrase[] {
	const groups = new Map<
		string,
		{ position: ReturnType<typeof musicalPosition>; times: number[] }
	>();
	for (const time of clicks) {
		const position = musicalPosition(chart, time);
		let group = groups.get(position.key);
		if (!group) groups.set(position.key, (group = { position, times: [] }));
		group.times.push(time);
	}
	return [...groups.values()].map(({ position: p, times }) => {
		const slots = times.map((t) => Math.round(((t - p.start) / p.point.beatLength) * 4));
		const notes = chart.notes.filter((n) => n.time >= p.start && n.time < p.end);
		const held = notes.reduce((sum, n) => sum + Math.max(0, Math.min(n.end, p.end) - n.time), 0);
		const density = times.length / (p.point.meter * 2);
		const theme: Theme =
			held > (p.end - p.start) * 0.35
				? 'sustain'
				: density >= 0.85
					? 'leaps'
					: density >= 0.45
						? 'steps'
						: 'pulse';
		return {
			start: p.start,
			end: p.end,
			key: p.key,
			// Meter is part of the signature: 3/4 and 4/4 are different phrases.
			rhythm: `${p.point.meter}:${slots.join(',')}`,
			theme
		};
	});
}

/**
 * The phrase a click is in. By its musical key, not by its start and end: a note a hair before a
 * bar line counts in the next bar (see `musicalPosition`), and would fall between two phrases.
 */
export function phraseAt(chart: DashChart, phrases: MusicalPhrase[], time: number) {
	const key = musicalPosition(chart, time).key;
	return (
		phrases.find((p) => p.key === key) ??
		phrases.find((p) => time >= p.start && time < p.end) ??
		phrases.reduce((best, p) => (Math.abs(p.start - time) < Math.abs(best.start - time) ? p : best))
	);
}

export function patternFamily(id: string) {
	return id.replace(/[\d-]+s?$/, '');
}

export const THEME_FAMILIES: Record<Theme, readonly string[]> = {
	pulse: ['spikes', 'hop', 'pillar', 'saw'],
	steps: ['stairs', 'leap', 'hop', 'gap'],
	leaps: ['leap', 'gap', 'orbPit', 'padOrb'],
	sustain: ['dash', 'padOver', 'padUp', 'leap']
};

/** Replay the feasible motif first; keep fallbacks for changed landing states. */
export function orderPatterns<T extends { id: string }>(
	patterns: T[],
	wanted: string | undefined,
	theme: Theme,
	established: Set<string>,
	position = 0
) {
	const familyPlan = THEME_FAMILIES[theme];
	const preferred = familyPlan[position % 2];
	const rank = (p: T) => {
		if (p.id === wanted) return 0;
		const family = patternFamily(p.id);
		if (wanted && family === patternFamily(wanted)) return 1;
		if (family === preferred) return 2;
		if (established.has(family)) return 3;
		if (established.size < 2 && familyPlan.includes(family)) return 4;
		return 5;
	};
	return patterns
		.map((p, index) => ({ p, index }))
		.sort((a, b) => rank(a.p) - rank(b.p) || a.index - b.index)
		.map(({ p }) => p);
}
