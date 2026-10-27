<script>
	// Where the song is, to drag (as in Spotify): touch anywhere on the line and it's there,
	// the line grows and follows the finger, the song jumps there when it's let go. It runs
	// smoothly with the song (read every frame, not only when the browser says so).
	import { onMount } from 'svelte';
	import { time, audioElement, seek } from './player';
	import { haptic } from './haptics';

	let line = $state();
	/** Where the finger has it (s), while dragging */
	let dragging = $state(null);
	let now = $state(0);
	let duration = $derived($time.duration || 0);
	let shown = $derived(dragging ?? now);

	onMount(() => {
		let frame;
		const step = () => {
			const audio = $audioElement;
			if (audio && dragging == null) now = audio.currentTime;
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
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
		<div
			class="absolute inset-y-0 left-0 rounded-full {dragging != null
				? 'bg-primary-400'
				: 'bg-white'}"
			style="width: {duration ? (shown / duration) * 100 : 0}%"
		></div>
		<div
			class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-[width,height] duration-150 {dragging !=
			null
				? 'size-5'
				: 'size-3'}"
			style="left: {duration ? (shown / duration) * 100 : 0}%"
		></div>
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
