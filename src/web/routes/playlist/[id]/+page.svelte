<script>
	const base = __WEB_BASE__;
	// A playlist's songs: tap one to play the playlist from there, ⋯ for the rest; Download
	// all keeps them all on the phone
	import { page } from '$app/state';
	import {
		playlists,
		savedPlaylists,
		otherPlaylists,
		playlistSongsCache,
		getPlaylistSongs,
		editPlaylist,
		deletePlaylist
	} from '../../../../lib/stores/playlist';
	import { goto } from '$app/navigation';
	import { songsLength } from '../../../../lib/tracks';
	import { showToast } from '../../../../lib/stores/toast';
	import { play } from '../../../player';
	import { downloaded, bulk, downloadAll, stopDownloadAll, isDownloaded } from '../../../downloads';
	import SongRow from '../../../SongRow.svelte';
	import { nearView } from '../../../visible';
	import PlaylistCover from '../../../PlaylistCover.svelte';
	import { coverUrl } from '../../../player';
	import { autoDownload, setAutoDownload } from '../../../downloads';

	// The bar at the top once the header is scrolled away
	let headerGone = $state(false);
	function watchHeader(node) {
		const observer = new IntersectionObserver(([entry]) => (headerGone = !entry.isIntersecting), {
			rootMargin: '-60px 0px 0px 0px'
		});
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	/** Rows shown: more as the list is scrolled */
	const STEP = 100;
	let limit = $state(STEP);

	let id = $derived(page.params.id);
	let playlist = $derived(
		$playlists.find((p) => p.id == id) ??
			$savedPlaylists.find((p) => p.id == id) ??
			$otherPlaylists[id] ??
			null
	);
	let songs = $derived($playlistSongsCache[id]?.songs ?? []);
	let keptCount = $derived(songs.filter((song) => isDownloaded($downloaded, song)).length);
	let title = $derived(playlist?.title ?? (id == '-2' ? 'Liked Songs' : 'Playlist'));
	/** The picture behind the header: the playlist's, else its first song's cover */
	let backdrop = $derived(playlist?.image_url ?? (songs[0] ? coverUrl(songs[0]) : null));
	let autoOn = $derived($autoDownload.has(String(id)));
	let error = $state('');
	let loading = $state(false);
	let filter = $state('');
	let shown = $derived.by(() => {
		const words = filter.trim().toLowerCase();
		if (!words) return songs.map((song, index) => ({ song, index }));
		return songs
			.map((song, index) => ({ song, index }))
			.filter(({ song }) => `${song.title} ${song.artist}`.toLowerCase().includes(words));
	});

	$effect(() => {
		void id;
		void filter;
		limit = STEP;
	});

	$effect(() => {
		const wanted = id;
		loading = true;
		error = '';
		// (the songs of before right away, then osu!'s of now)
		getPlaylistSongs(wanted, !!$playlistSongsCache[wanted])
			.then((result) => {
				if (wanted === id && result.error && !songs.length) error = result.error;
				// Kept downloaded: its new songs too
				if (wanted === id && autoOn && keptCount < songs.length) keepAll();
			})
			.finally(() => wanted === id && (loading = false));
	});

	// Your own playlists: rename and delete
	let own = $derived(Number(id) > 0 && $playlists.some((p) => p.id == id));
	let editing = $state(false);
	let newTitle = $state('');
	let confirmDelete = $state(false);

	async function rename() {
		const title = newTitle.trim();
		editing = false;
		if (!title || !playlist || title === playlist.title) return;
		const before = playlist.title;
		playlists.update((list) => list.map((p) => (p.id == id ? { ...p, title } : p)));
		try {
			await editPlaylist(id, title, playlist.description ?? '', !!playlist.public);
		} catch (e) {
			playlists.update((list) => list.map((p) => (p.id == id ? { ...p, title: before } : p)));
			showToast(
				`Couldn't rename it: ${e instanceof Error ? e.message : e}`,
				'icon-[mingcute--warning-line]'
			);
		}
	}

	async function remove() {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		const title = playlist?.title;
		try {
			await deletePlaylist(id);
			playlists.update((list) => list.filter((p) => p.id != id));
			showToast(`Deleted "${title}"`, 'icon-[mingcute--delete-2-line]');
			goto(`${base}/library`, { replaceState: true });
		} catch (e) {
			confirmDelete = false;
			showToast(
				`Couldn't delete it: ${e instanceof Error ? e.message : e}`,
				'icon-[mingcute--warning-line]'
			);
		}
	}

	async function keepAll() {
		const result = await downloadAll(songs);
		if (!result) return;
		showToast(
			result.failed
				? `Downloaded ${result.done - result.failed}, ${result.failed} didn't work`
				: `Downloaded ${result.done} songs`,
			result.failed ? 'icon-[mingcute--warning-line]' : 'icon-[mingcute--download-2-line]'
		);
	}
</script>

<!-- The bar at the top, once the header is scrolled away -->
<div
	class="fixed inset-x-0 top-0 z-10 pt-[env(safe-area-inset-top)] bg-panel/95 backdrop-blur border-b border-white/5 transition-opacity duration-200 {headerGone
		? 'opacity-100'
		: 'opacity-0 pointer-events-none'}"
>
	<div class="h-12 px-2 flex items-center gap-2">
		<a href="{base}/library" aria-label="Back" class="size-10 grid place-items-center">
			<span class="icon-[mingcute--left-line] size-6"></span>
		</a>
		<p class="min-w-0 flex-1 font-bold truncate">{title}</p>
		<button
			aria-label="Play"
			class="size-9 grid place-items-center rounded-full bg-primary-300 disabled:opacity-40"
			disabled={!songs.length}
			onclick={() => play(songs, 0)}
		>
			<span class="icon-[mingcute--play-fill] size-5"></span>
		</button>
	</div>
