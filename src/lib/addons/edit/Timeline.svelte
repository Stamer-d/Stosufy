<script>
	// The song's (or video's) time: its waveform, zoomed in as far as wanted (Ctrl + the mouse
	// wheel, or the buttons; the wheel then moves along), the part kept between two handles
	// (dragged, or the part itself moved), the cuts in it and the parts taken out, where it
	// plays, and a click to go there.
	import { peakBetween } from './waveform.ts';

	/**
	 * @type {{
	 *   duration: number,
	 *   start: number,
	 *   end: number,
	 *   time: number,
	 *   wave: import('./waveform.ts').Waveform | null,
	 *   parts: import('./media.ts').Part[],
	 *   playing: boolean,
	 *   onseek: (time: number) => void,
	 *   ontoggle: (from: number) => void,
	 *   onuncut: (cut: number) => void
	 * }}
	 */
	let {
		duration,
		start = $bindable(),
		end = $bindable(),
		time,
		wave,
		parts,
		playing,
		onseek,
		ontoggle,
		onuncut
	} = $props();

	let box = $state();
	let canvas = $state();
	let width = $state(0);
	const HEIGHT = 112;
	/** At least this much is kept (s) */
	const SHORTEST = 0.1;
	const MAX_ZOOM = 200;
	/** @type {['start' | 'end', string][]} */
	const HANDLES = [
		['start', 'Start'],
		['end', 'End']
	];

	/** How far in, and where the view starts (s) */
	let zoom = $state(1);
	let from = $state(0);
	let span = $derived(duration / zoom);

	const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
	const at = (seconds) => ((seconds - from) / span) * 100;
	const shown = (seconds) => seconds >= from - 1e-6 && seconds <= from + span + 1e-6;

	/** Zoomed in or out, `around` staying where it is on the screen */
	function zoomTo(next, around = from + span / 2) {
		const share = (around - from) / span;
		zoom = clamp(next, 1, MAX_ZOOM);
		const nextSpan = duration / zoom;
		from = clamp(around - share * nextSpan, 0, duration - nextSpan);
	}

	// (playing out of the view: the view follows)
	$effect(() => {
		if (!playing || zoom === 1) return;
		if (time < from || time > from + span) from = clamp(time - span * 0.1, 0, duration - span);
	});

	$effect(() => {
		if (!canvas || !width) return;
		const scale = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(HEIGHT * scale);
		const context = canvas.getContext('2d');
		context.scale(scale, scale);
		context.clearRect(0, 0, width, HEIGHT);
		const bars = Math.max(1, Math.floor(width / 3));
		const per = span / bars;
		for (let i = 0; i < bars; i++) {
			const t0 = from + i * per;
			const t = t0 + per / 2;
			const part = parts.find((other) => t >= other.from && t < other.to);
			const kept = t >= start && t <= end && !part?.dropped;
			const peak = wave ? peakBetween(wave, t0, t0 + per) : 0.35;
			const h = Math.max(2, peak * (HEIGHT - 28));
			context.fillStyle = kept ? 'rgba(196, 181, 253, 0.95)' : 'rgba(255, 255, 255, 0.16)';
			context.fillRect(i * 3, 10 + (HEIGHT - 10 - h) / 2, 2, h);
		}
	});

	/** The time under the pointer */
	function timeAt(event) {
		const rect = box.getBoundingClientRect();
		return clamp(from + ((event.clientX - rect.left) / rect.width) * span, 0, duration);
	}

	/** @param {'start' | 'end' | 'part'} what */
	function drag(event, what) {
		event.preventDefault();
		event.stopPropagation();
		const grabbed = timeAt(event);
		const was = { start, end };
		const x = event.clientX;
		let moved = false;
		const move = (pointer) => {
			// (the part: moved once the pointer has moved a little; a click goes there)
			if (!moved && Math.abs(pointer.clientX - x) < 4) return;
			moved = true;
			const t = timeAt(pointer);
			if (what === 'start') start = Math.min(t, end - SHORTEST);
			else if (what === 'end') end = Math.max(t, start + SHORTEST);
			else {
				const shift = Math.min(duration - was.end, Math.max(-was.start, t - grabbed));
				start = was.start + shift;
				end = was.end + shift;
			}
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (!moved && what === 'part') onseek(grabbed);
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

	function wheel(event) {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			zoomTo(zoom * (event.deltaY < 0 ? 1.25 : 0.8), timeAt(event));
		} else if (zoom > 1) {
			event.preventDefault();
			const by =
				(Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) / 600;
			from = clamp(from + by * span, 0, duration - span);
		}
	}
</script>

<div class="flex flex-col gap-1.5">
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		bind:this={box}
		bind:clientWidth={width}
		class="relative h-28 rounded-xl bg-black/30 ring-1 ring-white/5 cursor-pointer select-none touch-none overflow-hidden"
		onpointerdown={(event) => onseek(timeAt(event))}
		onwheel={wheel}
	>
		<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
		<!-- The part kept -->
		<div
			class="absolute top-2.5 bottom-0 bg-violet-300/10 ring-1 ring-inset ring-violet-300/50 cursor-grab active:cursor-grabbing"
			style="left: {at(start)}%; width: {((end - start) / span) * 100}%"
			onpointerdown={(event) => drag(event, 'part')}
		></div>
		<!-- Parts taken out -->
		{#each parts.filter((part) => part.dropped) as part (part.from)}
			<div
				class="pointer-events-none absolute top-2.5 bottom-0 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.55)_0_6px,rgba(0,0,0,0.25)_6px_12px)]"
				style="left: {at(part.from)}%; width: {((part.to - part.from) / span) * 100}%"
			></div>
		{/each}
		<!-- The cuts -->
		{#each parts.slice(1) as part (part.from)}
			{#if shown(part.from)}
				<div
					class="absolute top-0 bottom-0 z-20 w-0.5 -ml-px bg-amber-300"
					style="left: {at(part.from)}%"
				>
					<button
						class="absolute -top-0 left-1/2 -translate-x-1/2 size-5 grid place-items-center rounded-full bg-amber-300 text-black hover:bg-white cursor-pointer"
						aria-label="Take the cut at {part.from.toFixed(1)} s away"
						title="Take this cut away"
						onpointerdown={(event) => event.stopPropagation()}
						onclick={(event) => {
							event.stopPropagation();
							onuncut(part.from);
						}}
					>
						<span class="icon-[mingcute--close-line] size-3"></span>
					</button>
				</div>
			{/if}
		{/each}
		<!-- Each part: out, or back in -->
		{#if parts.length > 1}
			{#each parts as part, i (part.from)}
				{@const middle = (Math.max(part.from, from) + Math.min(part.to, from + span)) / 2}
				{#if part.to > from && part.from < from + span}
					<button
						class="absolute bottom-1.5 -translate-x-1/2 h-6 px-2 flex items-center gap-1 rounded-full text-[11px] font-bold cursor-pointer transition {part.dropped
							? 'bg-white text-black hover:bg-white/85'
							: 'bg-black/60 text-white/80 hover:bg-red-500/80 hover:text-white'}"
						style="left: clamp(3.5rem, {at(middle)}%, calc(100% - 3.5rem))"
						aria-label="{part.dropped ? 'Put part' : 'Take out part'} {i + 1}"
						onpointerdown={(event) => event.stopPropagation()}
						onclick={(event) => {
							event.stopPropagation();
							ontoggle(part.from);
						}}
					>
						<span
							class="{part.dropped
								? 'icon-[mingcute--back-2-line]'
								: 'icon-[mingcute--delete-2-line]'} size-3"
						></span>
						{part.dropped ? 'Put back' : 'Take out'}
					</button>
				{/if}
			{/each}
		{/if}
		{#each HANDLES as [what, label] (what)}
			{@const value = what === 'start' ? start : end}
			{#if shown(value)}
				<div
					class="absolute top-2.5 bottom-0 w-4 -ml-2 flex justify-center cursor-ew-resize group/handle focus:outline-none"
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
			{/if}
		{/each}
		<!-- Where it plays -->
		{#if shown(time)}
			<div
				class="pointer-events-none absolute top-5 bottom-0 z-10 w-0.5 -ml-px bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
				style="left: {at(time)}%"
			></div>
		{/if}
	</div>

	<!-- Zoom -->
	<div class="flex items-center gap-2 text-xs text-white/50">
		{#if zoom > 1}
			<input
				type="range"
				class="flex-1 accent-violet-300"
				aria-label="Where the view is"
				min="0"
				max={Math.max(0, duration - span)}
				step="0.01"
				bind:value={from}
			/>
		{:else}
			<span class="flex-1">Ctrl + mouse wheel to zoom in</span>
		{/if}
		<button
			class="size-7 grid place-items-center rounded-full hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-default"
			aria-label="Zoom out"
			disabled={zoom <= 1}
			onclick={() => zoomTo(zoom / 2, zoom > 1 && shown(time) ? time : undefined)}
		>
			<span class="icon-[mingcute--zoom-out-line] size-4"></span>
		</button>
		<span class="w-10 text-center tabular-nums"
			>{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</span
		>
		<button
			class="size-7 grid place-items-center rounded-full hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-default"
			aria-label="Zoom in"
			disabled={zoom >= MAX_ZOOM}
			onclick={() => zoomTo(zoom * 2, shown(time) ? time : undefined)}
		>
			<span class="icon-[mingcute--zoom-in-line] size-4"></span>
		</button>
	</div>
</div>
