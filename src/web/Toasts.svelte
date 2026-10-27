<script>
	// Short notes above the player (the shared toast store: "Added to …", errors)
	import { toasts } from '../lib/stores/toast';
</script>

<div class="fixed inset-x-0 bottom-40 z-50 flex flex-col items-center gap-2 pointer-events-none">
	{#each $toasts as toast (toast.id)}
		<div
			class="max-w-[90%] px-4 py-2.5 rounded-full bg-white text-black text-sm font-semibold shadow-lg flex items-center gap-2"
		>
			{#if toast.icon}<span class="{toast.icon} size-4 shrink-0"></span>{/if}
			<span class="truncate">{toast.message}</span>
		</div>
	{/each}
</div>
