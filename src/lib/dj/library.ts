// Songs in the DJ mode: their tempo from the beatmap, and the song being dragged onto a deck

import { gridFrom, mainSection, bpmOf } from './grid';
import type { MapSet, StoredMapSet } from '../types';

const bpms = new Map<string, number>();

export function songKeyOf(song: MapSet) {
	return `${song.id}:${song.track ?? 0}`;
}

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

/** The song being dragged from the list (drag and drop within the page) */
let dragged: MapSet | null = null;

export function setDragged(song: MapSet | null) {
	dragged = song;
}

export function takeDragged() {
	const song = dragged;
	dragged = null;
	return song;
}

/** Makes an element take songs dragged from the list (data-dropping is set while over it) */
export function songDrop(node: HTMLElement, onSong: (song: MapSet) => void) {
	let handler = onSong;
	const over = (event: DragEvent) => {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		node.dataset.dropping = 'true';
	};
	const leave = (event: DragEvent) => {
		if (!node.contains(event.relatedTarget as Node)) delete node.dataset.dropping;
	};
	const drop = (event: DragEvent) => {
		event.preventDefault();
		delete node.dataset.dropping;
		const song = takeDragged();
		if (song) handler(song);
	};
	node.addEventListener('dragover', over);
	node.addEventListener('dragleave', leave);
	node.addEventListener('drop', drop);
	return {
		update(next: (song: MapSet) => void) {
			handler = next;
		},
		destroy() {
			node.removeEventListener('dragover', over);
			node.removeEventListener('dragleave', leave);
			node.removeEventListener('drop', drop);
		}
	};
}
