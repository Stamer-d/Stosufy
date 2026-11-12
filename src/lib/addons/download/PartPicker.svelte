<script>
	// The part of a video to download: its start and end dragged on a bar of its length, or
	// typed (m:ss, h:mm:ss).
	import { clock, parseClock } from '../files/time.ts';

	/** @type {{ duration: number, start: number, end: number }} */
	let { duration, start = $bindable(), end = $bindable() } = $props();

	/** @type {['start' | 'end', string][]} */
	const HANDLES = [
		['start', 'Part start'],
		['end', 'Part end']
	];
	const SHORTEST = 1;

	let bar = $state();
	const at = (seconds) => (duration ? (seconds / duration) * 100 : 0);
	const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

	function timeAt(event) {
		const rect = bar.getBoundingClientRect();
		return clamp(((event.clientX - rect.left) / rect.width) * duration, 0, duration);
	}

	/** @param {'start' | 'end'} which */
	function drag(event, which) {
		event.preventDefault();
		const move = (moved) => {
			const t = Math.round(timeAt(moved));
			if (which === 'start') start = Math.min(t, end - SHORTEST);
			else end = Math.max(t, start + SHORTEST);
		};
		move(event);
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	/** A click on the bar: the nearer handle goes there */
	function jump(event) {
		const t = timeAt(event);
		drag(event, Math.abs(t - start) <= Math.abs(t - end) ? 'start' : 'end');
	}

	function key(event, which) {
		const step = event.shiftKey ? 60 : 1;
		const by = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		if (!by) return;
		event.preventDefault();
		if (which === 'start') start = clamp(start + by, 0, end - SHORTEST);
		else end = clamp(end + by, start + SHORTEST, duration);
	}

	function typed(which, text) {
		const seconds = parseClock(text);
		if (seconds === null) return;
		if (which === 'start') start = clamp(seconds, 0, end - SHORTEST);
		else end = clamp(seconds, start + SHORTEST, duration);
	}

	/** Without tenths (a download's cut is to the second) */
	const short = (seconds) => clock(Math.round(seconds)).replace(/\.\d$/, '');
</script>

<div class="flex flex-col gap-2">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={bar}
		class="relative h-8 rounded-full bg-white/[0.06] cursor-pointer select-none touch-none"
		onpointerdown={jump}
	>
		<div
			class="absolute inset-y-1 rounded-full bg-rose-400/30 ring-1 ring-inset ring-rose-300/60"
			style="left: {at(start)}%; width: {at(end - start)}%"
		></div>
		{#each HANDLES as [which, label] (which)}
			{@const value = which === 'start' ? start : end}
			<div
				class="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-7 rounded-md bg-rose-300 hover:bg-white focus:bg-white cursor-ew-resize outline-none transition-colors"
				style="left: {at(value)}%"
				role="slider"
				tabindex="0"
				aria-label={label}
				aria-valuemin="0"
				aria-valuemax={duration}
				aria-valuenow={value}
				aria-valuetext={clock(value)}
				onpointerdown={(event) => {
					event.stopPropagation();
					drag(event, which);
				}}
				onkeydown={(event) => key(event, which)}
			></div>
		{/each}
	</div>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
		{#each HANDLES as [which, label] (which)}
			<label class="flex items-center gap-1.5">
				<span class="text-white/60">{which === 'start' ? 'From' : 'To'}</span>
				<input
					class="w-24 h-8 px-2 rounded-lg bg-white/[0.06] tabular-nums font-semibold outline-none focus:ring-1 focus:ring-rose-300"
					aria-label="{label} time"
					value={short(which === 'start' ? start : end)}
					onchange={(event) => typed(which, event.currentTarget.value)}
				/>
			</label>
		{/each}
		<span class="text-white/50">
			{short(end - start)} of {short(duration)}
		</span>
	</div>
</div>
