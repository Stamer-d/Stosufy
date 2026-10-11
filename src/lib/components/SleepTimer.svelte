<script>
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { sleepTimer, setSleepTimer } from '#lib/stores/audio.ts';

	const OPTIONS = [
		{ value: 15, label: '15 minutes' },
		{ value: 30, label: '30 minutes' },
		{ value: 45, label: '45 minutes' },
		{ value: 60, label: '1 hour' },
		{ value: 90, label: '1.5 hours' },
		{ value: 'song', label: 'End of this song' }
	];

	let open = $state(false);
	let root = $state(null);
	let now = $state(Date.now());
	const clock = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(clock));

	let active = $derived(!!$sleepTimer.until || $sleepTimer.endOfSong);
	let remaining = $derived.by(() => {
		if (!$sleepTimer.until) return '';
		const seconds = Math.max(0, Math.round(($sleepTimer.until - now) / 1000));
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	});

	function choose(value) {
		setSleepTimer(value);
		open = false;
	}
</script>

<svelte:window
	onclick={(e) => open && !root?.contains(e.target) && (open = false)}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
/>

<div class="relative" bind:this={root}>
	<button
		title={active ? `Sleep timer: ${remaining || 'end of song'}` : 'Sleep timer'}
		aria-label="Sleep timer"
		aria-expanded={open}
		class="h-8 min-w-8 px-1.5 flex items-center gap-1 rounded-full cursor-pointer transition {active
			? 'text-primary-500'
			: 'text-white/60 hover:text-white'}"
		onclick={() => (open = !open)}
	>
		<span class="icon-[mingcute--moon-line] size-5"></span>
		{#if active}
			<span class="text-xs font-semibold tabular-nums">{remaining || 'End'}</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute bottom-full right-0 mb-3 w-56 p-1.5 rounded-xl bg-secondary-300 ring-1 ring-white/5 shadow-xl shadow-black/40 z-50"
			transition:fly={{ y: 6, duration: 150 }}
		>
			<h3 class="px-2.5 pt-1.5 pb-1 text-xs font-bold uppercase tracking-wider text-secondary-600">
				Stop playing after
			</h3>
			{#each OPTIONS as option (option.value)}
				{@const selected = option.value === 'song' ? $sleepTimer.endOfSong : false}
				<button
					class="w-full flex items-center justify-between h-9 px-2.5 rounded-md text-sm text-start cursor-pointer hover:bg-white/[0.06] {selected
						? 'text-primary-500'
						: 'text-white'}"
					onclick={() => choose(option.value)}
				>
					{option.label}
					{#if selected}<span class="icon-[mingcute--check-line] size-4"></span>{/if}
				</button>
			{/each}
			{#if active}
				<div class="my-1 h-px bg-white/5"></div>
				<button
					class="w-full h-9 px-2.5 rounded-md text-sm text-start text-red-400 cursor-pointer hover:bg-white/[0.06]"
					onclick={() => choose(null)}
				>
					Turn off{remaining ? ` (${remaining} left)` : ''}
				</button>
			{/if}
		</div>
	{/if}
</div>
