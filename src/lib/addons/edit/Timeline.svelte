<script>
	// The song's (or video's) time: its waveform, the part kept between two handles (dragged,
	// or the part itself moved), where it plays, and a click to go there.
	/**
	 * @type {{
	 *   duration: number,
	 *   start: number,
	 *   end: number,
	 *   time: number,
	 *   peaks: Float32Array | null,
	 *   onseek: (time: number) => void
	 * }}
	 */
	let { duration, start = $bindable(), end = $bindable(), time, peaks, onseek } = $props();

	let box = $state();
	let canvas = $state();
	let width = $state(0);
	const HEIGHT = 96;
	/** @type {['start' | 'end', string][]} */
	const HANDLES = [
		['start', 'Start'],
		['end', 'End']
	];
	/** At least this much is kept (s) */
	const SHORTEST = 0.1;

	const at = (seconds) => (duration ? (seconds / duration) * 100 : 0);

	$effect(() => {
		if (!canvas || !width) return;
		const scale = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(HEIGHT * scale);
		const context = canvas.getContext('2d');
		context.scale(scale, scale);
		context.clearRect(0, 0, width, HEIGHT);
		const bars = Math.max(1, Math.floor(width / 3));
		for (let i = 0; i < bars; i++) {
			const t = ((i + 0.5) / bars) * duration;
			const kept = t >= start && t <= end;
			const peak = peaks ? peaks[Math.floor((i / bars) * peaks.length)] : 0.35;
			const h = Math.max(2, peak * (HEIGHT - 12));
			context.fillStyle = kept ? 'rgba(196, 181, 253, 0.95)' : 'rgba(255, 255, 255, 0.18)';
			context.fillRect(i * 3, (HEIGHT - h) / 2, 2, h);
		}
	});

	/** The time under the pointer */
	function timeAt(event) {
		const rect = box.getBoundingClientRect();
		return Math.min(duration, Math.max(0, ((event.clientX - rect.left) / rect.width) * duration));
	}

	/** @param {'start' | 'end' | 'part'} what */
	function drag(event, what) {
		event.preventDefault();
		event.stopPropagation();
		const from = timeAt(event);
		const was = { start, end };
		const move = (moved) => {
			const t = timeAt(moved);
			if (what === 'start') start = Math.min(t, end - SHORTEST);
			else if (what === 'end') end = Math.max(t, start + SHORTEST);
			else {
				const shift = Math.min(duration - was.end, Math.max(-was.start, t - from));
				start = was.start + shift;
				end = was.end + shift;
			}
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function key(event, what) {
		const step = event.shiftKey ? 1 : 0.1;
		const by = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		if (!by) return;
		event.preventDefault();
		if (what === 'start') start = Math.min(end - SHORTEST, Math.max(0, start + by));
		else end = Math.max(start + SHORTEST, Math.min(duration, end + by));
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	bind:this={box}
	bind:clientWidth={width}
	class="relative h-24 rounded-xl bg-black/30 ring-1 ring-white/5 cursor-pointer select-none touch-none"
	onpointerdown={(event) => onseek(timeAt(event))}
>
	<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
	<!-- The part kept -->
	<div
		class="absolute inset-y-0 bg-violet-300/10 ring-1 ring-inset ring-violet-300/50 cursor-grab active:cursor-grabbing"
		style="left: {at(start)}%; width: {at(end - start)}%"
		onpointerdown={(event) => drag(event, 'part')}
	></div>
	{#each HANDLES as [what, label] (what)}
		{@const value = what === 'start' ? start : end}
		<div
			class="absolute inset-y-0 w-4 -ml-2 flex justify-center cursor-ew-resize group/handle focus:outline-none"
			style="left: {at(value)}%"
			role="slider"
			tabindex="0"
			aria-label={label}
			aria-valuemin="0"
			aria-valuemax={duration}
			aria-valuenow={value}
			onpointerdown={(event) => drag(event, what)}
			onkeydown={(event) => key(event, what)}
		>
			<div
				class="w-1 h-full rounded-full bg-violet-300 group-hover/handle:bg-white group-focus/handle:bg-white transition"
			></div>
			<div
				class="absolute top-1/2 -translate-y-1/2 w-3 h-8 rounded-md bg-violet-300 group-hover/handle:bg-white group-focus/handle:bg-white transition"
			></div>
		</div>
	{/each}
	<!-- Where it plays -->
	<div
		class="pointer-events-none absolute inset-y-0 w-0.5 -ml-px bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
		style="left: {at(time)}%"
	></div>
</div>
