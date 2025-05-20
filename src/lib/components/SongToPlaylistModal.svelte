<script>
	import { songQueue, updateSongQueue } from '$lib/stores/audio';
	import { getImageUrl } from '$lib/stores/data';
	import {
		addSongToPlaylist,
		getPlaylistSongs,
		playlistSongsCache,
		playlists
	} from '$lib/stores/playlist';
	import Modal from './Modal.svelte';

	export let map;
	export let open;
</script>

<Modal title="Add Song to Playlist" bind:open>
	<div class="flex flex-col gap-4">
		<div>
			<p class="text-sm leading-relaxed">Select a playlist to add the Song to</p>
			<div class="flex flex-col gap-2 max-h-60 overflow-y-auto pr-2">
				{#each $playlists as playlist}
					{@const isSongInPlaylist = $playlistSongsCache[playlist.id].songs.some(
						(song) => song.id == map.id
					)}
					{#if playlist.id !== -1}
						<button
							class="p-2 rounded flex items-center gap-2 hover:bg-secondary-300 {isSongInPlaylist
								? 'cursor-not-allowed opacity-50'
								: 'cursor-pointer'} "
							onclick={async () => {
								if (isSongInPlaylist) return;
								const updatedPlaylists = $playlists.map((p) => {
									if (p.id === playlist.id) {
										return { ...p, song_amount: p.song_amount + 1 };
									}
									return p;
								});

								playlists.set(updatedPlaylists);

								open = false;
								await addSongToPlaylist(playlist.id, map.id, map.beatmaps[0].id);
								await getPlaylistSongs(playlist.id, true);
								if ($songQueue.playlistId == playlist.id) {
									await updateSongQueue(
										$songQueue.currentIndex + 1,
										$playlistSongsCache[playlist.id].songs,
										'playlist',
										playlist.id
									);
								}
							}}
						>
							<img
								src={playlist.id !== -1 ? getImageUrl(playlist.image_path) : '/NoLetterLogo.png'}
								alt={playlist.title}
								class="size-12 object-cover rounded-md"
							/>
							{playlist?.title}
						</button>
					{/if}
				{/each}
			</div>
		</div>
	</div>
</Modal>
