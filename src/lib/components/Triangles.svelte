<script>
	/**
	 * Triangles drifting upwards, the signature background of osu!lazer.
	 * @type {{ count?: number, color?: string, class?: string, seed?: number }}
	 */
	let { count = 18, color = 'white', class: className = '', seed = 1 } = $props();

	// Deterministic pseudo random numbers, so the pattern doesn't change on every render
	function random(n) {
		const x = Math.sin(seed * 9301 + n * 49297) * 233280;
		return x - Math.floor(x);
	}

	let triangles = $derived(
		Array.from({ length: count }, (_, i) => ({
			left: random(i) * 100,
			size: 30 + random(i + 100) * 110,
			opacity: 0.04 + random(i + 200) * 0.1,
			duration: 18 + random(i + 300) * 22,
			delay: -random(i + 400) * 40
		}))
	);
</script>

<div class="pointer-events-none absolute inset-0 overflow-hidden {className}" aria-hidden="true">
	{#each triangles as triangle, i (i)}
		<div
			class="animate-triangle absolute"
			style="left: {triangle.left}%; width: {triangle.size}px; height: {triangle.size *
				0.866}px; opacity: {triangle.opacity}; background: {color}; clip-path: polygon(50% 0, 100% 100%, 0 100%); animation: triangle-rise {triangle.duration}s linear {triangle.delay}s infinite;"
		></div>
	{/each}
</div>
