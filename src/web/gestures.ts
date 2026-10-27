// use:swipe: a finger dragging an element, across or down (whichever way it starts going);
// the element follows it, and lets go with `onswipe` when it went far or fast enough.

interface SwipeOptions {
	/** Which way it can be dragged */
	axis: 'x' | 'y';
	/** Dragged far or fast enough: `direction` is -1 (left/up) or 1 (right/down) */
	onswipe: (direction: -1 | 1) => void;
	/** Only down (y) or only these directions count */
	only?: -1 | 1;
}

const FAR = 80;
const FAST = 0.5; // px/ms

export function swipe(node: HTMLElement, options: SwipeOptions) {
	let current = options;
	let start: { x: number; y: number; time: number } | null = null;
	let dragging = false;
	let offset = 0;

	const place = (value: number, animate: boolean) => {
		node.style.transition = animate ? 'transform 200ms ease-out' : 'none';
		node.style.transform =
			current.axis === 'x' ? `translateX(${value}px)` : `translateY(${value}px)`;
	};

	function down(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// (sliders and fields keep their own dragging)
		if ((event.target as HTMLElement).closest('input, textarea, [data-no-swipe]')) return;
		// (scrolled down in it: dragging down scrolls back up first)
		if (current.axis === 'y' && node.scrollTop > 0) return;
		start = { x: event.clientX, y: event.clientY, time: performance.now() };
		dragging = false;
		offset = 0;
	}

	function move(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (!dragging) {
			// Which way it's going: the other way is scrolling, not this
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			const across = Math.abs(dx) > Math.abs(dy);
			if (across !== (current.axis === 'x')) {
				start = null;
				return;
			}
			dragging = true;
			node.setPointerCapture?.(event.pointerId);
		}
		let value = current.axis === 'x' ? dx : dy;
		if (current.only && Math.sign(value) !== current.only) value /= 4;
		offset = value;
		place(value, false);
	}

	function up(event: PointerEvent) {
		if (!start) return;
		const wasDragging = dragging;
		const time = performance.now() - start.time;
		start = null;
		dragging = false;
		if (!wasDragging) return;
		// (the drag isn't a tap on what's under the finger)
		const stopClick = (click: Event) => {
			click.stopPropagation();
			click.preventDefault();
		};
		node.addEventListener('click', stopClick, { capture: true, once: true });
		setTimeout(() => node.removeEventListener('click', stopClick, { capture: true }), 50);
		const direction = Math.sign(offset) as -1 | 1;
		const counts =
			(Math.abs(offset) > FAR || Math.abs(offset) / time > FAST) &&
			(!current.only || direction === current.only);
		if (counts) current.onswipe(direction);
		place(0, true);
		if (event.type === 'pointercancel') place(0, true);
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);
	node.style.touchAction = options.axis === 'x' ? 'pan-y' : 'pan-x';
	return {
		update(next: SwipeOptions) {
			current = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
		}
	};
}
