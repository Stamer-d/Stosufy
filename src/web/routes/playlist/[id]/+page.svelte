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

	let id = $derived(page.params.id);
	let playlist = $derived(
		$playlists.find((p) => p.id == id) ??
			$savedPlaylists.find((p) => p.id == id) ??
			$otherPlaylists[id] ??
			null
	);
	let songs = $derived($playlistSongsCache[id]?.songs ?? []);
	let keptCount = $derived(songs.filter((song) => isDownloaded($downloaded, song)).length);
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
		const wanted = id;
		loading = true;
		error = '';
		// (the songs of before right away, then osu!'s of now)
		getPlaylistSongs(wanted, !!$playlistSongsCache[wanted])
			.then((result) => {
				if (wanted === id && result.error && !songs.length) error = result.error;
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

<header class="px-5 pt-4 pb-3">
	<a href="{base}/library" class="text-sm text-secondary-600 flex items-center gap-1">
		<span class="icon-[mingcute--left-line] size-4"></span> Library
	</a>
	{#if editing}
		<form
			class="mt-2"
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
				class="w-full bg-transparent text-3xl font-extrabold outline-none border-b border-primary-400"
				aria-label="Name"
			/>
		</form>
	{:else}
		<div class="mt-2 flex items-center gap-2">
			<h1 class="min-w-0 flex-1 text-3xl font-extrabold truncate">
				{playlist?.title ?? (id == '-2' ? 'Liked Songs' : 'Playlist')}
			</h1>
			{#if own}
				<button
					aria-label="Rename"
					class="size-9 shrink-0 grid place-items-center text-secondary-600"
					onclick={() => {
						newTitle = playlist?.title ?? '';
						editing = true;
					}}
				>
					<span class="icon-[mingcute--edit-2-line] size-5"></span>
				</button>
				<button
					aria-label="Delete"
					class="h-9 shrink-0 px-2 flex items-center gap-1 text-sm {confirmDelete
						? 'text-red-400'
						: 'text-secondary-600'}"
					onclick={remove}
					onblur={() => (confirmDelete = false)}
				>
					<span class="icon-[mingcute--delete-2-line] size-5"></span>
					{confirmDelete ? 'Delete?' : ''}
				</button>
			{/if}
		</div>
	{/if}
	<p class="text-sm text-secondary-600">
		{songs.length} songs{songs.length ? ` · ${songsLength(songs)}` : ''}{keptCount
			? ` · ${keptCount} on the phone`
			: ''}
	</p>
	<div class="mt-3 flex flex-wrap gap-2">
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
			onclick={() => play(songs, 0, { shuffled: true })}
		>
			<span class="icon-[mingcute--shuffle-2-line] size-5"></span> Shuffle
		</button>
		{#if $bulk}
			<button
				class="h-10 px-4 rounded-full bg-white/10 text-sm font-semibold flex items-center gap-2"
				onclick={stopDownloadAll}
			>
				<span class="icon-[svg-spinners--ring-resize] size-4"></span>
				{$bulk.done}/{$bulk.total} · Stop
			</button>
		{:else if songs.length && keptCount < songs.length}
			<button
				aria-label="Download all"
				class="h-10 px-4 rounded-full bg-white/10 text-sm font-semibold flex items-center gap-2"
				onclick={keepAll}
			>
				<span class="icon-[mingcute--download-2-line] size-5"></span> All
			</button>
		{/if}
	</div>
	{#if songs.length > 15}
		<label class="mt-3 flex items-center gap-2 h-10 px-3 rounded-xl bg-secondary-300">
			<span class="icon-[mingcute--search-line] size-4 text-secondary-600"></span>
			<input
				bind:value={filter}
				type="search"
				class="flex-1 min-w-0 bg-transparent outline-none text-base"
				placeholder="Find in this playlist"
				aria-label="Find in this playlist"
			/>
		</label>
	{/if}
</header>

{#if error}
	<p class="px-5 text-sm text-red-400">Couldn't load the songs: {error}</p>
{:else if loading && !songs.length}
	<p class="px-5 text-sm text-secondary-600">Loading…</p>
{/if}

<ol class="px-3">
	{#each shown as { song, index } (`${song.id}:${song.track ?? 0}:${index}`)}
		<SongRow {song} playlistId={id} onplay={() => play(songs, index)} />
	{/each}
</ol>
