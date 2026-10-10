<script>
	import { fly } from 'svelte/transition';
	import { toasts } from '#lib/stores/toast.ts';
</script>

<div
	class="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
	aria-live="polite"
>
	{#each $toasts as toast (toast.id)}
		<div
			class="flex items-center gap-2 bg-secondary-400 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg"
			transition:fly={{ y: 10, duration: 150 }}
		>
			{#if toast.icon}
				<span class="{toast.icon} size-3.5 text-primary-500"></span>
			{/if}
			{toast.message}
		</div>
	{/each}
</div>
