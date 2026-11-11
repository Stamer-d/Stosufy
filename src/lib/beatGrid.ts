// The beat grid of a song, from its beatmap's timing points (the red lines): exact BPM,
// beats and bars, also for songs whose tempo changes. Times in seconds.

export interface GridPoint {
	/** Where the section starts (s) */
	time: number;
	/** One beat (s) */
	beat: number;
	/** Beats per bar */
	meter: number;
}

export type Grid = GridPoint[];

/** A grid from osu! timing points (ms) */
export function gridFrom(
	points: { time: number; beatLength: number; meter?: number }[] | undefined
): Grid {
	return (points ?? [])
		.filter((p) => p.beatLength > 0 && Number.isFinite(p.time))
		.map((p) => ({ time: p.time / 1000, beat: p.beatLength / 1000, meter: p.meter || 4 }))
		.sort((a, b) => a.time - b.time);
}

/** The section of the grid at a time (the first one before the song's first) */
export function sectionAt(grid: Grid, time: number): GridPoint | null {
	if (!grid.length) return null;
	let found = grid[0];
	for (const point of grid) {
		if (point.time <= time + 1e-6) found = point;
		else break;
	}
	return found;
}

/** The section that lasts longest: the song's main tempo */
export function mainSection(grid: Grid, duration: number): GridPoint | null {
	let best: GridPoint | null = null;
	let longest = -1;
	grid.forEach((point, i) => {
		const length = (grid[i + 1]?.time ?? duration) - point.time;
		if (length > longest) {
			longest = length;
			best = point;
		}
	});
	return best;
}

export function bpmOf(point: GridPoint | null) {
	return point ? 60 / point.beat : 0;
}

/** Where in its beat and bar a time is: beats since the section start, the fraction of the
 * beat (0–1) and the beat in the bar (0 up to the meter) */
export function phaseAt(grid: Grid, time: number) {
	const point = sectionAt(grid, time);
	if (!point) return null;
	const beats = (time - point.time) / point.beat;
	const beatPhase = beats - Math.floor(beats);
	const barBeats = ((beats % point.meter) + point.meter) % point.meter;
	return { point, beats, beatPhase, barBeats };
}

/** The nearest beat at or before a time */
export function beatFloor(grid: Grid, time: number) {
	const point = sectionAt(grid, time);
	if (!point) return time;
	return point.time + Math.floor((time - point.time) / point.beat + 1e-6) * point.beat;
}

/** The nearest beat to a time */
export function beatRound(grid: Grid, time: number) {
	const point = sectionAt(grid, time);
	if (!point) return time;
	return point.time + Math.round((time - point.time) / point.beat) * point.beat;
}

/** The first bar start after a time (or at it, within a hair) */
export function nextDownbeat(grid: Grid, time: number, after = 0.02) {
	const point = sectionAt(grid, time);
	if (!point) return time;
	const bar = point.beat * point.meter;
	const bars = Math.ceil((time + after - point.time) / bar);
	let at = point.time + bars * bar;
	const next = grid[grid.indexOf(point) + 1];
	if (next && at > next.time) at = next.time;
	return at;
}

/** The last bar start at or before a time */
export function downbeatFloor(grid: Grid, time: number) {
	const point = sectionAt(grid, time);
	if (!point) return time;
	const bar = point.beat * point.meter;
	return point.time + Math.floor((time - point.time) / bar + 1e-6) * bar;
}

/** Beats (with bars marked) in a time range, to draw the grid */
export function beatsIn(grid: Grid, from: number, to: number) {
	const beats: { time: number; downbeat: boolean }[] = [];
	grid.forEach((point, i) => {
		const end = grid[i + 1]?.time ?? Infinity;
		// Before the first section the grid goes on backwards
		const start = i === 0 ? -Infinity : point.time;
		const first = Math.max(Math.ceil((Math.max(from, start) - point.time) / point.beat), -100000);
		for (let k = first; ; k++) {
			const time = point.time + k * point.beat;
			if (time > to || time >= end) break;
			if (time < from) continue;
			beats.push({ time, downbeat: ((k % point.meter) + point.meter) % point.meter === 0 });
			if (beats.length > 2000) break;
		}
	});
	return beats;
}

/** The bar starts in a time range (all of them, for the song's analysis) */
export function downbeats(grid: Grid, from: number, to: number) {
	const times: number[] = [];
	grid.forEach((point, i) => {
		const end = Math.min(grid[i + 1]?.time ?? Infinity, to);
		const bar = point.beat * point.meter;
		const start = i === 0 ? from : Math.max(from, point.time);
		for (let k = Math.ceil((start - point.time) / bar - 1e-6); ; k++) {
			const time = point.time + k * bar;
			if (time >= end - 1e-6) break;
			times.push(time);
		}
	});
	return times;
}

/** The grid moved by some seconds (to where the beats are in the decoded audio) */
export function shiftGrid(grid: Grid, seconds: number): Grid {
	return grid.map((point) => ({ ...point, time: point.time + seconds }));
}

/**
 * Beats counted through the whole song, also across tempo changes (each section starts on a
 * whole beat): the beat a time is on, and back. To keep two songs' beats together in a mix.
 */
export function beatIndex(grid: Grid, time: number) {
	if (!grid.length) return 0;
	let count = 0;
	for (let i = 0; i < grid.length; i++) {
		const point = grid[i];
		const next = grid[i + 1];
		if (!next || time < next.time) return count + (time - point.time) / point.beat;
		count += Math.round((next.time - point.time) / point.beat);
	}
	return count;
}

export function beatTime(grid: Grid, index: number) {
	if (!grid.length) return index * 0.5;
	let count = 0;
	for (let i = 0; i < grid.length; i++) {
		const point = grid[i];
		const next = grid[i + 1];
		const beats = next ? Math.round((next.time - point.time) / point.beat) : Infinity;
		if (index < count + beats || !next) return point.time + (index - count) * point.beat;
		count += beats;
	}
	return 0;
}
