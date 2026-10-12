<script>
	// The hodograph: the wind from the ground up as a line (0–1 km red, 1–3 km green,
	// 3–6 km yellow, above blue), with the motion of a right-moving supercell
	/** @type {{ profile: import('#lib/storm.ts').StormProfile, size?: number }} */
	let { profile, size = 280 } = $props();

	let centre = $derived(size / 2);
	let max = $derived(
		Math.max(
			20,
			Math.ceil(
				Math.max(
					...profile.levels.filter((l) => l.h < 10000).map((l) => l.speed),
					profile.motion.speed
				) / 10
			) * 10
		)
	);
	let scale = $derived((size / 2 - 14) / max);
	const at = (u, v) => [centre + u * scale, centre - v * scale];

	/** @type {{ top: number, colour: string }[]} */
	const COLOURS = [
		{ top: 1000, colour: '#ef4444' },
		{ top: 3000, colour: '#22c55e' },
		{ top: 6000, colour: '#eab308' },
		{ top: Infinity, colour: '#38bdf8' }
	];
	let segments = $derived.by(() => {
		const list = profile.levels.filter((l) => l.h <= 10000);
		const out = [];
		for (let i = 0; i < list.length - 1; i++) {
			const colour = COLOURS.find((band) => list[i].h < band.top).colour;
			out.push({ a: at(list[i].u, list[i].v), b: at(list[i + 1].u, list[i + 1].v), colour });
		}
		return out;
	});
	let motion = $derived(at(profile.motion.u, profile.motion.v));
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" class="block">
	{#each Array.from({ length: max / 10 }, (_, i) => (i + 1) * 10) as ring (ring)}
		<circle cx={centre} cy={centre} r={ring * scale} fill="none" stroke="rgba(255,255,255,0.12)" />
		<text
			x={centre + ring * scale - 2}
			y={centre - 3}
			font-size="9"
			fill="rgba(255,255,255,0.4)"
			text-anchor="end">{ring}</text
		>
	{/each}
	<line x1="0" y1={centre} x2={size} y2={centre} stroke="rgba(255,255,255,0.12)" />
	<line x1={centre} y1="0" x2={centre} y2={size} stroke="rgba(255,255,255,0.12)" />
	{#each segments as segment, i (i)}
		<line
			x1={segment.a[0]}
			y1={segment.a[1]}
			x2={segment.b[0]}
			y2={segment.b[1]}
			stroke={segment.colour}
			stroke-width="3"
			stroke-linecap="round"
		/>
	{/each}
	{#each profile.levels.filter((l) => l.h <= 10000) as level (level.p)}
		{@const [x, y] = at(level.u, level.v)}
		<circle cx={x} cy={y} r="2" fill="white" />
	{/each}
	<!-- The right mover -->
	<circle cx={motion[0]} cy={motion[1]} r="5" fill="none" stroke="white" stroke-width="2" />
	<text x={motion[0] + 8} y={motion[1] + 4} font-size="10" font-weight="700" fill="white">RM</text>
	<text x="6" y={size - 6} font-size="9" fill="rgba(255,255,255,0.45)">m/s</text>
</svg>
