<script>
	// Swiping between songs, as in Spotify: the song before and the next one wait left and
	// right and come along with the finger; let go far enough, or with a flick, and the next
	// one slides in (else it springs back). The three are the same elements all along: the
	// next one becomes the song where it is, its cover already there (nothing loads again).
	// Touch events: on iOS they're the dependable ones.
	import { haptic } from './haptics';
	import { queue, repeat, next, previous } from './player';

	/** @type {{ item: import('svelte').Snippet<[import('../lib/types').MapSet, boolean]>, class?: string }} */
	let { item, class: className = '' } = $props();

	let { songs, index } = $derived($queue);
	let beforeAt = $derived(
		index > 0 ? index - 1 : $repeat === 'all' && songs.length > 1 ? songs.length - 1 : -1
	);
	let afterAt = $derived(
		index < songs.length - 1 ? index + 1 : $repeat === 'all' && songs.length > 1 ? 0 : -1
	);
	/** The songs shown, by their place in the queue (-1 left, 0 the song, 1 right) */
	let panes = $derived(
		[
			[beforeAt, -1],
			[index, 0],
			[afterAt, 1]
		]
			// (two songs on repeat: the other one waits on the right only)
			.filter(([at, place]) => at >= 0 && songs[at] && !(place === -1 && at === afterAt))
			.map(([at, place]) => ({ at, place, song: songs[at] }))
	);
	let hasBefore = $derived(beforeAt >= 0);
	let hasAfter = $derived(afterAt >= 0);

	let box = $state();
	let offset = $state(0);
	let transition = $state('none');
	let start = null;
	let locked = null;
	let busy = false;
	let samples = [];
	/** A drag isn't a tap on what's under the finger */
	let dragged = false;

	function touchstart(event) {
		if (busy || event.touches.length > 1) return;
		const touch = event.touches[0];
		start = { x: touch.clientX, y: touch.clientY };
		locked = null;
		dragged = false;
		samples = [];
	}

	function touchmove(event) {
		if (!start) return;
		const touch = event.touches[0];
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (!locked) {
			if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
			locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
		}
		if (locked !== 'x') return;
		if (event.cancelable) event.preventDefault();
		dragged = true;
		transition = 'none';
		// (no song that way: it gives a little, like a rubber band)
		const blocked = (dx > 0 && !hasBefore) || (dx < 0 && !hasAfter);
		offset = blocked ? Math.sign(dx) * Math.sqrt(Math.abs(dx)) * 3 : dx;
		const now = performance.now();
		samples.push({ x: dx, t: now });
		while (samples.length > 2 && now - samples[0].t > 80) samples.shift();
	}

	function touchend() {
		// (the click that may follow the drag is swallowed, not a later tap)
		if (dragged) setTimeout(() => (dragged = false), 400);
		if (!start) return;
		start = null;
		if (locked !== 'x') return;
		const width = box?.offsetWidth ?? 300;
		const first = samples[0];
		const last = samples[samples.length - 1];
		const speed = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
		// Which way: the flick's, else where it was dragged to
		const direction = Math.abs(speed) > 0.3 ? (speed < 0 ? 1 : -1) : offset < 0 ? 1 : -1;
		const possible = direction === 1 ? hasAfter : hasBefore;
		const far = Math.abs(offset) > width * 0.35 && Math.sign(speed) !== direction;
		if (possible && (Math.abs(speed) > 0.3 || far)) {
			busy = true;
			haptic();
			// The rest of the way at the finger's speed (not slower than a moment)
			const rest = width - Math.abs(offset);
			const duration = Math.round(
				Math.max(120, Math.min(280, rest / Math.max(Math.abs(speed), 1.4)))
			);
			transition = `transform ${duration}ms cubic-bezier(0.25, 0.8, 0.3, 1)`;
			offset = -direction * width;
			setTimeout(() => {
				// The neighbour becomes the song where it is: no sliding, nothing loads again
				transition = 'none';
				if (direction === 1) next();
				else previous();
				offset = 0;
				requestAnimationFrame(() => (busy = false));
			}, duration);
		} else {
			transition = 'transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1)';
			offset = 0;
		}
	}

	function swallowClick(event) {
		if (!dragged) return;
		dragged = false;
		event.stopPropagation();
		event.preventDefault();
	}
</script>

<div
	bind:this={box}
	class="relative overflow-hidden {className}"
	style="touch-action: pan-y"
	ontouchstart={touchstart}
	ontouchmove={touchmove}
	ontouchend={touchend}
	ontouchcancel={touchend}
	onclickcapture={swallowClick}
	data-no-edge
	role="group"
	aria-label="Swipe for the next song or the one before"
>
	<div
		class="relative w-full"
		style="transform: translate3d({offset}px, 0, 0); transition: {transition}"
	>
		{#each panes as pane (pane.at)}
			<div
				class={pane.place === 0 ? 'relative w-full' : 'absolute inset-y-0 w-full'}
				style={pane.place === 0 ? '' : `left: ${pane.place * 100}%`}
				aria-hidden={pane.place !== 0}
			>
				{@render item(pane.song, pane.place === 0)}
			</div>
		{/each}
	</div>
</div>
