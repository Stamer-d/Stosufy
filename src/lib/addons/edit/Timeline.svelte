<script>
	// The song's (or video's) time: its waveform, zoomed in as far as wanted (Ctrl + the mouse
	// wheel, or the buttons; the wheel then moves along), the part kept between two handles
	// (dragged, or the part itself moved), the cuts in it and the parts taken out, where it
	// plays, and a click to go there.
	import { clock, peakBetween } from './waveform.ts';

	/**
	 * @type {{
	 *   duration: number,
	 *   start: number,
	 *   end: number,
	 *   time: number,
	 *   wave: import('./waveform.ts').Waveform | null,
	 *   reading?: boolean,
	 *   frames?: import('./thumbnails.svelte.ts').Thumbnails | null,
	 *   zoom?: number,
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
		reading = false,
		frames = null,
		zoom = $bindable(1),
		parts,
		playing,
		onseek,
		ontoggle,
		onuncut
	} = $props();

	let box = $state();
	let canvas = $state();
	let width = $state(0);
	/** The waveform's height, and the video's pictures' over it */
	const WAVE = 112;
	const STRIP = 40;
	let HEIGHT = $derived(frames ? WAVE + STRIP + 4 : WAVE);
	/** At least this much is kept (s) */
	const SHORTEST = 0.1;
	const MAX_ZOOM = 200;
	/** @type {['start' | 'end', string][]} */
	const HANDLES = [
		['start', 'Start'],
		['end', 'End']
	];

	/** How far in, and where the view starts (s) */
	let from = $state(0);
	let span = $derived(duration / zoom);

	const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
	const at = (seconds) => ((seconds - from) / span) * 100;
	const shown = (seconds) => seconds >= from - 1e-6 && seconds <= from + span + 1e-6;

	/** Zoomed in or out, `around` staying where it is on the screen */
	/** Twice as far in, or out (around where it plays, if that's in view) */
	export function zoomIn() {
		zoomTo(zoom * 2, shown(time) ? time : undefined);
	}
	export function zoomOut() {
		zoomTo(zoom / 2, zoom > 1 && shown(time) ? time : undefined);
	}

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

	/** The canvas's size last set (set again only when it changes: that clears and reallocates it) */
	let sized = '';
	$effect(() => {
		if (!canvas || !width) return;
		const scale = window.devicePixelRatio || 1;
		const size = `${Math.round(width * scale)}x${Math.round(HEIGHT * scale)}`;
		if (size !== sized) {
			sized = size;
			canvas.width = Math.round(width * scale);
			canvas.height = Math.round(HEIGHT * scale);
		}
		const context = canvas.getContext('2d');
		context.setTransform(scale, 0, 0, scale, 0, 0);
		context.clearRect(0, 0, width, HEIGHT);
		if (frames) drawFrames(context);
		const top = frames ? 10 + STRIP + 4 : 10;
		const room = HEIGHT - top;
		const bars = Math.max(1, Math.floor(width / 3));
		const per = span / bars;
		for (let i = 0; i < bars; i++) {
			const t0 = from + i * per;
			const t = t0 + per / 2;
			const part = parts.find((other) => t >= other.from && t < other.to);
			const kept = t >= start && t <= end && !part?.dropped;
			const peak = wave ? peakBetween(wave, t0, t0 + per) : 0.35;
			const h = Math.max(2, peak * (room - 18));
			context.fillStyle = kept ? 'rgba(196, 181, 253, 0.95)' : 'rgba(255, 255, 255, 0.16)';
			context.fillRect(i * 3, top + (room - h) / 2, 2, h);
		}
	});

	/**
	 * The video's pictures along the top, whole, side by side; each of the time in its middle
	 * (on a grid that halves as it's zoomed in: those taken are used again), outside what's kept
	 * darker
	 */
	let wanted = '';
	function drawFrames(context) {
		if (!frames) return;
		void frames.version;
		const tile = STRIP * frames.aspect;
		const count = Math.ceil(width / tile);
		const per = (span * tile) / width;
		let grid = duration;
		while (grid > per / 2 && grid > 0.02) grid /= 2;
		const times = [];
		for (let i = 0; i < count; i++) {
			const t = from + (i + 0.5) * per;
			times.push(clamp(Math.round(t / grid) * grid, 0, Math.max(0, duration - 0.05)));
		}
		// (asked for again only when the view moved: else the pictures still to take start over)
		const key = times.join();
		if (key !== wanted) {
			wanted = key;
			frames.want(times);
		}
		times.forEach((time, i) => {
			const picture = frames.get(time);
			if (picture) context.drawImage(picture, i * tile, 10, tile, STRIP);
		});
		context.fillStyle = 'rgba(0, 0, 0, 0.6)';
		const left = ((start - from) / span) * width;
		const right = ((end - from) / span) * width;
		if (left > 0) context.fillRect(0, 10, left, STRIP);
		if (right < width) context.fillRect(right, 10, width - right, STRIP);
	}

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
			// (moved once the pointer has moved a little: a click goes there)
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
			// (a click, not a drag: there, as anywhere on the timeline; also on a handle, which
			// sits right at the start of the song when nothing's cut there)
			if (!moved) onseek(grabbed);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	/** Where it plays, dragged there (from anywhere on the timeline, or by its line) */
	function scrub(event) {
		if (event.button > 0) return;
		event.preventDefault();
		event.stopPropagation();
		onseek(timeAt(event));
		const move = (pointer) => onseek(timeAt(pointer));
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	}

	/** Where it plays, moved by the keys (a second; Shift: five) */
	function playKey(event) {
		const step = event.shiftKey ? 5 : 1;
		const to =
			event.key === 'ArrowLeft'
				? time - step
				: event.key === 'ArrowRight'
					? time + step
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? duration
							: null;
		if (to === null) return;
		event.preventDefault();
		event.stopPropagation();
		onseek(clamp(to, 0, duration));
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
		class="relative rounded-xl bg-black/30 ring-1 ring-white/5 cursor-pointer select-none touch-none overflow-hidden"
		style="height: {HEIGHT}px"
		onpointerdown={scrub}
		onwheel={wheel}
	>
		<!-- (a little in from the edges: the handles at the start and the end seen whole) -->
		<div bind:this={box} bind:clientWidth={width} class="absolute inset-y-0 inset-x-2">
			<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
			{#if reading}
				<span
					class="absolute right-2 bottom-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-semibold text-white/60 pointer-events-none"
				>
					<span class="icon-[mingcute--loading-line] size-3 animate-spin"></span>
					Reading the sound…
				</span>
			{/if}
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
						class="absolute top-2.5 bottom-0 z-[15] w-4 -ml-2 flex justify-center cursor-ew-resize group/handle focus:outline-none"
						style="left: {at(value)}%"
						role="slider"
						tabindex="0"
						aria-label={label}
						aria-valuemin="0"
						aria-valuemax={duration}
						aria-valuenow={value}
						aria-valuetext={clock(value)}
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
			<!-- Where it plays: from the top to the bottom, dragged by its line or its knob (on
			     top, over the part's handles) -->
			{#if shown(time)}
				<div
					class="absolute inset-y-0 z-10 w-3 -ml-1.5 flex justify-center cursor-ew-resize group/play focus:outline-none"
					style="left: {at(time)}%"
					role="slider"
					tabindex="0"
					aria-label="Where it plays"
					aria-valuemin="0"
					aria-valuemax={duration}
					aria-valuenow={time}
					aria-valuetext={clock(time)}
					onpointerdown={scrub}
					onkeydown={playKey}
				>
					<div
						class="w-0.5 h-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] group-focus-visible/play:bg-violet-200"
					></div>
					<div
						class="absolute top-0 z-20 w-2.5 h-2.5 rounded-b-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] group-hover/play:scale-125 group-focus-visible/play:bg-violet-200 transition-transform"
					></div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Where the view is, zoomed in -->
	{#if zoom > 1}
		<input
			type="range"
			class="w-full h-2 accent-violet-300"
			aria-label="Where the view is"
			min="0"
			max={Math.max(0, duration - span)}
			step="0.01"
			bind:value={from}
		/>
	{/if}
</div>
