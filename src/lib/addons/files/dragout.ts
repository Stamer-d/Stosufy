// What was made, dragged out of the app: into a chat, a mail, a folder, as the file itself
// (the system's drag, see tauri-plugin-drag). A click is still a click: the drag starts once
// the pointer has moved a little with the button down.

import { startDrag } from '@crabnebula/tauri-plugin-drag';

const MOVE = 6;

/** A picture for the drag: a card with the file's extension on it (PNG, as a data URL) */
function icon(name: string) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 96;
	const context = canvas.getContext('2d')!;
	context.fillStyle = '#7c3aed';
	context.beginPath();
	context.roundRect(8, 4, 80, 88, 14);
	context.fill();
	const extension = (name.split('.').pop() ?? '').toUpperCase().slice(0, 4);
	context.fillStyle = '#fff';
	context.font = 'bold 22px system-ui, sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText(extension, 48, 50);
	return canvas.toDataURL('image/png');
}

/** Svelte action: the element drags these files out (paths on disk) */
export function dragOut(node: HTMLElement, paths: string[]) {
	let current = paths;
	let start: { x: number; y: number } | null = null;
	let dragging = false;

	const down = (event: PointerEvent) => {
		if (event.button !== 0 || !current.length) return;
		start = { x: event.clientX, y: event.clientY };
		dragging = false;
	};
	const move = (event: PointerEvent) => {
		if (!start || dragging || !(event.buttons & 1)) return;
		if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < MOVE) return;
		dragging = true;
		start = null;
		startDrag({ item: current, icon: icon(current[0]) }).catch((error) =>
			console.warn('Could not drag it out:', error)
		);
	};
	const up = () => (start = null);
	// (after a drag, no click on it)
	const click = (event: MouseEvent) => {
		if (!dragging) return;
		dragging = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	node.addEventListener('click', click, true);
	node.draggable = false;
	return {
		update(paths: string[]) {
			current = paths;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			node.removeEventListener('click', click, true);
		}
	};
}
