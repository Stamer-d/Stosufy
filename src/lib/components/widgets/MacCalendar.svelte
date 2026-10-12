<script>
	// This month, with today marked
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';

	let today = $state(new Date());
	onMount(() => {
		// The date changes at midnight
		const timer = setInterval(() => {
			const now = new Date();
			if (now.getDate() !== today.getDate()) today = now;
		}, 60_000);
		return () => clearInterval(timer);
	});

	let days = $derived.by(() => {
		const first = new Date(today.getFullYear(), today.getMonth(), 1);
		const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
		// Weeks start on Monday
		const offset = (first.getDay() + 6) % 7;
		return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
	});
	const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
</script>

<Widget size="small">
	<p class="text-[11px] font-bold uppercase tracking-wide text-red-400">
		{today.toLocaleDateString('en-US', { month: 'long' })}
	</p>
	<div class="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-[10px] leading-4 tabular-nums">
		{#each WEEKDAYS as day, i (i)}
			<span class="font-bold text-white/45">{day}</span>
		{/each}
		{#each days as day, i (i)}
			<span
				class="mx-auto size-4 grid place-items-center rounded-full {day === today.getDate()
					? 'bg-red-500 font-bold text-white'
					: i % 7 > 4
						? 'text-white/55'
						: ''}">{day ?? ''}</span
			>
		{/each}
	</div>
</Widget>
