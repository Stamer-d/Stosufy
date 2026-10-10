<script>
	import Widget from './Widget.svelte';
	import PlaylistCover from '../PlaylistCover.svelte';
	import { playlists } from '#lib/stores/playlist.ts';
	import { songQueue, currentSong } from '#lib/stores/audio.ts';
	import { goto } from '$app/navigation';
</script>

{#if $playlists.length}
	<Widget class="flex items-end gap-2 p-2">
		{#each $playlists.slice(0, 8) as playlist (playlist.id)}
			{@const playing = $songQueue.playlistId == playlist.id && $currentSong.isPlaying}
			<button
				title={playlist.title}
				aria-label="Open {playlist.title}"
				class="group relative cursor-pointer transition duration-150 hover:-translate-y-1"
				onclick={() => goto(`/playlist/${playlist.id}`)}
			>
				<PlaylistCover {playlist} class="size-12 rounded-lg" />
				<span
					class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 size-1 rounded-full {playing
						? 'bg-primary-400'
						: 'bg-transparent'}"
				></span>
			</button>
		{/each}
	</Widget>
{/if}
