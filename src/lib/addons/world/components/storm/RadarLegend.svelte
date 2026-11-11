<script>
	// What the rain radar's colours mean (RainViewer's "universal blue" colours)
	const COLOURS = [
		'rgb(214, 200, 143)',
		'rgb(136, 221, 238)',
		'rgb(0, 163, 224)',
		'rgb(0, 98, 149)',
		'rgb(255, 238, 0)',
		'rgb(255, 160, 0)',
		'rgb(255, 50, 30)',
		'rgb(255, 110, 200)'
	];
</script>

<div class="w-36 shrink-0" title="Rain radar: from drizzle (beige) to heavy rain and hail">
	<div
		class="h-2 rounded-full ring-1 ring-white/10"
		style="background: linear-gradient(90deg, {COLOURS.join(', ')})"
	></div>
	<div class="mt-1 flex justify-between text-[9.5px] font-semibold text-white/55">
		<span>Light</span><span>Heavy</span><span>Hail</span>
	</div>
</div>