</div>

<header class="relative overflow-hidden" use:watchHeader>
	{#if backdrop}
		<img
			src={backdrop}
			alt=""
			class="absolute inset-0 size-full object-cover opacity-40 blur-2xl scale-125 pointer-events-none"
		/>
	{/if}
	<div
		class="absolute inset-0 bg-gradient-to-b from-transparent via-app/40 to-app pointer-events-none"
	></div>
	<div class="relative px-5 pt-3 pb-3">
		<a href="{base}/library" aria-label="Back" class="-ml-2 size-10 grid place-items-center">
			<span class="icon-[mingcute--left-line] size-6"></span>
		</a>
		<div class="mt-1 flex justify-center">
			<PlaylistCover {playlist} {id} class="size-44 rounded-lg shadow-2xl" icon="size-14" />
		</div>
		{#if editing}
			<form
				class="mt-4"
				onsubmit={(e) => {
					e.preventDefault();
					rename();
				}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					bind:value={newTitle}
					autofocus
					maxlength="100"
					onblur={rename}
					class="w-full bg-transparent text-2xl font-extrabold outline-none border-b border-primary-400"
					aria-label="Name"
				/>
			</form>
		{:else}
			<h1 class="mt-4 text-2xl font-extrabold leading-tight line-clamp-2">{title}</h1>
		{/if}
		<p class="mt-1 text-sm text-white/60">
			{#if playlist?.creator?.username}{playlist.creator.username} ·
			{/if}{songs.length} songs{songs.length ? ` · ${songsLength(songs)}` : ''}
		</p>

		<div class="mt-3 flex items-center gap-1">
			{#if $bulk}
				<button
					class="h-10 px-3 -ml-2 rounded-full text-sm font-semibold flex items-center gap-2"
					onclick={stopDownloadAll}
				>
					<span class="icon-[svg-spinners--ring-resize] size-5"></span>
					{$bulk.done}/{$bulk.total} · Stop
				</button>
			{:else}
				<button
					aria-label={autoOn ? 'Stop keeping it downloaded' : 'Keep it downloaded'}
					aria-pressed={autoOn}
					class="h-10 -ml-2 px-2 flex items-center gap-1.5 text-sm {autoOn ||
					(songs.length && keptCount === songs.length)
						? 'text-primary-400'
						: 'text-white/70'}"
					onclick={() => {
						setAutoDownload(id, !autoOn);
						if (!autoOn) keepAll();
					}}
				>
					<span
						class="{autoOn || (songs.length && keptCount === songs.length)
							? 'icon-[mingcute--arrow-down-circle-fill]'
							: 'icon-[mingcute--arrow-down-circle-line]'} size-7"
					></span>
					{#if keptCount}{keptCount}/{songs.length}{/if}
				</button>
			{/if}
			{#if own}
				<button
					aria-label="Rename"
					class="size-10 grid place-items-center text-white/70"
					onclick={() => {
						newTitle = playlist?.title ?? '';
						editing = true;
					}}
				>
					<span class="icon-[mingcute--edit-2-line] size-6"></span>
				</button>
				<button
					aria-label="Delete"
					class="h-10 px-2 flex items-center gap-1 text-sm {confirmDelete
						? 'text-red-400'
						: 'text-white/70'}"
					onclick={remove}
					onblur={() => (confirmDelete = false)}
				>
					<span class="icon-[mingcute--delete-2-line] size-6"></span>
					{confirmDelete ? 'Delete?' : ''}
				</button>
			{/if}
			<button
				aria-label="Shuffle"
				class="ml-auto size-11 grid place-items-center text-white/80 disabled:opacity-40"
				disabled={!songs.length}
				onclick={() => play(songs, 0, { shuffled: true })}
			>
				<span class="icon-[mingcute--shuffle-2-line] size-7"></span>
			</button>
			<button
				aria-label="Play"
				class="size-14 grid place-items-center rounded-full bg-primary-300 shadow-lg disabled:opacity-40"
				disabled={!songs.length}
				onclick={() => play(songs, 0)}
			>
				<span class="icon-[mingcute--play-fill] size-7"></span>
			</button>
		</div>
		{#if songs.length > 15}
			<label class="mt-3 flex items-center gap-2 h-10 px-3 rounded-xl bg-white/10">
				<span class="icon-[mingcute--search-line] size-4 text-white/60"></span>
				<input
					bind:value={filter}
					type="search"
					class="flex-1 min-w-0 bg-transparent outline-none text-base"
					placeholder="Find in this playlist"
					aria-label="Find in this playlist"
				/>
			</label>
		{/if}
	</div>
</header>

{#if error}
	<p class="px-5 text-sm text-red-400">Couldn't load the songs: {error}</p>
{:else if loading && !songs.length}
	<p class="px-5 text-sm text-secondary-600">Loading…</p>
{/if}

<ol class="px-3">
	{#each shown.slice(0, limit) as { song, index } (`${song.id}:${song.track ?? 0}:${index}`)}
		<SongRow {song} playlistId={id} onplay={() => play(songs, index)} />
	{/each}
</ol>
{#if shown.length > limit}
	<!-- (made again each time: it calls back once it comes near) -->
	{#key limit}
		<div use:nearView={() => (limit += STEP)} class="h-20"></div>
	{/key}
{/if}
