<script>
	// What's coming, while it loads: grey shapes where the songs (rows) or playlists (grid)
	// will be, as Spotify shows, not an empty page with a spinner. Still (no shimmer: a phone
	// stays cool).
	let { rows = 8, grid = false, avatars = false } = $props();
	// (the lines a little different in length, as titles are)
	const WIDTHS = ['62%', '48%', '71%', '55%', '66%', '44%', '58%', '69%', '51%', '64%'];
</script>

<div aria-busy="true" aria-label="Loading" class="pointer-events-none">
	{#if grid}
		<ul class="px-2 pb-4 grid grid-cols-2 gap-1">
			{#each { length: rows } as _, i (i)}
				<li class="p-2">
					<div class="w-full aspect-square rounded-md bg-white/[0.06]"></div>
					<div
						class="mt-2.5 h-3.5 rounded-full bg-white/[0.08]"
						style="width: {WIDTHS[i % 10]}"
					></div>
					<div class="mt-2 h-3 w-2/5 rounded-full bg-white/[0.05]"></div>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="px-2">
			{#each { length: rows } as _, i (i)}
				<li class="flex items-center gap-3 pl-2 py-2">
					<div
						class="size-12 shrink-0 bg-white/[0.06] {avatars ? 'rounded-full' : 'rounded'}"
					></div>
					<div class="flex-1 min-w-0">
						<div class="h-3.5 rounded-full bg-white/[0.08]" style="width: {WIDTHS[i % 10]}"></div>
						<div class="mt-2 h-3 w-1/3 rounded-full bg-white/[0.05]"></div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
