// Reads the hitsounds of a beatmap (.osu): when which samples play, like osu! does with
// autoplay. Circles, the heads, repeats, ends and ticks of sliders, the ends of spinners
// and the notes of taiko and mania; the slider slide isn't played.

export type SampleSet = 'normal' | 'soft' | 'drum';
export type HitSound = 'normal' | 'whistle' | 'finish' | 'clap' | 'slidertick';

export interface HitSample {
	set: SampleSet;
	sound: HitSound;
	/** Custom sample index: 0 = the skin's, 1 = the beatmap's without a number, 2+ numbered */
	index: number;
	/** A file of the beatmap that replaces the samples (mania keysounds) */
	file?: string;
}

export interface HitsoundEvent {
	/** Milliseconds into the song */
	time: number;
	/** 0–100 */
	volume: number;
	samples: HitSample[];
}

interface TimingPoint {
	time: number;
	beatLength: number;
	sampleSet: number;
	sampleIndex: number;
	volume: number;
	uninherited: boolean;
}

const SETS: Record<number, SampleSet> = { 1: 'normal', 2: 'soft', 3: 'drum' };

function sections(content: string) {
	const result: Record<string, string[]> = {};
	let current = '';
	for (const raw of content.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('//')) continue;
		const header = line.match(/^\[(.+)\]$/);
		if (header) {
			current = header[1];
			result[current] ??= [];
		} else if (current) result[current].push(line);
	}
	return result;
}

function value(lines: string[] | undefined, key: string) {
	const line = lines?.find((l) => l.toLowerCase().startsWith(key.toLowerCase() + ':'));
	return line?.slice(line.indexOf(':') + 1).trim();
}

function parseTimingPoints(lines: string[] = []): TimingPoint[] {
	return lines
		.map((line) => {
			const p = line.split(',');
			const beatLength = Number(p[1]);
			return {
				time: Number(p[0]),
				beatLength,
				sampleSet: Number(p[3] ?? 0),
				sampleIndex: Number(p[4] ?? 0),
				volume: Number(p[5] ?? 100),
				uninherited: p[6] === undefined ? beatLength > 0 : p[6] === '1'
			};
		})
		.filter((point) => isFinite(point.time) && isFinite(point.beatLength))
		.sort((a, b) => a.time - b.time);
}

/** The last point at or before a time (osu! counts a point a few ms early as active) */
function pointAt<T extends { time: number }>(points: T[], time: number): T | undefined {
	let found: T | undefined;
	for (const point of points) {
		if (point.time <= time + 2) found = point;
		else break;
	}
	return found ?? points[0];
}

export function parseHitsounds(content: string): HitsoundEvent[] {
	const parsed = sections(content);
	const generalSet =
		({ normal: 'normal', soft: 'soft', drum: 'drum' } as Record<string, SampleSet>)[
			(value(parsed.General, 'SampleSet') ?? 'Normal').toLowerCase()
		] ?? 'normal';
	const sliderMultiplier = Number(value(parsed.Difficulty, 'SliderMultiplier') ?? 1.4) || 1.4;
	const tickRate = Number(value(parsed.Difficulty, 'SliderTickRate') ?? 1) || 1;
	// Ticks only in osu! standard (taiko and mania have no slider ticks)
	const standard = (Number(value(parsed.General, 'Mode') ?? 0) || 0) === 0;
	const points = parseTimingPoints(parsed.TimingPoints);
	const uninherited = points.filter((point) => point.uninherited);
	const events: HitsoundEvent[] = [];

	/** One hit: the hitnormal and the additions of its hitSound bits */
	const hit = (
		time: number,
		hitSound: number,
		normalSet: number,
		additionSet: number,
		index = 0,
		volume = 0,
		file = ''
	) => {
		const point = pointAt(points, time);
		const normal = SETS[normalSet] ?? SETS[point?.sampleSet ?? 0] ?? generalSet;
		const addition = SETS[additionSet] ?? normal;
		const sampleIndex = index || point?.sampleIndex || 0;
		const samples: HitSample[] = file
			? [{ set: normal, sound: 'normal', index: sampleIndex, file }]
			: [
					{ set: normal, sound: 'normal', index: sampleIndex },
					...(['whistle', 'finish', 'clap'] as const)
						.filter((_, bit) => hitSound & (2 << bit))
						.map((sound) => ({ set: addition, sound, index: sampleIndex }))
				];
		events.push({ time, volume: volume || point?.volume || 100, samples });
	};

	for (const line of parsed.HitObjects ?? []) {
		const p = line.split(',');
		const time = Number(p[2]);
		const type = Number(p[3]);
		const hitSound = Number(p[4]) || 0;
		if (!isFinite(time)) continue;
		const sample = (text: string | undefined) => {
			const [normalSet, additionSet, index, volume, file] = (text ?? '').split(':');
			return [
				Number(normalSet) || 0,
				Number(additionSet) || 0,
				Number(index) || 0,
				Number(volume) || 0,
				file ?? ''
			] as const;
		};

		if (type & 2) {
			// Slider: a hit at the head, every repeat and the end
			const slides = Math.max(1, Number(p[6]) || 1);
			const length = Number(p[7]) || 0;
			const beat = pointAt(uninherited, time)?.beatLength ?? 500;
			const inherited = pointAt(points, time);
			const velocity =
				inherited && !inherited.uninherited && inherited.beatLength < 0
					? Math.min(10, Math.max(0.1, -100 / inherited.beatLength))
					: 1;
			const span = (length / (sliderMultiplier * 100 * velocity)) * beat;
			const edgeSounds = (p[8] ?? '').split('|');
			const edgeSets = (p[9] ?? '').split('|');
			const [, , index, volume] = sample(p[10]);
			// The ticks in between: every beat / tick rate along each span, not too close to
			// its ends, with the slider's normal sample set (like osu!)
			if (standard && span > 0) {
				const every = beat / tickRate;
				const [normalSet] = sample(p[10]);
				for (let slide = 0; slide < slides && every > 0; slide++) {
					for (let at = every; at < span - 10; at += every) {
						const tickTime = time + slide * span + (slide % 2 ? span - at : at);
						const point = pointAt(points, tickTime);
						const set = SETS[normalSet] ?? SETS[point?.sampleSet ?? 0] ?? generalSet;
						events.push({
							time: Math.round(tickTime),
							volume: point?.volume || 100,
							samples: [{ set, sound: 'slidertick', index: point?.sampleIndex ?? 0 }]
						});
					}
				}
			}
			for (let edge = 0; edge <= slides; edge++) {
				const [normalSet, additionSet] = (edgeSets[edge] ?? '0:0').split(':').map(Number);
				const sound = edgeSounds[edge] !== undefined ? Number(edgeSounds[edge]) || 0 : hitSound;
				hit(Math.round(time + edge * span), sound, normalSet || 0, additionSet || 0, index, volume);
			}
		} else if (type & 8) {
			// Spinner: when it ends
			hit(Number(p[5]) || time, hitSound, ...sample(p[6]));
		} else if (type & 128) {
			// Mania hold note: "endTime:hitSample"
			hit(time, hitSound, ...sample((p[5] ?? '').split(':').slice(1).join(':')));
		} else {
			hit(time, hitSound, ...sample(p[5]));
		}
	}
	return events.sort((a, b) => a.time - b.time);
}
