<script>
	import { onMount } from 'svelte';
	import TerminalWindow from './TerminalWindow.svelte';

	let now = $state(new Date());
	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	const pad = (n) => n.toString().padStart(2, '0');
	let time = $derived(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
	let date = $derived(
		now.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		})
	);
</script>

<!-- Like tty-clock in a terminal -->
<TerminalWindow title="~ : tty-clock -c">
	<div class="px-4 py-1 text-center">
		<p class="text-6xl font-bold tracking-widest text-primary-500 tabular-nums">{time}</p>
		<p class="mt-1 text-white/60">
			{date} <span class="text-white/30">:{pad(now.getSeconds())}</span>
		</p>
	</div>
</TerminalWindow>
