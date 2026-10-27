<script>
	const base = __WEB_BASE__;
	// A playlist's songs: tap one to play the playlist from there; ⤓ keeps a song on the phone
	import { page } from '$app/state';
	import {
		playlists,
		savedPlaylists,
		otherPlaylists,
		playlistSongsCache,
		getPlaylistSongs
	} from '../../../../lib/stores/playlist';
	import { songsLength, sameSong } from '../../../../lib/tracks';
	import { play, queue, playing, coverUrl } from '../../../player';
	import {
		downloaded,
		downloading,
		download,
		removeDownload,
		isDownloaded
	} from '../../../downloads';

	let id = $derived(page.params.id);
	let playlist = $derived(
		$playlists.find((p) => p.id == id) ??
			$savedPlaylists.find((p) => p.id == id) ??
			$otherPlaylists[id] ??
			null
	);
	let songs = $derived($playlistSongsCache[id]?.songs ?? []);
	let error = $state('');
	let loading = $state(false);
	let downloadError = $state('');

	$effect(() => {
		const wanted = id;
		loading = true;
		error = '';
		getPlaylistSongs(wanted)
			.then((result) => {
				if (wanted === id && result.error) error = result.error;
			})
			.finally(() => wanted === id && (loading = false));
	});

	const time = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
	const isPlaying = (song) => sameSong($queue.songs[$queue.index], song) && $playing;

	async function keep(song) {
		downloadError = '';
		try {
			if (isDownloaded($downloaded, song)) await removeDownload(song);
			else await download(song);
		} catch (e) {
			downloadError = `Couldn't download "${song.title}": ${e instanceof Error ? e.message : e}`;
		}
	}
</script>

<header class="px-5 pt-4 pb-3">
	<a href="{base}/" class="text-sm text-secondary-600 flex items-center gap-1">
		<span class="icon-[mingcute--left-line] size-4"></span> Playlists
	</a>
	<h1 class="mt-2 text-3xl font-extrabold truncate">
		{playlist?.title ?? (id == '-2' ? 'Liked Songs' : 'Playlist')}
	</h1>
	<p class="text-sm text-secondary-600">
		{songs.length} songs{songs.length ? ` · ${songsLength(songs)}` : ''}
	</p>
	<div class="mt-3 flex gap-2">
		<button
			class="h-10 px-5 rounded-full bg-primary-300 font-semibold flex items-center gap-2 disabled:opacity-40"
			disabled={!songs.length}
			onclick={() => play(songs, 0)}
		>
			<span class="icon-[mingcute--play-fill] size-5"></span> Play
		</button>
		<button
			class="h-10 px-5 rounded-full bg-white/10 font-semibold flex items-center gap-2 disabled:opacity-40"
			disabled={!songs.length}
			onclick={() =>
				play(
					[...songs].sort(() => Math.random() - 0.5),
					0
				)}
		>
			<span class="icon-[mingcute--shuffle-2-line] size-5"></span> Shuffle
		</button>
	</div>
</header>

{#if error}
	<p class="px-5 text-sm text-red-400">Couldn't load the songs: {error}</p>
{:else if loading && !songs.length}
	<p class="px-5 text-sm text-secondary-600">Loading…</p>
{/if}
{#if downloadError}
	<p class="px-5 pb-2 text-sm text-amber-300">{downloadError}</p>
{/if}

<ol class="px-3">
	{#each songs as song, i (`${song.id}:${song.track ?? 0}:${i}`)}
		{@const kept = isDownloaded($downloaded, song)}
		{@const busy = $downloading.has(String(song.beatmaps?.[0]?.id))}
		<li class="flex items-center gap-1">
			<button
				class="min-w-0 flex-1 flex items-center gap-3 p-2 rounded-lg text-start active:bg-white/5"
				onclick={() => play(songs, i)}
			>
				<img
					src={coverUrl(song)}
					alt=""
					loading="lazy"
					class="size-11 shrink-0 rounded object-cover bg-secondary-300"
				/>
				<span class="min-w-0 flex-1">
					<span class="block truncate font-semibold {isPlaying(song) ? 'text-primary-400' : ''}"
						>{song.title}</span
					>
					<span class="block truncate text-sm text-secondary-600">{song.artist}</span>
				</span>
				<span class="text-xs text-secondary-600 tabular-nums"
					>{time(Number(song.beatmaps?.[0]?.total_length))}</span
				>
			</button>
			<button
				aria-label={kept ? `Remove ${song.title} from the phone` : `Download ${song.title}`}
				class="size-10 shrink-0 grid place-items-center {kept
					? 'text-primary-400'
					: 'text-secondary-600'}"
				disabled={busy}
				onclick={() => keep(song)}
			>
				<span
					class="{busy
						? 'icon-[svg-spinners--ring-resize]'
						: kept
							? 'icon-[mingcute--check-circle-fill]'
							: 'icon-[mingcute--download-2-line]'} size-5"
				></span>
			</button>
		</li>
	{/each}
</ol>
