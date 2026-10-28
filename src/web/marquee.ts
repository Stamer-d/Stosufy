// use:marquee: a title too long for its line runs through once (and back) a moment after it
// shows, as in Spotify; the end fades out instead of "…". Once, not on and on: an animation
// running all the time keeps the screen drawing (a warm phone).

export function marquee(node: HTMLElement, text: string) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running: Animation | null = null;

	function run() {
		if (timer) clearTimeout(timer);
		running?.cancel();
		const inner = node.firstElementChild as HTMLElement | null;
		if (!inner) return;
		const over = inner.scrollWidth - node.clientWidth;
		node.style.maskImage = over > 0 ? 'linear-gradient(to right, black 88%, transparent)' : '';
		if (over <= 0) return;
		timer = setTimeout(() => {
			node.style.maskImage =
				'linear-gradient(to right, transparent, black 6%, black 94%, transparent)';
			const travel = over + 24;
			const there = Math.max(1500, travel * 35);
			running = inner.animate(
				[
					{ transform: 'translateX(0)' },
					{ transform: `translateX(${-travel}px)`, offset: 0.45 },
					{ transform: `translateX(${-travel}px)`, offset: 0.55 },
					{ transform: 'translateX(0)' }
				],
				{ duration: there * 2.2, easing: 'ease-in-out' }
			);
			running.onfinish = () => {
				node.style.maskImage = 'linear-gradient(to right, black 88%, transparent)';
				running = null;
			};
		}, 1500);
	}

	requestAnimationFrame(run);
	return {
		update(next: string) {
			if (next !== text) {
				text = next;
				requestAnimationFrame(run);
			}
		},
		destroy() {
			if (timer) clearTimeout(timer);
			running?.cancel();
		}
	};
}
