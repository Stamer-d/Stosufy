<script>
	// Where the song is, to drag (as in Spotify): touch anywhere on the line and it's there,
	// the line grows and follows the finger, the song jumps there when it's let go.
	import { time, seek, queue } from './player';
	import { haptic } from './haptics';

	let line = $state();
	/** Where the finger has it (s), while dragging */
	let dragging = $state(null);
	let now = $state(0);
	let duration = $derived($time.duration || 0);
	let shown = $derived(dragging ?? now);

	// The line moves as often as the song says where it is (four times a second): a couple of
	// pixels each time, which looks the same as moving all along, and the screen isn't drawn
	// again 120 times a second (that warmed the phone)
	let fill = $state();
	let thumb = $state();
	/** Let go here: shown until the song is there (the song tells where it was a moment more,
	 * while it gets there: the line jumped back for a moment) */
	let landing = null;
	$effect(() => {
		const current = $time.current;
		const song = $queue.index;
		if (dragging != null) return;
		// (another song meanwhile, e.g. dragged to the very end: not held)
		if (
			landing &&
			landing.song === song &&
			Math.abs(current - landing.at) > 1.5 &&
			Date.now() < landing.until
		)
			return;
		landing = null;
		now = current;
	});
	$effect(() => {
		const f = duration ? Math.min(1, shown / duration) : 0;
		if (!fill || !thumb) return;
		fill.style.transform = `scaleX(${f})`;
		thumb.style.transform = `translateX(${f * 100}%)`;
	});

	const at = (x) => {
		const box = line.getBoundingClientRect();
		return Math.max(0, Math.min(1, (x - box.left) / box.width)) * duration;
	};

	function start(event) {
		if (!duration || event.touches.length > 1) return;
		haptic();
		dragging = at(event.touches[0].clientX);
	}
	function move(event) {
		if (dragging == null) return;
		if (event.cancelable) event.preventDefault();
		dragging = at(event.touches[0].clientX);
	}
	function end(event) {
		if (dragging == null) return;
		if (event.type === 'touchend') {
			landing = { at: dragging, song: $queue.index, until: Date.now() + 3000 };
			seek(dragging);
			now = dragging;
		}
		dragging = null;
	}
	// (a mouse: a click on the line)
	function click(event) {
		if (!duration) return;
		const to = at(event.clientX);
		landing = { at: to, song: $queue.index, until: Date.now() + 3000 };
		seek(to);
		now = to;
	}

	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="relative -mx-2 px-2 h-11 flex items-center touch-none select-none"
	data-no-swipe
	data-no-edge
	role="slider"
	tabindex="0"
	aria-label="Position"
	aria-valuemin="0"
	aria-valuemax={Math.round(duration)}
	aria-valuenow={Math.round(shown)}
	aria-valuetext={clock(shown)}
	ontouchstart={start}
	ontouchmove={move}
	ontouchend={end}
	ontouchcancel={end}
	onclick={click}
	onkeydown={(e) => {
		if (e.key === 'ArrowRight') seek(Math.min(duration, now + 5));
		if (e.key === 'ArrowLeft') seek(Math.max(0, now - 5));
	}}
>
	<div
		bind:this={line}
		class="relative w-full rounded-full bg-white/15 transition-[height] duration-150 {dragging !=
		null
			? 'h-2'
			: 'h-1'}"
	>
		<!-- (moved by transform, not width or left: nothing is painted again every frame) -->
		<div class="absolute inset-0 overflow-hidden rounded-full">
			<div
				bind:this={fill}
				class="absolute inset-0 origin-left {dragging != null ? 'bg-primary-400' : 'bg-white'}"
			></div>
		</div>
		<div bind:this={thumb} class="absolute inset-0 pointer-events-none">
			<div
				class="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-[width,height] duration-150 {dragging !=
				null
					? 'size-5'
					: 'size-3'}"
			></div>
		</div>
	</div>
</div>
<div
	class="flex justify-between text-xs tabular-nums {dragging != null
		? 'text-white'
		: 'text-white/60'}"
>
	<span>{clock(shown)}</span>
	<span>{clock(duration)}</span>
</div>
