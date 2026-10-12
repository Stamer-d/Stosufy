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

	// The month shown: this one, or one browsed to with the arrows
	let shift = $state(0);
	let month = $derived(new Date(today.getFullYear(), today.getMonth() + shift, 1));
	let isThisMonth = $derived(shift === 0);

	let days = $derived.by(() => {
		const first = month;
		const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
		// Weeks start on Monday
		const offset = (first.getDay() + 6) % 7;
		return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
	});
	const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
</script>

<Widget size="small">
	<div class="flex items-center gap-1">
		<button
			class="text-[11px] font-bold uppercase tracking-wide text-red-400 truncate cursor-pointer"
			title="Back to today"
			onclick={() => (shift = 0)}
		>
			{month.toLocaleDateString('en-US', {
				month: 'long',
				year: month.getFullYear() === today.getFullYear() ? undefined : 'numeric'
			})}
		</button>
		<button
			class="ms-auto grid place-items-center size-4 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Last month"
			onclick={() => shift--}><span class="icon-[mingcute--left-line] size-3"></span></button
		>
		<button
			class="grid place-items-center size-4 rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Next month"
			onclick={() => shift++}><span class="icon-[mingcute--right-line] size-3"></span></button
		>
	</div>
	<div class="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-[10px] leading-4 tabular-nums">
		{#each WEEKDAYS as day, i (i)}
			<span class="font-bold text-white/45">{day}</span>
		{/each}
		{#each days as day, i (i)}
			<span
				class="mx-auto size-4 grid place-items-center rounded-full {isThisMonth &&
				day === today.getDate()
					? 'bg-red-500 font-bold text-white'
					: i % 7 > 4
						? 'text-white/55'
						: ''}">{day ?? ''}</span
			>
		{/each}
	</div>
</Widget>
