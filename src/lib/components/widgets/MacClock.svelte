<script>
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';

	let now = $state(new Date());
	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	let seconds = $derived(now.getSeconds());
	let minutes = $derived(now.getMinutes() + seconds / 60);
	let hours = $derived((now.getHours() % 12) + minutes / 60);
</script>

<!-- Analog clock like the macOS Clock widget -->
<Widget size="small" class="!p-3">
	<svg viewBox="0 0 100 100" class="size-full" aria-label={now.toLocaleTimeString()}>
		<circle cx="50" cy="50" r="48" class="fill-white/95" />
		{#each Array(60) as _, i (i)}
			<line
				x1="50"
				y1={i % 5 === 0 ? 7 : 6}
				x2="50"
				y2={i % 5 === 0 ? 13 : 9}
				transform="rotate({i * 6} 50 50)"
				class={i % 5 === 0 ? 'stroke-black' : 'stroke-black/40'}
				stroke-width={i % 5 === 0 ? 1.6 : 0.6}
				stroke-linecap="round"
			/>
		{/each}
		{#each [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as number, i (number)}
			<text
				x={50 + 30 * Math.sin((i * Math.PI) / 6)}
				y={50 - 30 * Math.cos((i * Math.PI) / 6)}
				text-anchor="middle"
				dominant-baseline="central"
				class="fill-black text-[9px] font-semibold">{number}</text
			>
		{/each}
		<line
			x1="50"
			y1="50"
			x2="50"
			y2="27"
			transform="rotate({hours * 30} 50 50)"
			class="stroke-black"
			stroke-width="3"
			stroke-linecap="round"
		/>
		<line
			x1="50"
			y1="50"
			x2="50"
			y2="15"
			transform="rotate({minutes * 6} 50 50)"
			class="stroke-black"
			stroke-width="2"
			stroke-linecap="round"
		/>
		<line
			x1="50"
			y1="58"
			x2="50"
			y2="12"
			transform="rotate({seconds * 6} 50 50)"
			class="stroke-primary-300"
			stroke-width="1"
			stroke-linecap="round"
		/>
		<circle cx="50" cy="50" r="2.2" class="fill-primary-300" />
	</svg>
</Widget>
