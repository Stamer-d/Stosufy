<script>
	import Widget from './MacWidget.svelte';
	import PlaylistCover from '../PlaylistCover.svelte';
	import { playlists } from '#lib/stores/playlist.ts';
	import { goto } from '$app/navigation';
</script>

<Widget size="medium" label="Playlists">
	<div class="grid grid-cols-4 gap-2.5">
		{#each $playlists.slice(0, 4) as playlist (playlist.id)}
			<button
				class="min-w-0 text-start cursor-pointer group"
				aria-label="Open {playlist.title}"
				onclick={() => goto(`/playlist/${playlist.id}`)}
			>
				<PlaylistCover
					{playlist}
					class="w-full aspect-square rounded-xl transition group-hover:scale-105"
					iconClass="size-6"
				/>
				<p class="mt-1.5 text-xs font-semibold truncate">{playlist.title}</p>
			</button>
		{/each}
	</div>
</Widget>
