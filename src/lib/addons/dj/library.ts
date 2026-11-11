// Songs in the DJ mode: the song being dragged onto a deck

import type { MapSet } from '../../types';

export function songKeyOf(song: MapSet) {
	return `${song.id}:${song.track ?? 0}`;
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
