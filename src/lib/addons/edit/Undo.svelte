<script>
	// Undo and redo (and Ctrl+Z, Ctrl+Y: see history.svelte.ts)
	/** @type {{ history: ReturnType<typeof import('./history.svelte.ts').createHistory> }} */
	let { history } = $props();
</script>

<div class="inline-flex gap-0.5">
	<button
		class="size-8 grid place-items-center rounded-full text-white/70 hover:text-white hover:bg-white/10 cursor-pointer transition disabled:opacity-30 disabled:cursor-default"
		aria-label="Undo"
		title="Undo (Ctrl+Z)"
		disabled={!history.state.canUndo}
		onclick={() => history.undo()}
	>
		<span class="icon-[ri--arrow-go-back-line] size-4"></span>
	</button>
	<button
		class="size-8 grid place-items-center rounded-full text-white/70 hover:text-white hover:bg-white/10 cursor-pointer transition disabled:opacity-30 disabled:cursor-default"
		aria-label="Redo"
		title="Redo (Ctrl+Y)"
		disabled={!history.state.canRedo}
		onclick={() => history.redo()}
	>
		<span class="icon-[ri--arrow-go-forward-line] size-4"></span>
	</button>
</div>
