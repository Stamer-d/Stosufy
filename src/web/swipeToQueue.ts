// use:swipeToQueue on a song's row: dragged to the right (as in Spotify) it shows "add to
// queue" behind it; let go past the mark, the song goes to the queue. The row springs back
// either way. Across only: going up or down is the page scrolling.

import { haptic } from './haptics';

/** Where the edge's back swipe starts: not this */
const EDGE = 28;
const SPRING = 'transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1)';

export function swipeToQueue(row: HTMLElement, onqueue: () => void) {
	let action = onqueue;
	let start: { x: number; y: number } | null = null;
	let dragging = false;
	let past = false;
	let offset = 0;
	let behind: HTMLElement | null = null;

	const mark = () => Math.min(110, row.offsetWidth * 0.3);
	const parts = () => [...row.children].filter((child) => child !== behind) as HTMLElement[];

	function place(value: number, transition = 'none') {
		for (const part of parts()) {
			part.style.transition = transition;
			part.style.transform = value ? `translate3d(${value}px, 0, 0)` : '';
		}
		if (behind) {
			behind.style.transition = transition.replace('transform', 'width');
			// (up to where the row's content starts, past its own padding)
			behind.style.width = value ? `${value + 8}px` : '0px';
		}
	}

	function down(event: TouchEvent) {
		start = null;
		if (event.touches.length > 1) return;
		const touch = event.touches[0];
		const target = event.target as HTMLElement;
		if (touch.clientX <= EDGE || target.closest('[data-handle], input')) return;
		start = { x: touch.clientX, y: touch.clientY };
		dragging = false;
		past = false;
		offset = 0;
	}

	function move(event: TouchEvent) {
		if (!start) return;
		const touch = event.touches[0];
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (!dragging) {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			// (to the right, more across than down: else it's not this)
			if (dx <= 0 || Math.abs(dy) >= Math.abs(dx)) return void (start = null);
			dragging = true;
			behind = document.createElement('div');
			behind.className =
				'absolute inset-y-0 left-0 rounded-md flex items-center pl-4 overflow-hidden bg-white/[0.06] text-white/70 pointer-events-none';
			behind.innerHTML =
				'<span class="icon-[mingcute--list-check-line] size-6 shrink-0 transition-transform"></span>';
			row.style.position = 'relative';
			row.prepend(behind);
		}
		if (event.cancelable) event.preventDefault();
		// (past the mark it gives a little only, like a rubber band)
		const limit = mark();
		offset = dx <= limit ? dx : limit + Math.sqrt(dx - limit) * 4;
		const now = dx >= limit;
		if (now !== past) {
			past = now;
			if (now) haptic();
			// (one color or the other: both at once, the stylesheet's order would decide)
			behind!.classList.toggle('bg-primary-400', now);
			behind!.classList.toggle('text-black', now);
			behind!.classList.toggle('bg-white/[0.06]', !now);
			behind!.classList.toggle('text-white/70', !now);
			(behind!.firstElementChild as HTMLElement).style.transform = now ? 'scale(1.2)' : '';
		}
		place(offset);
	}

	function up() {
		if (!start) return;
		start = null;
		if (!dragging) return;
		dragging = false;
		// (the drag isn't a tap on what's under the finger)
		const stopClick = (click: Event) => {
			click.stopPropagation();
			click.preventDefault();
		};
		row.addEventListener('click', stopClick, { capture: true, once: true });
		setTimeout(() => row.removeEventListener('click', stopClick, { capture: true }), 50);
		if (past) action();
		place(0, SPRING);
		const gone = behind;
		behind = null;
		setTimeout(() => {
			gone?.remove();
			for (const part of parts()) part.style.transition = '';
		}, 240);
	}

	function cancel() {
		if (!start) return;
		past = false;
		up();
	}

	row.addEventListener('touchstart', down, { passive: true });
	row.addEventListener('touchmove', move, { passive: false });
	row.addEventListener('touchend', up);
	row.addEventListener('touchcancel', cancel);
	return {
		update(next: () => void) {
			action = next;
		},
		destroy() {
			row.removeEventListener('touchstart', down);
			row.removeEventListener('touchmove', move);
			row.removeEventListener('touchend', up);
			row.removeEventListener('touchcancel', cancel);
		}
	};
}
