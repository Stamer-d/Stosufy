<script>
	import { haptic } from './haptics';
	// Swiping between songs, as in Spotify: the song before and the next one wait left and
	// right and come along with the finger; let go far or fast enough, the next one slides
	// in (else it springs back). Touch events: on iOS they're the dependable ones.
	import { queue, repeat, next, previous } from './player';

	/** @type {{ item: import('svelte').Snippet<[import('../lib/types').MapSet]>, class?: string }} */
	let { item, class: className = '' } = $props();

	let { songs, index } = $derived($queue);
	let current = $derived(songs[index] ?? null);
	let before = $derived(songs[index - 1] ?? ($repeat === 'all' ? songs.at(-1) : null) ?? null);
	let after = $derived(songs[index + 1] ?? ($repeat === 'all' ? songs[0] : null) ?? null);

	let box = $state();
	let offset = $state(0);
	let animate = $state(false);
	let start = null;
	let locked = null;
	let busy = false;
	/** A drag isn't a tap on what's under the finger */
	let dragged = false;

	function touchstart(event) {
		if (busy || event.touches.length > 1) return;
		const touch = event.touches[0];
		start = { x: touch.clientX, y: touch.clientY, time: performance.now() };
		locked = null;
		dragged = false;
	}

	function touchmove(event) {
		if (!start) return;
		const touch = event.touches[0];
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (!locked) {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
		}
		if (locked !== 'x') return;
		dragged = true;
		animate = false;
		// (no song that way: it gives a little, like a rubber band)
		const blocked = (dx > 0 && !before) || (dx < 0 && !after);
		offset = blocked ? dx / 4 : dx;
	}

	function touchend() {
		// (the click that may follow the drag is swallowed, not a later tap)
		if (dragged) setTimeout(() => (dragged = false), 400);
		if (!start) return;
		const time = performance.now() - start.time;
		start = null;
		if (locked !== 'x') return;
		const width = box?.offsetWidth ?? 300;
		const fast = Math.abs(offset) / Math.max(time, 1) > 0.3 && Math.abs(offset) > 20;
		const direction = offset < 0 ? 1 : -1;
		const possible = direction === 1 ? !!after : !!before;
		animate = true;
		if (possible && (Math.abs(offset) > width * 0.3 || fast)) {
			busy = true;
			haptic();
			offset = -direction * width;
			setTimeout(() => {
				// The neighbour becomes the song: it's in the middle at once, without sliding
				animate = false;
				if (direction === 1) next();
				else previous();
				offset = 0;
				requestAnimationFrame(() => (busy = false));
			}, 220);
		} else offset = 0;
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
		style="transform: translate3d({offset}px, 0, 0); transition: {animate
			? 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
			: 'none'}"
	>
		{#if before}
			<div class="absolute inset-y-0 right-full w-full" aria-hidden="true">
				{@render item(before)}
			</div>
		{/if}
		{#if current}
			{@render item(current)}
		{/if}
		{#if after}
			<div class="absolute inset-y-0 left-full w-full" aria-hidden="true">
				{@render item(after)}
			</div>
		{/if}
	</div>
</div>
