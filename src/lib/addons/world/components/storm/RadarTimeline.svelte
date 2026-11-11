<script>
	// The rain radar's time: the last two hours (and the radar's own short forecast after now,
	// when it has one) as a row of frames to play or pick, with what the colours mean
	/**
	 * @type {{
	 *   frames: { path: string, time: number }[],
	 *   past: number,
	 *   frame: number,
	 *   playing: boolean,
	 *   on?: boolean
	 * }}
	 */
	let { frames, past, frame = $bindable(0), playing = $bindable(true), on = true } = $props();

	const hhmm = (seconds) =>
		new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const ago = (seconds) => {
		const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
		return minutes <= 0 ? (minutes < -2 ? `In ${-minutes} min` : 'Now') : `${minutes} min ago`;
	};

	let track = $state();
	let dragging = false;
	function seek(event) {
		const rect = track.getBoundingClientRect();
		const t = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		frame = Math.round(t * (frames.length - 1));
	}
	const at = (i) => (i / Math.max(1, frames.length - 1)) * 100;
</script>

<div class="flex items-center gap-3 flex-1 min-w-0">
	<button
		class="grid place-items-center size-10 shrink-0 rounded-full bg-white text-black cursor-pointer hover:scale-105 active:scale-95 transition shadow-lg shadow-black/30 disabled:opacity-40"
		aria-label={playing ? 'Pause the radar' : 'Play the radar'}
		disabled={!on || !frames.length}
		onclick={() => (playing = !playing)}
	>
		<span
			class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-[18px]"
		></span>
	</button>
	<div class="w-[5.5rem] shrink-0 leading-tight">
		<p class="text-sm font-extrabold tabular-nums">
			{frames[frame] ? hhmm(frames[frame].time) : '–'}
		</p>
		<p class="text-[11px] text-white/55 whitespace-nowrap">
			{frames[frame] ? ago(frames[frame].time) : on ? 'Loading…' : 'Radar off'}
		</p>
	</div>
	<div
		bind:this={track}
		class="relative flex-1 min-w-24 h-10 cursor-pointer touch-none"
		role="slider"
		tabindex="0"
		aria-label="Radar time"
		aria-valuemin={0}
		aria-valuemax={Math.max(0, frames.length - 1)}
		aria-valuenow={frame}
		onpointerdown={(e) => {
			if (!frames.length) return;
			track.setPointerCapture(e.pointerId);
			dragging = true;
			playing = false;
			seek(e);
		}}
		onpointermove={(e) => dragging && seek(e)}
		onpointerup={() => (dragging = false)}
		onkeydown={(e) => {
			if (e.key === 'ArrowRight') frame = Math.min(frames.length - 1, frame + 1);
			else if (e.key === 'ArrowLeft') frame = Math.max(0, frame - 1);
			else return;
			playing = false;
			e.preventDefault();
		}}
	>
		<!-- One tick per frame: those shown already filled -->
		<div class="absolute inset-x-0 top-[0.85rem] h-3 flex items-center gap-[2px]">
			{#each frames as f, i (f.path)}
				<span
					class="h-full flex-1 rounded-[2px] transition-colors duration-200 {i <= frame
						? i >= past
							? 'bg-violet-400/80'
							: 'bg-sky-400'
						: i >= past
							? 'bg-violet-300/15'
							: 'bg-white/[0.12]'} {i === frame ? 'scale-y-150' : ''}"
				></span>
			{/each}
		</div>
		{#if frames.length}
			<span class="absolute top-[1.85rem] text-[9.5px] text-white/40 tabular-nums"
				>{hhmm(frames[0].time)}</span
			>
			{#if past > 0 && past <= frames.length}
				<span
					class="absolute top-[1.85rem] text-[9.5px] font-bold text-white/70 {past === frames.length
						? '-translate-x-full'
						: '-translate-x-1/2'}"
					style="left: {at(past - 1)}%">Now</span
				>
			{/if}
			{#if past < frames.length}
				<span class="absolute top-[1.85rem] right-0 text-[9.5px] text-violet-300/70"
					>Radar forecast</span
				>
			{/if}
		{/if}
	</div>
</div>
