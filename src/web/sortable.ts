// Moving the songs of a list by dragging their handle (≡): the row follows the finger, the
// others make room, near the top or the bottom of the screen the page scrolls along. Let go,
// it says where the song went. (All rows are as high as each other.)

import { haptic } from './haptics';

interface Options {
	/** The song at `from` goes to `to` */
	onmove: (from: number, to: number) => void;
	/** What scrolls along near its edges, if not the page (a list scrolling in itself) */
	scroller?: HTMLElement | null;
}

const EDGE = 90;

export function sortable(list: HTMLElement, options: Options) {
	let opts = options;
	let drag: {
		row: HTMLElement;
		rows: HTMLElement[];
		from: number;
		to: number;
		height: number;
		startY: number;
		startScroll: number;
		y: number;
		pointer: number;
		frame: number;
	} | null = null;

	const scrolled = () => (opts.scroller ? opts.scroller.scrollTop : window.scrollY);

	function place() {
		if (!drag) return;
		const moved = drag.y - drag.startY + (scrolled() - drag.startScroll);
		const to = Math.max(
			0,
			Math.min(drag.rows.length - 1, drag.from + Math.round(moved / drag.height))
		);
		if (to !== drag.to) haptic();
		drag.to = to;
		drag.row.style.transform = `translateY(${moved}px)`;
		drag.rows.forEach((row, i) => {
			if (row === drag!.row) return;
			const shift =
				drag!.from < to && i > drag!.from && i <= to
					? -drag!.height
					: drag!.from > to && i < drag!.from && i >= to
						? drag!.height
						: 0;
			row.style.transform = shift ? `translateY(${shift}px)` : '';
		});
	}

	/** Near the edges the page scrolls, as long as the finger stays there */
	function scrollAlong() {
		if (!drag) return;
		// (not before the finger moved: a row near the edge would scroll right away)
		if (Math.abs(drag.y - drag.startY) < 12) {
			drag.frame = requestAnimationFrame(scrollAlong);
			return;
		}
		const box = opts.scroller?.getBoundingClientRect();
		const top = box ? box.top : 0;
		const bottom = box ? box.bottom : window.innerHeight - 150;
		const edge = box ? Math.min(EDGE, box.height / 4) : EDGE;
		const speed =
			drag.y < top + edge
				? -(top + edge - drag.y) / 6
				: drag.y > bottom - edge
					? (drag.y - bottom + edge) / 6
					: 0;
		if (speed) {
			if (opts.scroller) opts.scroller.scrollBy(0, speed);
			else window.scrollBy(0, speed);
			place();
		}
		drag.frame = requestAnimationFrame(scrollAlong);
	}

	function down(event: PointerEvent) {
		const handle = (event.target as HTMLElement).closest('[data-handle]');
		if (!handle || drag) return;
		const row = handle.closest('li') as HTMLElement;
		const rows = [...list.children].filter((child) => child.tagName === 'LI') as HTMLElement[];
		const from = rows.indexOf(row);
		if (from < 0) return;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		drag = {
			row,
			rows,
			from,
			to: from,
			height: row.getBoundingClientRect().height,
			startY: event.clientY,
			startScroll: scrolled(),
			y: event.clientY,
			pointer: event.pointerId,
			frame: 0
		};
		for (const other of rows) other.style.transition = other === row ? 'none' : 'transform 150ms';
		row.style.position = 'relative';
		row.style.zIndex = '5';
		row.classList.add('dragging');
		haptic('medium');
		drag.frame = requestAnimationFrame(scrollAlong);
	}

	function move(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointer) return;
		drag.y = event.clientY;
		place();
	}

	function up(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointer) return;
		const { from, to, rows, row, frame } = drag;
		cancelAnimationFrame(frame);
		drag = null;
		for (const other of rows) {
			other.style.transition = '';
			other.style.transform = '';
		}
		row.style.zIndex = '';
		row.style.position = '';
		row.classList.remove('dragging');
		if (from !== to) opts.onmove(from, to);
	}

	list.addEventListener('pointerdown', down);
	list.addEventListener('pointermove', move);
	list.addEventListener('pointerup', up);
	list.addEventListener('pointercancel', up);
	return {
		update(next: Options) {
			opts = next;
		},
		destroy() {
			list.removeEventListener('pointerdown', down);
			list.removeEventListener('pointermove', move);
			list.removeEventListener('pointerup', up);
			list.removeEventListener('pointercancel', up);
		}
	};
}
