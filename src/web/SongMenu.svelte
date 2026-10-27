<script>
	// What can be done with a song (the ⋯ of a row): play it next, like it, add it to a
	// playlist, take it out of the playlist it's in, keep it on the phone
	import { songMenu, ownPlaylists } from './library';
	import { startRadio } from './listening';
	import { swipe } from './gestures';
	import { fade, fly } from 'svelte/transition';
	import { playNext, addToQueue, coverUrl } from './player';
	import { downloaded, downloading, download, removeDownload, isDownloaded } from './downloads';
	import {
		playlists,
		playlistSongsCache,
		addSongToPlaylist,
		removeSongFromPlaylist
	} from '../lib/stores/playlist';
	import { isFavourite, toggleFavourite } from '../lib/stores/favourites';
	import { showToast } from '../lib/stores/toast';
	import { sameSong } from '../lib/tracks';

	let song = $derived($songMenu?.song ?? null);
	let from = $derived($songMenu?.playlistId);
	/** The list of playlists to add it to is shown */
	let choosing = $state(false);
	$effect(() => {
		if (!$songMenu) choosing = false;
	});

	let removable = $derived(
		from != null && Number(from) > 0 && $playlists.some((p) => p.id == from) && song?.songInfo?.id
	);

	const close = () => songMenu.set(null);

	/** Does it for the song (and the playlist it's in), with the menu closed right away */
	function act(run, note, icon = 'icon-[mingcute--check-line]') {
		// (taken before closing: closing forgets which song and playlist the menu was for)
		const target = song;
		const playlistId = from;
		close();
		Promise.resolve(run(target, playlistId)).then(
			// (false: it said so itself)
			(result) => result !== false && note && showToast(note, icon),
			(e) => showToast(e instanceof Error ? e.message : String(e), 'icon-[mingcute--warning-line]')
		);
	}

	const has = (playlist) =>
		($playlistSongsCache[playlist.id]?.songs ?? []).some((other) => sameSong(other, song));

	function addTo(playlist) {
		if (has(playlist)) return;
		playlists.update((list) =>
			list.map((p) => (p.id === playlist.id ? { ...p, song_amount: p.song_amount + 1 } : p))
		);
		const target = song;
		close();
		// (if it doesn't work, the playlist store says so)
		addSongToPlaylist(playlist.id, target).then(
			(added) => added && showToast(`Added to "${playlist.title}"`, 'icon-[mingcute--check-line]')
		);
	}
</script>

{#if song}
	<div class="fixed inset-0 z-40 flex flex-col justify-end">
		<button
			class="absolute inset-0 bg-black/60"
			aria-label="Close"
			onclick={close}
			transition:fade={{ duration: 150 }}
		></button>
		<!-- (swiped down, it closes) -->
		<div
			class="relative max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-panel pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
			transition:fly={{ y: 400, duration: 220, opacity: 1 }}
			use:swipe={{ axis: 'y', only: 1, onswipe: close }}
		>
			<div class="pt-2 flex justify-center">
				<span class="w-10 h-1 rounded-full bg-white/20"></span>
			</div>
			<div class="sticky top-0 bg-panel flex items-center gap-3 p-4 border-b border-white/5">
				<img src={coverUrl(song)} alt="" class="size-12 rounded object-cover bg-secondary-300" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold truncate">{song.title}</p>
					<p class="text-sm text-secondary-600 truncate">{song.artist}</p>
				</div>
				{#if choosing}
					<button class="text-sm text-secondary-600" onclick={() => (choosing = false)}>Back</button
					>
				{/if}
			</div>

			{#snippet item(icon, label, onclick, extra = '')}
				<li>
					<button
						class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5 {extra}"
						{onclick}
					>
						<span class="{icon} size-6 shrink-0"></span>
						{label}
					</button>
				</li>
			{/snippet}

			{#if choosing}
				<ul class="py-1">
					{#each ownPlaylists($playlists) as playlist (playlist.id)}
						{@const already = has(playlist)}
						<li>
							<button
								class="w-full flex items-center gap-4 px-5 py-3 text-start active:bg-white/5 {already
									? 'opacity-50'
									: ''}"
								disabled={already}
								onclick={() => addTo(playlist)}
							>
								<span class="icon-[mingcute--playlist-2-line] size-6 shrink-0"></span>
								<span class="min-w-0 flex-1 truncate">{playlist.title}</span>
								{#if already}<span class="text-xs text-secondary-600">Already in it</span>{/if}
							</button>
						</li>
					{:else}
						<li class="px-5 py-4 text-sm text-secondary-600">No playlists of your own yet</li>
					{/each}
				</ul>
			{:else}
				{@const kept = isDownloaded($downloaded, song)}
				{@const liked = $isFavourite(song)}
				<ul class="py-1">
					{@render item('icon-[mingcute--play-circle-line]', 'Play next', () =>
						act(playNext, 'Plays next')
					)}
					{@render item('icon-[mingcute--list-check-line]', 'Add to queue', () =>
						act(addToQueue, 'Added to the queue')
					)}
					{@render item('icon-[mingcute--radio-line]', 'Start radio', () =>
						act(
							async (target) => {
								showToast('Looking for songs like it…', 'icon-[mingcute--radio-line]');
								if (!(await startRadio(target)))
									throw new Error('Found no songs like it in your playlists');
							},
							'Radio started',
							'icon-[mingcute--radio-line]'
						)
					)}
					{@render item(
						liked ? 'icon-[mingcute--heart-fill] text-primary-400' : 'icon-[mingcute--heart-line]',
						liked ? 'Remove from Liked Songs' : 'Add to Liked Songs',
						() => act(toggleFavourite, liked ? 'Removed from Liked Songs' : 'Liked')
					)}
					{@render item(
						'icon-[mingcute--add-circle-line]',
						'Add to playlist',
						() => (choosing = true)
					)}
					{#if removable}
						{@render item('icon-[mingcute--delete-2-line]', 'Remove from this playlist', () =>
							act(
								(target, playlistId) => removeSongFromPlaylist(playlistId, target.songInfo.id),
								'Removed'
							)
						)}
					{/if}
					{#if $downloading.has(String(song.beatmaps?.[0]?.id))}
						{@render item('icon-[svg-spinners--ring-resize]', 'Downloading…', close)}
					{:else if kept}
						{@render item('icon-[mingcute--delete-back-line]', 'Remove from the phone', () =>
							act(removeDownload, 'Removed from the phone')
						)}
					{:else}
						{@render item('icon-[mingcute--download-2-line]', 'Download', () =>
							act(download, 'Downloaded')
						)}
					{/if}
					{@render item('icon-[mingcute--share-forward-line]', 'Share', () =>
						act(
							async (target) => {
								const url = `https://osu.ppy.sh/beatmapsets/${target.id}`;
								const text = `${target.artist} - ${target.title}`;
								if (navigator.share) {
									await navigator.share({ title: text, text, url }).catch(() => {});
									return false;
								}
								await navigator.clipboard.writeText(`${text} ${url}`);
							},
							'Link copied',
							'icon-[mingcute--copy-2-line]'
						)
					)}
					<li>
						<a
							class="w-full flex items-center gap-4 px-5 py-3.5 active:bg-white/5"
							href="https://osu.ppy.sh/beatmapsets/{song.id}"
							target="_blank"
							rel="noreferrer"
							onclick={close}
						>
							<span class="icon-[mingcute--external-link-line] size-6 shrink-0"></span>
							Open on osu!
						</a>
					</li>
				</ul>
			{/if}
		</div>
	</div>
{/if}
