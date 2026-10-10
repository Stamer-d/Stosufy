<script>
	import {
		songQueue,
		currentSong,
		upNext,
		queuePanelOpen,
		jumpTo,
		skipForward,
		removeQueuedSong,
		clearQueuedSongs
	} from '#lib/stores/audio.ts';
	import { playlists } from '#lib/stores/playlist.ts';
	import { handleImageError } from '#lib/stores/data.ts';

	const MAX_SHOWN = 50;

	let upcoming = $derived(
		($songQueue.queue ?? [])
			.map((song, index) => ({ song, index }))
			.slice(($songQueue.currentIndex ?? 0) + 1)
	);
	let sourceName = $derived(
		$songQueue.type === 'preview'
			? 'Search results'
			: ($playlists.find((playlist) => playlist.id == $songQueue.playlistId)?.title ?? 'Queue')
	);
</script>

{#snippet songRow(song, onclick, removeLabel = null, onremove = null)}
	<div class="group flex items-center gap-3 rounded-md p-1.5 hover:bg-secondary-300">
		<button class="flex flex-1 min-w-0 items-center gap-3 text-start cursor-pointer" {onclick}>
			<img
				src="https://assets.ppy.sh/beatmaps/{song.id}/covers/list.jpg"
				alt=""
				loading="lazy"
				class="size-10 rounded object-cover shrink-0"
				onerror={handleImageError}
			/>
			<div class="min-w-0">
				<div class="truncate text-sm font-medium">{song.title}</div>
				<div class="truncate text-xs text-secondary-600">{song.artist}</div>
			</div>
		</button>
		{#if onremove}
			<button
				aria-label={removeLabel}
				title={removeLabel}
				class="opacity-0 group-hover:opacity-100 p-1 flex text-secondary-600 hover:text-white cursor-pointer"
				onclick={onremove}
			>
				<span class="icon-[fa6-solid--xmark] size-4"></span>
			</button>
		{/if}
	</div>
{/snippet}

<aside class="h-full w-80 flex flex-col bg-secondary-200 text-white" aria-label="Queue">
	<div class="flex items-center justify-between p-4">
		<h2 class="text-xl font-bold">Queue</h2>
		<button
			aria-label="Close queue"
			class="p-1 flex text-gray-400 hover:text-white cursor-pointer"
			onclick={() => queuePanelOpen.set(false)}
		>
			<span class="icon-[fa6-solid--xmark] size-5"></span>
		</button>
	</div>

	<div class="flex-1 overflow-y-auto px-2 pb-4 flex flex-col gap-4">
		{#if $currentSong.song}
			<section>
				<h3 class="px-1.5 mb-1 text-sm font-semibold text-secondary-600">Now playing</h3>
				<div class="flex items-center gap-3 p-1.5">
					<img
						src="https://assets.ppy.sh/beatmaps/{$currentSong.song.id}/covers/list.jpg"
						alt=""
						class="size-10 rounded object-cover shrink-0"
						onerror={handleImageError}
					/>
					<div class="min-w-0">
						<div class="truncate text-sm font-medium text-primary-500">
							{$currentSong.song.title}
						</div>
						<div class="truncate text-xs text-secondary-600">{$currentSong.song.artist}</div>
					</div>
				</div>
			</section>
		{/if}

		{#if $upNext.length}
			<section>
				<div class="flex items-center justify-between px-1.5 mb-1">
					<h3 class="text-sm font-semibold text-secondary-600">Next in queue</h3>
					<button
						class="text-xs text-secondary-600 hover:text-white cursor-pointer"
						onclick={clearQueuedSongs}
					>
						Clear
					</button>
				</div>
				{#each $upNext as song, index (index + '-' + song.id)}
					{@render songRow(
						song,
						() => {
							// Play it now: move it to the front of the queue and skip to it
							removeQueuedSong(index);
							upNext.update((songs) => [song, ...songs]);
							skipForward();
						},
						'Remove from queue',
						() => removeQueuedSong(index)
					)}
				{/each}
			</section>
		{/if}

		{#if upcoming.length}
			<section>
				<h3 class="px-1.5 mb-1 text-sm font-semibold text-secondary-600 truncate">
					Next from: {sourceName}
				</h3>
				{#each upcoming.slice(0, MAX_SHOWN) as { song, index } (index + '-' + song.id)}
					{@render songRow(song, () => jumpTo(index))}
				{/each}
				{#if upcoming.length > MAX_SHOWN}
					<p class="px-1.5 pt-1 text-xs text-secondary-600">
						+ {upcoming.length - MAX_SHOWN} more
					</p>
				{/if}
			</section>
		{/if}

		{#if !$currentSong.song}
			<div class="flex flex-col items-center gap-2 mt-16 px-4 text-center text-secondary-600">
				<span class="icon-[mingcute--playlist-2-line] size-10"></span>
				<p>Nothing is playing</p>
				<p class="text-sm">Play a song or right-click one and choose "Add to queue"</p>
			</div>
		{:else if !$upNext.length && !upcoming.length}
			<p class="px-1.5 text-sm text-secondary-600">
				Nothing up next. Right-click a song and choose "Add to queue".
			</p>
		{/if}
	</div>
</aside>
