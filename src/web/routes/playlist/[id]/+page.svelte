<script>
	const base = __WEB_BASE__;
	// A playlist, as in the desktop app: its header in the cover's color, Play and Shuffle,
	// keeping it on the phone, and its songs (tap one to play the playlist from there)
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
	import { untrack } from 'svelte';
	import { songsLength } from '../../../../lib/tracks';
	import { showToast } from '../../../../lib/stores/toast';
	import { play } from '../../../player';
	import { downloaded, bulk, downloadAll, stopDownloadAll, isDownloaded } from '../../../downloads';
	import SongRow from '../../../SongRow.svelte';
	import Skeleton from '../../../Skeleton.svelte';
	import { nearView } from '../../../visible';
	import PlaylistCover from '../../../../lib/components/PlaylistCover.svelte';
	import PlayButton from '../../../../lib/components/PlayButton.svelte';
	import PageHeader from '../../../PageHeader.svelte';
	import { autoDownload, setAutoDownload } from '../../../downloads';
	import { colorFromString, colorFromImage } from '../../../shims/data';
	import { webUser } from '../../../library';
	import { queue, playing, toggle, shuffle } from '../../../player';
	import { sortable } from '../../../sortable';
	import { searchField } from '../../../searchField';
	import { moveSongInPlaylist, toggleSavedPlaylist } from '../../../../lib/stores/playlist';

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
	// The header's wash, from the cover (as in the desktop app)
	let color = $state(null);
	$effect(() => {
		const which = playlist;
		if (id == '-2') return void (color = 'oklch(0.45 0.17 290)');
		color = colorFromString(title);
		if (which?.image_url)
			colorFromImage(which.image_url).then(
				(found) => found && which === playlist && (color = found)
			);
	});
	/** This playlist plays now */
	let playingThis = $derived(
		$playing &&
			songs.some(
				(song) =>
					song === $queue.songs[$queue.index] ||
					(song.id === $queue.songs[$queue.index]?.id &&
						song.beatmaps?.[0]?.id === $queue.songs[$queue.index]?.beatmaps?.[0]?.id)
			)
	);
	let menuOpen = $state(false);
	let autoOn = $derived($autoDownload.has(String(id)));
	let error = $state('');
	let loading = $state(false);
	/** How many songs (while they load, as many as the library says it has) */
	let count = $derived(songs.length || (loading ? (playlist?.song_amount ?? 0) : 0));
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
		// (the cache only says whether to ask again: read without following it, else each answer,
		// changing the cache, would ask again)
		getPlaylistSongs(
			wanted,
			untrack(() => !!$playlistSongsCache[wanted])
		)
			.then((result) => {
				if (wanted === id && result.error && !songs.length) error = result.error;
				// Kept downloaded: its new songs too
				if (wanted === id && untrack(() => autoOn && keptCount < songs.length)) keepAll();
			})
			.finally(() => wanted === id && (loading = false));
	});

	// Your own playlists: rename and delete
	let own = $derived(Number(id) > 0 && $playlists.some((p) => p.id == id));
	let editing = $state(false);
	/** The songs are moved by their handles (≡) */
	let reordering = $state(false);
	$effect(() => {
		void id;
		reordering = false;
	});
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

<PageHeader
	{color}
	seed={Number(id) || 7}
	label={id == '-2' ? 'Playlist' : playlist?.public ? 'Public playlist' : 'Private playlist'}
	title={editing ? '' : title}
	back="{base}/library"
	onplay={songs.length ? () => play(songs, 0) : undefined}
