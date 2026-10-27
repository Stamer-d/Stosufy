<script>
	// Where the song is, to drag (as in Spotify): touch anywhere on the line and it's there,
	// the line grows and follows the finger, the song jumps there when it's let go. It runs
	// smoothly with the song (read every frame, not only when the browser says so).
	import { time, audioElement, seek } from './player';
	import { haptic } from './haptics';

	let line = $state();
	/** Where the finger has it (s), while dragging */
	let dragging = $state(null);
	let now = $state(0);
	let duration = $derived($time.duration || 0);
	let shown = $derived(dragging ?? now);

	// While it plays, the line runs to the end by itself (an animation the phone's graphics
	// chip plays, nothing to do here each frame); started again on play, pause, seek, speed
	let fill = $state();
	let thumb = $state();
	let running = [];
	function place(f) {
		fill.style.transform = `scaleX(${f})`;
		thumb.style.transform = `translateX(${f * 100}%)`;
	}
	function sync() {
		for (const animation of running) animation.cancel();
		running = [];
		const audio = $audioElement;
		if (!fill || !thumb || !audio || !audio.duration) return;
		if (dragging != null) return place(Math.min(1, dragging / audio.duration));
		now = audio.currentTime;
		const f = Math.min(1, audio.currentTime / audio.duration);
		place(f);
		if (audio.paused) return;
		const timing = {
			duration: Math.max(
				0,
				((audio.duration - audio.currentTime) * 1000) / (audio.playbackRate || 1)
			),
			easing: 'linear',
			fill: /** @type {const} */ ('forwards')
		};
		running = [
			fill.animate([{ transform: `scaleX(${f})` }, { transform: 'scaleX(1)' }], timing),
			thumb.animate(
				[{ transform: `translateX(${f * 100}%)` }, { transform: 'translateX(100%)' }],
				timing
			)
		];
	}
	const EVENTS = [
		'play',
		'playing',
		'pause',
		'seeked',
		'ratechange',
		'loadedmetadata',
		'durationchange'
	];
	$effect(() => {
		const audio = $audioElement;
		if (!audio) return;
		for (const type of EVENTS) audio.addEventListener(type, sync);
		sync();
		return () => {
			for (const type of EVENTS) audio.removeEventListener(type, sync);
			for (const animation of running) animation.cancel();
		};
	});
	// (the time under it, as often as the song says where it is)
	$effect(() => {
		if (dragging == null) now = $time.current;
	});
	// Dragging: the line is where the finger is
	$effect(() => {
		void dragging;
		sync();
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
			seek(dragging);
			now = dragging;
		}
		dragging = null;
	}
	// (a mouse: a click on the line)
	function click(event) {
		if (duration) seek(at(event.clientX));
	}

	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="relative -mx-2 px-2 h-9 flex items-center touch-none select-none"
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
