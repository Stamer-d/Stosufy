<script>
	// A knob like on a mixer: drag up or down (or scroll) to turn it, double-click to reset
	let {
		value = 0,
		min = -1,
		max = 1,
		/** Where the knob rests (and its arc starts from) */
		center = 0,
		label = '',
		size = 44,
		color = 'var(--color-primary-400, #a78bfa)',
		format = (v) => v.toFixed(1),
		onchange = (v) => {}
	} = $props();

	const ANGLE = 135;
	let fraction = $derived((value - min) / (max - min || 1));
	let angle = $derived(-ANGLE + fraction * ANGLE * 2);
	let centerFraction = $derived((center - min) / (max - min || 1));

	const polar = (a, r) => {
		const rad = ((a - 90) * Math.PI) / 180;
		return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
	};
	function arc(fromFraction, toFraction, r) {
		const a1 = -ANGLE + Math.min(fromFraction, toFraction) * ANGLE * 2;
		const a2 = -ANGLE + Math.max(fromFraction, toFraction) * ANGLE * 2;
		const [x1, y1] = polar(a1, r);
		const [x2, y2] = polar(a2, r);
		const large = a2 - a1 > 180 ? 1 : 0;
		return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
	}

	let dragging = $state(false);
	let startY = 0;
	let startValue = 0;

	function down(event) {
		dragging = true;
		startY = event.clientY;
		startValue = value;
		event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
	}
	function move(event) {
		if (!dragging) return;
		const fine = event.shiftKey ? 0.25 : 1;
		const change = ((startY - event.clientY) / 160) * (max - min) * fine;
		set(startValue + change);
	}
	function set(v) {
		let next = Math.max(min, Math.min(max, v));
		// Snaps to the middle
		if (Math.abs(next - center) < (max - min) * 0.015) next = center;
		onchange(next);
	}
	function wheel(event) {
		event.preventDefault();
		set(value - Math.sign(event.deltaY) * (max - min) * 0.03);
	}
</script>

<div class="flex flex-col items-center gap-0.5 select-none" title="{label}: {format(value)}">
	<svg
		width={size}
		height={size}
		viewBox="0 0 100 100"
		class="cursor-ns-resize touch-none"
		role="slider"
		aria-label={label}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		tabindex="0"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={() => (dragging = false)}
		ondblclick={() => onchange(center)}
		onwheel={wheel}
		onkeydown={(e) => {
			if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + (max - min) * 0.02);
			if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - (max - min) * 0.02);
		}}
	>
		<path
			d={arc(0, 1, 42)}
			stroke="rgba(255,255,255,0.12)"
			stroke-width="8"
			fill="none"
			stroke-linecap="round"
		/>
		{#if Math.abs(fraction - centerFraction) > 0.001}
			<path
				d={arc(centerFraction, fraction, 42)}
				stroke={color}
				stroke-width="8"
				fill="none"
				stroke-linecap="round"
			/>
		{/if}
		<circle cx="50" cy="50" r="30" fill="#232329" stroke="rgba(255,255,255,0.1)" stroke-width="2" />
		<line
			x1="50"
			y1="50"
			x2={polar(angle, 26)[0]}
			y2={polar(angle, 26)[1]}
			stroke="white"
			stroke-width="6"
			stroke-linecap="round"
		/>
	</svg>
	{#if label}
		<span class="text-[10px] font-bold uppercase tracking-wide text-white/50">{label}</span>
	{/if}
</div>