>
	{#snippet cover()}
		<PlaylistCover
			playlist={playlist ?? /** @type {any} */ ({ id, title })}
			class="size-48 rounded-md shadow-2xl shadow-black/50"
			iconClass="size-16"
		/>
	{/snippet}
	{#if editing}
		<form
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
				class="-mt-8 w-full bg-transparent text-3xl font-extrabold tracking-tight outline-none border-b border-primary-400"
				aria-label="Name"
			/>
		</form>
	{/if}
	{#if playlist?.description}
		<p class="mt-2 text-sm text-white/70 line-clamp-2">{playlist.description}</p>
	{/if}
	<p class="mt-2 text-sm">
		{#if playlist?.creator?.username}
			<span class="font-bold">{playlist.creator.username}</span><span class="text-white/70">
				·
			</span>
		{:else if own && $webUser?.username}
			<span class="font-bold">{$webUser.username}</span><span class="text-white/70"> · </span>
		{/if}
		<span class="text-white/70"
			>{count}
			{count === 1 ? 'song' : 'songs'}{songs.length ? ` · ${songsLength(songs)}` : ''}</span
		>
	</p>
	{#snippet actions()}
		<PlayButton
			playing={playingThis}
			disabled={!songs.length}
			onclick={() => (playingThis ? toggle() : play(songs, 0))}
		/>
		<button
			aria-label="Shuffle"
			class="relative size-11 grid place-items-center {$shuffle
				? 'text-primary-500'
				: 'text-white/60'}"
			disabled={!songs.length}
			onclick={() => play(songs, 0, { shuffled: true })}
		>
			<span class="icon-[mingcute--shuffle-line] size-7"></span>
			{#if $shuffle}<span class="absolute bottom-0 size-1 rounded-full bg-primary-500"></span>{/if}
		</button>
		{#if $bulk}
			<button
				class="h-10 px-2 flex items-center gap-1.5 text-sm font-semibold text-primary-500"
				onclick={stopDownloadAll}
			>
				<span class="text-xs tabular-nums">{$bulk.done}/{$bulk.total}</span>
				<span class="icon-[mingcute--close-circle-line] size-6"></span>
			</button>
		{:else}
			<button
				aria-label={autoOn ? 'Stop keeping it on the phone' : 'Keep it on the phone'}
				aria-pressed={autoOn}
				class="size-11 grid place-items-center {autoOn ||
				(songs.length && keptCount === songs.length)
					? 'text-primary-500'
					: 'text-white/60'}"
				onclick={() => {
					// (what it was before the tap: setting it changes autoOn right away)
					const turnOn = !autoOn;
					setAutoDownload(id, turnOn);
					if (turnOn) keepAll();
				}}
			>
				<span
					class="{autoOn || (songs.length && keptCount === songs.length)
						? 'icon-[mingcute--check-circle-fill]'
						: 'icon-[mingcute--download-2-line]'} size-7"
				></span>
			</button>
		{/if}
		{#if !own && Number(id) > 0 && playlist}
			{@const saved = $savedPlaylists.some((p) => p.id == id)}
			<button
				aria-label={saved ? 'Remove from your library' : 'Save to your library'}
				aria-pressed={saved}
				class="size-11 grid place-items-center {saved ? 'text-primary-500' : 'text-white/60'}"
				onclick={() => toggleSavedPlaylist(playlist)}
			>
				<span
					class="{saved
						? 'icon-[mingcute--bookmark-fill]'
						: 'icon-[mingcute--bookmark-line]'} size-7"
				></span>
			</button>
		{/if}
		{#if own}
			<div class="relative">
				<button
					aria-label="More"
					class="size-11 grid place-items-center text-white/60"
					onclick={() => (menuOpen = !menuOpen)}
				>
					<span class="icon-[mingcute--more-2-fill] size-6"></span>
				</button>
				{#if menuOpen}
					<div
						class="absolute left-0 top-11 z-20 w-48 py-1 rounded-lg bg-secondary-200 shadow-2xl ring-1 ring-white/10"
					>
						<button
							class="w-full flex items-center gap-3 px-3 py-2.5 text-start text-sm active:bg-white/5"
							onclick={() => {
								menuOpen = false;
								newTitle = playlist?.title ?? '';
								editing = true;
							}}
						>
							<span class="icon-[mingcute--edit-2-line] size-5"></span> Rename
						</button>
						{#if songs.length > 1}
							<button
								class="w-full flex items-center gap-3 px-3 py-2.5 text-start text-sm active:bg-white/5"
								onclick={() => {
									menuOpen = false;
									filter = '';
									limit = songs.length;
									reordering = true;
								}}
							>
								<span class="icon-[mingcute--menu-line] size-5"></span> Reorder songs
							</button>
						{/if}
						<button
							class="w-full flex items-center gap-3 px-3 py-2.5 text-start text-sm text-red-400 active:bg-white/5"
							onclick={remove}
						>
							<span class="icon-[mingcute--delete-2-line] size-5"></span>
							{confirmDelete ? 'Tap again to delete' : 'Delete'}
						</button>
					</div>
				{/if}
			</div>
		{/if}
		{#if keptCount}
			<span class="ml-auto text-xs text-secondary-600 tabular-nums">{keptCount} on the phone</span>
		{/if}
	{/snippet}
</PageHeader>

<div class="px-2 pb-4">
	{#if reordering}
		<div
			class="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-10 mx-1 mt-1 mb-2 flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary-200 shadow-lg ring-1 ring-white/10"
		>
			<span class="icon-[mingcute--menu-line] size-5 text-secondary-600"></span>
			<span class="flex-1 text-sm"
				>Drag a song by <span class="font-semibold">≡</span> to move it</span
			>
			<button
				class="h-8 px-4 rounded-full bg-white text-black text-sm font-semibold"
				onclick={() => (reordering = false)}>Done</button
			>
		</div>
	{:else if songs.length > 15}
		<div class="relative mx-2 mt-1 mb-2 flex items-center">
			<span
				class="icon-[mingcute--search-line] absolute left-3 size-4 text-secondary-600 pointer-events-none"
			></span>
			<input
				type="search"
				use:searchField
				bind:value={filter}
				placeholder="Filter"
				aria-label="Filter songs in this playlist"
				class="w-full h-10 pl-9 pr-3 rounded-full bg-white/[0.06] focus:bg-white/10 text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition [&::-webkit-search-cancel-button]:hidden"
			/>
		</div>
	{/if}

	{#if error}
		<p class="px-2 text-sm text-red-400">Couldn't load the songs: {error}</p>
	{:else if loading && !songs.length}
		<Skeleton rows={Math.min(Math.max(playlist?.song_amount ?? 8, 1), 10)} />
	{/if}

	<ol
		use:sortable={{
			onmove: (from, to) => reordering && moveSongInPlaylist(id, from, to)
		}}
	>
		{#each shown.slice(0, limit) as { song, index } (`${song.id}:${song.track ?? 0}:${index}`)}
			<SongRow {song} {index} playlistId={id} onplay={() => play(songs, index)}>
				{#snippet extra()}
					{#if reordering}
						<span
							data-handle
							aria-label="Move {song.title}"
							class="size-11 shrink-0 grid place-items-center text-secondary-600 touch-none"
						>
							<span class="icon-[mingcute--menu-line] size-6"></span>
						</span>
					{/if}
				{/snippet}
			</SongRow>
		{/each}
	</ol>
	{#if shown.length > limit}
		<!-- (made again each time: it calls back once it comes near) -->
		{#key limit}
			<div use:nearView={() => (limit += STEP)} class="h-20"></div>
		{/key}
	{/if}
</div>
