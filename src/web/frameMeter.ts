// How smooth a gesture was on this phone: the time between the frames drawn while the finger
// moves, and after it lets go (the page or player going on by itself), written to the log
// (Settings → Checks and player log). A frame takes 8–17 ms; much longer is a stutter.

import { log } from './log';

const SLOW = 34;

export function frameMeter(name: string, note = () => '') {
	const moving: number[] = [];
	const after: number[] = [];
	let released = false;
	let stopAt = Infinity;
	let last = performance.now();
	let frame = requestAnimationFrame(function step(now) {
		(released ? after : moving).push(now - last);
		last = now;
		if (now < stopAt) frame = requestAnimationFrame(step);
		else report();
	});
	const describe = (frames: number[]) =>
		frames.length
			? `${frames.length} frames, slowest ${Math.round(Math.max(...frames))} ms, ${frames.filter((t) => t > SLOW).length} slow`
			: 'none';
	function report() {
		const all = [...moving, ...after];
		if (!all.length) return;
		const extra = note();
		log(
			`${name}: moving ${describe(moving)}; after letting go ${describe(after)}${extra ? ` (${extra})` : ''}`
		);
	}
	return {
		/** The finger let go: what comes after is measured 0.6 s more */
		release() {
			if (released) return;
			released = true;
			stopAt = performance.now() + 600;
		},
		/** Nothing to report (it wasn't the gesture after all) */
		cancel() {
			cancelAnimationFrame(frame);
		}
	};
}

/** What's on that costs drawing (for the log line) */
export function gestureNote() {
	const parts: string[] = [];
	if (document.documentElement.classList.contains('moving-triangles'))
		parts.push('moving triangles');
	return parts.join(', ');
}
