<script>
	import { fly } from 'svelte/transition';
	import { TABLES, tableStyle } from '#lib/puzzle/table.ts';
	import { puzzleVolume, setPuzzleVolume, snapSound } from '#lib/puzzle/sounds.ts';

	/**
	 * The puzzle's settings during a round: how loud its sounds are and what it lies on
	 * @type {{ onvolume?: (volume: number) => void }}
	 */
	let { onvolume = () => {} } = $props();

	let open = $state(false);
	let volume = $state(puzzleVolume());
	let root = $state();

	$effect(() => {
		if (!open) return;
		const close = (event) => {
			if (!root?.contains(event.target)) open = false;
		};
		window.addEventListener('pointerdown', close, true);
		return () => window.removeEventListener('pointerdown', close, true);
	});
</script>

<div class="relative" bind:this={root}>
	<button
		title="Sound and table"
		aria-label="Sound and table"
		aria-expanded={open}
		class="size-9 grid place-items-center rounded-full cursor-pointer transition {open
			? 'bg-white/20'
			: 'hover:bg-white/15'}"
		onclick={() => (open = !open)}
	>
		<span class="icon-[mingcute--settings-3-line] size-5"></span>
	</button>
	{#if open}
		<div
			class="absolute right-0 top-11 z-[100030] w-72 p-4 rounded-xl bg-secondary-100/95 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl flex flex-col gap-4"
			transition:fly={{ y: -6, duration: 150 }}
		>
			<label class="flex flex-col gap-2 text-sm">
				<span class="flex items-center gap-2 font-semibold">
					<span class="icon-[mingcute--volume-line] size-4"></span>Puzzle sounds
					<span class="ml-auto text-white/50 tabular-nums">{Math.round(volume * 100)}%</span>
				</span>
				<input
					type="range"
					min="0"
					max="1.5"
					step="0.05"
					bind:value={volume}
					oninput={() => {
						setPuzzleVolume(volume);
						onvolume(volume);
					}}
					onchange={() => snapSound(0.6)}
					class="w-full accent-primary-400"
				/>
			</label>
			<div class="flex flex-col gap-2 text-sm">
				<span class="flex items-center gap-2 font-semibold">
					<span class="icon-[mingcute--pic-line] size-4"></span>Table
				</span>
				<div class="grid grid-cols-3 gap-2">
					{#each TABLES as table (table.id)}
						<button
							title={table.label}
							aria-label={table.label}
							aria-pressed={$tableStyle === table.id}
							class="h-10 rounded-lg cursor-pointer ring-2 transition {$tableStyle === table.id
								? 'ring-primary-400'
								: 'ring-white/10 hover:ring-white/30'}"
							style="background: {table.id === 'picture'
								? 'linear-gradient(135deg, #6b4c8a, #2a2238)'
								: table.css}"
							onclick={() => tableStyle.set(table.id)}
						>
							{#if table.id === 'picture'}
								<span class="icon-[mingcute--pic-line] size-4 text-white/80"></span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
