// use:swipe: a finger dragging an element, across or down (whichever way it starts going);
// the element follows it, and lets go with `onswipe` when it went far enough or the finger
// was still moving fast at the end (a flick). Then it goes on from where it is (the page
// closing it slides it out from there); else it springs back.
// Touch events: once it's dragging, the browser's own scrolling is held off (on iOS pointer
// events give up when the browser starts to scroll, and the drag stops halfway).

import { haptic } from './haptics';

interface SwipeOptions {
	/** Which way it can be dragged */
	axis: 'x' | 'y';
	/** Dragged far or fast enough: `direction` is -1 (left/up) or 1 (right/down) */
	onswipe: (direction: -1 | 1) => void;
	/** Only down (y) or only these directions count */
	only?: -1 | 1;
}

/** Of the element's size, how far counts without a flick */
const FAR = 0.25;
const FLICK = 0.45; // px/ms, at the end of the drag
const SPRING = 'transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1)';

export function swipe(node: HTMLElement, options: SwipeOptions) {
	let current = options;
	let start: { x: number; y: number } | null = null;
	let dragging = false;
	let offset = 0;
	/** The last moments of the drag, for the speed at its end */
	let samples: { v: number; t: number }[] = [];

	const place = (value: number, transition = 'none') => {
		node.style.transition = transition;
		node.style.transform =
			current.axis === 'x' ? `translate3d(${value}px, 0, 0)` : `translate3d(0, ${value}px, 0)`;
	};

	function down(event: TouchEvent) {
		if (event.touches.length > 1) return void (start = null);
		const touch = event.touches[0];
		// (sliders, fields and what scrolls or drags itself keep their own dragging: what's
		// marked so inside this element, not a sheet this element is itself part of)
		const target = event.target as HTMLElement;
		if (target.closest('input, textarea')) return;
		const blocker = target.closest('[data-no-swipe]');
		if (blocker && blocker !== node && node.contains(blocker)) return;
		// (scrolled down in it: dragging down scrolls back up first)
		if (current.axis === 'y' && node.scrollTop > 0) return;
		start = { x: touch.clientX, y: touch.clientY };
		dragging = false;
		offset = 0;
		samples = [];
	}

	function move(event: TouchEvent) {
		if (!start) return;
		const touch = event.touches[0];
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (!dragging) {
			// Which way it's going: the other way is scrolling, not this
			if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
			const across = Math.abs(dx) > Math.abs(dy);
			if (across !== (current.axis === 'x')) {
				start = null;
				return;
			}
			// (the wrong way only, as a start: that's not this either)
			const value = current.axis === 'x' ? dx : dy;
			if (current.only && Math.sign(value) !== current.only && current.axis === 'y') {
				start = null;
				return;
			}
			dragging = true;
		}
		// (it's this drag now, not the page scrolling)
		if (event.cancelable) event.preventDefault();
		let value = current.axis === 'x' ? dx : dy;
		// (the way it can't go, it gives a little, like a rubber band)
		if (current.only && Math.sign(value) !== current.only) value = -Math.sqrt(Math.abs(value)) * 2;
		offset = value;
		const now = performance.now();
		samples.push({ v: value, t: now });
		while (samples.length > 2 && now - samples[0].t > 80) samples.shift();
		place(value);
	}

	function up(event: TouchEvent) {
		if (!start) return;
		const wasDragging = dragging;
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

		const first = samples[0];
		const last = samples[samples.length - 1];
		const speed = first && last && last.t > first.t ? (last.v - first.v) / (last.t - first.t) : 0;
		const size = current.axis === 'x' ? node.offsetWidth : node.offsetHeight;
		const direction = (Math.sign(speed) || Math.sign(offset)) as -1 | 1;
		const counts =
			event.type !== 'touchcancel' &&
			(!current.only || direction === current.only) &&
			(Math.abs(speed) > FLICK ||
				(Math.abs(offset) > size * FAR && Math.sign(speed) !== -direction));
		if (counts) {
			haptic();
			current.onswipe(direction);
			// (if it's still there after all, back in place)
			setTimeout(() => node.isConnected && place(0, SPRING), 600);
		} else place(0, SPRING);
	}

	node.addEventListener('touchstart', down, { passive: true });
	node.addEventListener('touchmove', move, { passive: false });
	node.addEventListener('touchend', up);
	node.addEventListener('touchcancel', up);
	return {
		update(next: SwipeOptions) {
			current = next;
		},
		destroy() {
			node.removeEventListener('touchstart', down);
			node.removeEventListener('touchmove', move);
			node.removeEventListener('touchend', up);
			node.removeEventListener('touchcancel', up);
		}
	};
}
