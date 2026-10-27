<script>
	import { sameSong } from '#lib/tracks.ts';
	import { songQueue, updateSongQueue } from '#lib/stores/audio.ts';
	import { getImageUrl } from '#lib/stores/data.ts';
	import {
		addSongToPlaylist,
		getPlaylistSongs,
		playlistSongsCache,
		playlists
	} from '#lib/stores/playlist.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { smartPlaylists, addSeed, isSeed } from '#lib/stores/smartPlaylists.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import Modal from './Modal.svelte';

	export let map;
	export let open;
</script>

<Modal title="Add to playlist" bind:open>
	<div class="flex flex-col gap-4">
		<div>
			<p class="text-sm leading-relaxed">Select a playlist to add the Song to</p>
			<div class="flex flex-col gap-2 max-h-60 overflow-y-auto pr-2">
				{#each $playlists as playlist}
					{@const isSongInPlaylist = $playlistSongsCache[playlist.id]?.songs.some((song) =>
						sameSong(song, map)
					)}
					{#if playlist.id != -1 && playlist.id != -2}
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
								await addSongToPlaylist(playlist.id, map);
								await getPlaylistSongs(playlist.id);
								if ($songQueue.playlistId == playlist.id) {
									const isShuffled = $userSettings.settings.shuffle || false;

									if (isShuffled) {
										const currentQueue = [...$songQueue.queue, map];
										songQueue.update((queue) => ({
											...queue,
											queue: currentQueue
										}));
									} else {
										await updateSongQueue(
											$songQueue.currentIndex,
											$playlistSongsCache[playlist.id].songs,
											'playlist',
											playlist.id
										);
									}
								}
							}}
						>
							<img
								src={playlist.id !== -1 ? getImageUrl(playlist.image_url) : '/NoLetterLogo.png'}
								alt={playlist.title}
								class="size-12 object-cover rounded-md"
							/>
							{playlist?.title}
						</button>
					{/if}
				{/each}
				<!-- Smart playlists: the song is one autofill looks for more like -->
				{#each $smartPlaylists as smart (smart.id)}
					{@const added = isSeed(smart, map)}
					<button
						class="p-2 rounded flex items-center gap-2 text-start hover:bg-secondary-300 {added
							? 'cursor-not-allowed opacity-50'
							: 'cursor-pointer'}"
						onclick={() => {
							if (added) return;
							addSeed(smart.id, map);
							open = false;
							showToast(`Added to "${smart.title}"`, 'icon-[mingcute--magic-2-line]');
						}}
					>
						<span
							class="size-12 shrink-0 grid place-items-center rounded-md bg-gradient-to-br from-primary-300 to-primary-700"
						>
							<span class="icon-[mingcute--magic-2-line] size-6 text-white/90"></span>
						</span>
						<span class="min-w-0">
							<span class="block truncate">{smart.title}</span>
							<span class="block text-xs text-secondary-600">Smart playlist</span>
						</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
</Modal>
