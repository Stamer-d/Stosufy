<script>
	import { onMount } from 'svelte';
	import { user } from '#lib/stores/user.ts';

	/** @type {{ size?: 'md' | 'lg' }} */
	let { size = 'md' } = $props();

	let now = $state(new Date());
	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	let time = $derived(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
	let date = $derived(
		now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
	);
	let greeting = $derived(
		now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'
	);
</script>

<div class="text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
	<div
		class="font-extrabold tracking-tight tabular-nums leading-none {size === 'lg'
			? 'text-9xl'
			: 'text-7xl'}"
	>
		{time}
	</div>
	<div class="mt-3 text-lg font-semibold text-white/90">{date}</div>
	<div class="text-white/70">{greeting}{$user?.username ? `, ${$user.username}` : ''}</div>
</div>
