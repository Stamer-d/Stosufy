// A song's tempo, from its beatmap's timing

import { gridFrom, mainSection, bpmOf } from './beatGrid';
import type { MapSet, StoredMapSet } from './types';

const bpms = new Map<string, number>();

/** A song's main tempo (BPM, rounded), from its beatmap's timing */
export function songBpm(song: MapSet, data: Record<string, StoredMapSet>) {
	const key = `${song.id}:${song.beatmaps?.[0]?.id}`;
	if (!bpms.has(key)) {
		const stored = data[song.id];
		const map =
			stored?.beatmaps?.[String(song.beatmaps?.[0]?.id)] ??
			Object.values(stored?.beatmaps ?? {})[0];
		const grid = gridFrom(map?.timing);
		const length = Number(map?.total_length) || (grid.at(-1)?.time ?? 0) + 120;
		bpms.set(key, Math.round(bpmOf(mainSection(grid, length))));
	}
	return bpms.get(key)!;
}
