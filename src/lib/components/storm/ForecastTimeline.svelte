<script>
	// The forecast's time: play it (the maps move smoothly from hour to hour), or drag along the
	// days. Each day is marked, every third hour has a tick, now is where it starts.
	/**
	 * @type {{
	 *   base: number,
	 *   hours: number,
	 *   value: number,
	 *   playing: boolean,
	 *   loading?: boolean,
	 *   label?: string
	 * }}
	 */
	let {
		base,
		hours,
		value = $bindable(0),
		playing = $bindable(false),
		loading = false,
		label = ''
	} = $props();

	/** Hours of forecast a second while playing */
	const SPEED = 2.4;

	let track = $state();
	let dragging = $state(false);

	let time = $derived(base + Math.round(value) * 3600e3);
	let days = $derived.by(() => {
		const list = [];
		const end = base + (hours - 1) * 3600e3;
		const midnight = new Date(base);
		midnight.setHours(24, 0, 0, 0);
		let from = base;
		for (let next = midnight.getTime(); from < end; next += 24 * 3600e3) {
			const to = Math.min(end, next);
			list.push({
				at: (from - base) / 3600e3,
				span: (to - from) / 3600e3,
				name:
					list.length === 0
						? 'Today'
						: new Date(from).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
			});
			from = next;
		}
		return list;
	});
	let ticks = $derived(
		Array.from({ length: hours }, (_, i) => i).filter(
			(i) => new Date(base + i * 3600e3).getHours() % 3 === 0
		)
	);
	const at = (hour) => (hour / Math.max(1, hours - 1)) * 100;

	function seek(event) {
		const rect = track.getBoundingClientRect();
		const t = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		value = Math.round(t * (hours - 1));
	}
	function down(event) {
		if (event.button !== 0) return;
		track.setPointerCapture(event.pointerId);
		dragging = true;
		playing = false;
		seek(event);
	}
	function keys(event) {
		if (event.key === 'ArrowRight') value = Math.min(hours - 1, Math.round(value) + 1);
		else if (event.key === 'ArrowLeft') value = Math.max(0, Math.round(value) - 1);
		else return;
		playing = false;
		event.preventDefault();
	}

	// Playing: on smoothly, a short rest at the end, then from now again (nothing runs while
	// paused)
	$effect(() => {
		if (!playing) return;
		let last = 0;
		let rest = 0;
		let frame = requestAnimationFrame(function loop(now) {
			const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
			last = now;
			if (!loading && hours > 1) {
				if (value >= hours - 1) {
					rest += dt;
					if (rest > 1.2) {
						rest = 0;
						value = 0;
					}
				} else value = Math.min(hours - 1, value + dt * SPEED);
			}
			frame = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(frame);
	});
	// Paused on a whole hour
	$effect(() => {
		if (!playing && !dragging && value !== Math.round(value)) value = Math.round(value);
	});
</script>

<div class="flex items-center gap-3 w-full">
	<button
		class="grid place-items-center size-10 shrink-0 rounded-full bg-white text-black cursor-pointer hover:scale-105 active:scale-95 transition shadow-lg shadow-black/30"
		aria-label={playing ? 'Pause' : 'Play the forecast'}
		onclick={() => {
			if (!playing && value >= hours - 1) value = 0;
			playing = !playing;
		}}
	>
		<span
			class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-[18px]"
		></span>
	</button>
	<div class="w-[6.5rem] shrink-0 leading-tight">
		<p class="text-sm font-extrabold tabular-nums whitespace-nowrap">
			{new Date(time).toLocaleString(undefined, {
				weekday: 'short',
				hour: '2-digit',
				minute: '2-digit'
			})}
		</p>
		<p class="text-[11px] text-white/55 whitespace-nowrap">
			{#if loading}
				<span class="inline-flex items-center gap-1"
					><span class="icon-[mingcute--loading-line] size-3 animate-spin"></span>Loading…</span
				>
			{:else}
				{Math.round(value) === 0 ? 'Now' : `In ${Math.round(value)} h`}{label ? ` · ${label}` : ''}
			{/if}
		</p>
	</div>
	<div
		bind:this={track}
		class="relative flex-1 h-10 cursor-pointer touch-none outline-none"
		role="slider"
		tabindex="0"
		aria-label="Forecast hour"
		aria-valuemin={0}
		aria-valuemax={hours - 1}
		aria-valuenow={Math.round(value)}
		onpointerdown={down}
		onpointermove={(e) => dragging && seek(e)}
		onpointerup={() => (dragging = false)}
		onpointercancel={() => (dragging = false)}
		onkeydown={keys}
	>
		<!-- The days -->
		{#each days as day, i (i)}
			<div
				class="absolute top-0 h-4 flex items-center border-s border-white/15 ps-1.5 overflow-hidden"
				style="left: {at(day.at)}%; width: {(day.span / Math.max(1, hours - 1)) * 100}%"
			>
				<span
					class="text-[10px] font-bold uppercase tracking-wide whitespace-nowrap {value >= day.at &&
					value < day.at + day.span + (i === days.length - 1 ? 1 : 0)
						? 'text-white'
						: 'text-white/40'}">{day.name}</span
				>
			</div>
		{/each}
		<!-- The track, filled up to the time shown -->
		<div class="absolute left-0 right-0 top-[1.4rem] h-2 rounded-full bg-white/[0.08]">
			<div
				class="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-sky-400 via-amber-300 to-rose-400"
				style="width: {at(value)}%"
			></div>
		</div>
		{#each ticks as hour (hour)}
			<span
				class="absolute top-[2.2rem] w-px h-1.5 -ml-px {new Date(
					base + hour * 3600e3
				).getHours() === 0
					? 'bg-white/50'
					: 'bg-white/20'}"
				style="left: {at(hour)}%"
			></span>
		{/each}
		<span
			class="absolute top-[1.15rem] size-[18px] -ml-[9px] rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.18),0_2px_8px_rgba(0,0,0,0.5)] {dragging
				? 'scale-110'
				: ''} transition-transform"
			style="left: {at(value)}%"
		></span>
	</div>
</div>
