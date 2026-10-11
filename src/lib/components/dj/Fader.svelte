<script>
	// A fader: vertical (channel, tempo) or horizontal (crossfader). Drag the cap or click
	// the track; double-click resets it
	let {
		value = 0,
		min = 0,
		max = 1,
		center = min,
		vertical = true,
		/** Up means less (like the tempo fader on decks) */
		inverted = false,
		length = 160,
		label = '',
		onchange = (v) => {},
		children = null
	} = $props();

	let track = $state(null);
	let dragging = false;

	let fraction = $derived((value - min) / (max - min || 1));
	/** Where the cap sits along the track, 0 = start (top or left) */
	let along = $derived(vertical ? (inverted ? fraction : 1 - fraction) : fraction);

	function fromPointer(event) {
		const rect = track.getBoundingClientRect();
		let f = vertical
			? (event.clientY - rect.top) / rect.height
			: (event.clientX - rect.left) / rect.width;
		f = Math.max(0, Math.min(1, f));
		if (vertical && !inverted) f = 1 - f;
		let v = min + f * (max - min);
		if (Math.abs(v - center) < (max - min) * 0.02) v = center;
		onchange(v);
	}
</script>

<div
	bind:this={track}
	class="relative touch-none cursor-pointer select-none {vertical ? 'w-9' : 'h-9'}"
	style={vertical ? `height: ${length}px` : `width: ${length}px`}
	role="slider"
	aria-label={label}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	aria-orientation={vertical ? 'vertical' : 'horizontal'}
	tabindex="0"
	onpointerdown={(e) => {
		dragging = true;
		e.currentTarget.setPointerCapture(e.pointerId);
		fromPointer(e);
	}}
	onpointermove={(e) => dragging && fromPointer(e)}
	onpointerup={() => (dragging = false)}
	ondblclick={() => onchange(center)}
	onkeydown={(e) => {
		const step = (max - min) * 0.02;
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onchange(Math.min(max, value + step));
		if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onchange(Math.max(min, value - step));
	}}
>
	{@render children?.()}
	<div
		class="absolute rounded-full bg-black/60 ring-1 ring-white/10 {vertical
			? 'left-1/2 -translate-x-1/2 w-1.5 inset-y-2'
			: 'top-1/2 -translate-y-1/2 h-1.5 inset-x-2'}"
	></div>
	<div
		class="absolute rounded-[4px] bg-gradient-to-b from-zinc-200 to-zinc-400 shadow-md shadow-black/60 ring-1 ring-black/40 {vertical
			? 'left-1/2 -translate-x-1/2 w-8 h-4'
			: 'top-1/2 -translate-y-1/2 h-8 w-4'}"
		style={vertical
			? `top: calc(${along} * (100% - 16px))`
			: `left: calc(${along} * (100% - 16px))`}
	>
		<div
			class="absolute bg-black/70 {vertical ? 'inset-x-1 top-1/2 h-px' : 'inset-y-1 left-1/2 w-px'}"
		></div>
	</div>
</div>
