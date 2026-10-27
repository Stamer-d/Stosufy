<script>
	// Adds a song to one of your playlists or smart playlists. A playlist that has the song
	// says so; one that has the same song of another beatmap (a TV size, a cut…) asks first.
	import { sameSong, songName } from '#lib/tracks.ts';
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

	/** @type {{ map: import('#lib/types.ts').MapSet | null, open: boolean }} */
	let { map = $bindable(), open = $bindable() } = $props();

	/** The playlist that asks "add it anyway?" (it has the song of another beatmap) */
	let confirming = $state(null);
	$effect(() => {
		if (!open) confirming = null;
	});

	let ownPlaylists = $derived($playlists.filter((p) => p.id != -1 && p.id != -2));

	/** What a playlist has of the song: this very song, or the same one of another beatmap */
	function inPlaylist(playlistId) {
		if (!map) return null;
		const songs = $playlistSongsCache[playlistId]?.songs ?? [];
		if (songs.some((song) => sameSong(song, map))) return { exact: true, other: null };
		const name = songName(map);
		const other = songs.find((song) => songName(song) === name);
		return other ? { exact: false, other } : null;
	}

	function choose(playlist, found) {
		if (found?.exact) return;
		if (found && confirming !== playlist.id) {
			confirming = playlist.id;
			return;
		}
		add(playlist);
	}

	async function add(playlist) {
		const song = map;
		playlists.update((list) =>
			list.map((p) => (p.id === playlist.id ? { ...p, song_amount: p.song_amount + 1 } : p))
		);
		open = false;
		await addSongToPlaylist(playlist.id, song);
		await getPlaylistSongs(playlist.id);
		showToast(`Added to "${playlist.title}"`, 'icon-[mingcute--playlist-2-line]');
		// Playing that playlist: the song comes along
		if ($songQueue.playlistId != playlist.id) return;
		if ($userSettings.settings.shuffle) {
			songQueue.update((queue) => ({ ...queue, queue: [...queue.queue, song] }));
		} else {
			await updateSongQueue(
				$songQueue.currentIndex,
				$playlistSongsCache[playlist.id].songs,
				'playlist',
				playlist.id
			);
		}
	}
</script>

<Modal title="Add to playlist" bind:open>
	<div class="flex flex-col gap-4">
		<div>
			<p class="text-sm leading-relaxed">Select a playlist to add the song to</p>
			<div class="flex flex-col gap-2 max-h-60 overflow-y-auto pr-2">
				{#each ownPlaylists as playlist (playlist.id)}
					{@const found = inPlaylist(playlist.id)}
					<button
						class="p-2 rounded flex items-center gap-2 text-start hover:bg-secondary-300 {found?.exact
							? 'cursor-not-allowed opacity-50'
							: 'cursor-pointer'}"
						aria-disabled={found?.exact}
						onclick={() => choose(playlist, found)}
					>
						<img
							src={getImageUrl(playlist.image_url)}
							alt={playlist.title}
							class="size-12 shrink-0 object-cover rounded-md"
						/>
						<span class="min-w-0">
							<span class="block truncate">{playlist.title}</span>
							{#if found?.exact}
								<span class="block text-xs text-secondary-600">Already in it</span>
							{:else if found}
								<span class="block text-xs text-amber-300 truncate">
									{confirming === playlist.id
										? 'Click again to add it anyway'
										: `Has it already: "${found.other.title}"`}
								</span>
							{/if}
						</span>
					</button>
				{/each}
				<!-- Smart playlists: the song is one autofill looks for more like -->
				{#each $smartPlaylists as smart (smart.id)}
					{@const added = map ? isSeed(smart, map) : false}
					<button
						class="p-2 rounded flex items-center gap-2 text-start hover:bg-secondary-300 {added
							? 'cursor-not-allowed opacity-50'
							: 'cursor-pointer'}"
						aria-disabled={added}
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
							<span class="block text-xs text-secondary-600">
								{added ? 'Already in it' : 'Smart playlist'}
							</span>
						</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
</Modal>
