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
	import { moveSongInPlaylist, toggleSavedPlaylist } from '../../../../lib/stores/playlist';
	import { sortOptions, sortSongs } from '../../../../lib/songSort';
	import { addAllToQueue } from '../../../player';
	import { fade, fly } from 'svelte/transition';
	import { swipe } from '../../../gestures';
	import { haptic } from '../../../haptics';

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
	$effect(() => {
		if (!menuOpen) confirmDelete = false;
	});
	let autoOn = $derived($autoDownload.has(String(id)));
	let error = $state('');
	let loading = $state(false);
	/** How many songs (while they load, as many as the library says it has) */
	let count = $derived(songs.length || (loading ? (playlist?.song_amount ?? 0) : 0));
	let filter = $state('');
	// The order the songs are shown and played in: the playlist's own, or by when they were
	// added, their title, artist, tempo or length (kept for each playlist on this phone)
	const SORT_KEY = 'stosufy-web-playlist-sort';
	const SORTS = sortOptions(false).filter((option) => option.value !== 'stars');
	function keptSorts() {
		try {
			return JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}');
		} catch {
			return {};
		}
	}
	let sorts = $state(keptSorts());
	let sort = $derived(sorts[id] ?? 'custom');
	let choosingSort = $state(false);
	function setSort(value) {
		choosingSort = false;
		const next = { ...sorts, [id]: value };
		if (value === 'custom') delete next[id];
		sorts = next;
		try {
			localStorage.setItem(SORT_KEY, JSON.stringify(next));
		} catch {
			// (only for now)
		}
	}
	let listed = $derived(sort === 'custom' ? songs : sortSongs(songs, sort));
	let shown = $derived.by(() => {
		const words = filter.trim().toLowerCase();
		if (!words) return listed.map((song, index) => ({ song, index }));
		return listed
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

	// Its details: the description, who sees it, and its cover (your own playlists)
	let details = $state(null);
	let saving = $state(false);
	function openDetails() {
		menuOpen = false;
		details = {
			title: playlist?.title ?? '',
			description: playlist?.description ?? '',
			isPublic: !!playlist?.public,
			file: null,
			preview: null,
			error: ''
		};
	}
	function pickCover(event) {
		const file = event.currentTarget.files?.[0];
		if (!file || !details) return;
		if (file.size > 8 * 1024 * 1024) {
			details.error = 'That picture is too big (8 MB at most)';
			return;
		}
		if (details.preview) URL.revokeObjectURL(details.preview);
		details.file = file;
		details.preview = URL.createObjectURL(file);
		details.error = '';
	}
	function closeDetails() {
		if (details?.preview) URL.revokeObjectURL(details.preview);
		details = null;
	}
	async function saveDetails() {
		const title = details.title.trim();
		if (!title || saving) return;
		saving = true;
		try {
			const updated = await editPlaylist(
				id,
				title,
				details.description.trim(),
				details.isPublic,
				details.file
			);
			playlists.update((list) =>
				list.map((p) => (p.id == id ? { ...updated, song_amount: p.song_amount } : p))
			);
			closeDetails();
			showToast('Saved', 'icon-[mingcute--check-line]');
		} catch (e) {
			details.error = `Couldn't save: ${e instanceof Error ? e.message : e}`;
		} finally {
			saving = false;
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
	onplay={songs.length ? () => (playingThis ? toggle() : play(listed, 0)) : undefined}
	playing={playingThis}
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
			<a href="{base}/profile/{playlist.creator.osuId}" class="py-2 font-bold"
				>{playlist.creator.username}</a
			><span class="text-white/70"> · </span>
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
			onclick={() => (playingThis ? toggle() : play(listed, 0))}
		/>
		<button
			aria-label="Shuffle"
			class="relative size-10 grid place-items-center {$shuffle
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
				class="size-10 grid place-items-center {autoOn ||
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
				class="size-10 grid place-items-center {saved ? 'text-primary-500' : 'text-white/60'}"
				onclick={() => toggleSavedPlaylist(playlist)}
			>
				<span
					class="{saved
						? 'icon-[mingcute--bookmark-fill]'
						: 'icon-[mingcute--bookmark-line]'} size-7"
				></span>
			</button>
		{/if}
		{#if own || songs.length}
			<div class="relative">
				<button
					aria-label="More"
					class="size-10 grid place-items-center text-white/60"
					onclick={() => (menuOpen = !menuOpen)}
				>
					<span class="icon-[mingcute--more-2-fill] size-6"></span>
				</button>
				{#if menuOpen}
					<!-- (a sheet from the bottom, as the song's menu: a list under the button ran off the screen) -->
					<div class="fixed inset-0 z-40 flex flex-col justify-end">
						<button
							class="absolute inset-0 bg-black/60"
							aria-label="Close"
							onclick={() => (menuOpen = false)}
							transition:fade={{ duration: 150 }}
						></button>
						<div
							class="relative rounded-t-2xl bg-panel pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
							transition:fly={{ y: 400, duration: 220, opacity: 1 }}
							use:swipe={{ axis: 'y', only: 1, onswipe: () => (menuOpen = false) }}
						>
							<div class="pt-2 flex justify-center">
								<span class="w-10 h-1 rounded-full bg-white/20"></span>
							</div>
							<p class="px-5 pt-3 pb-2 text-lg font-bold truncate">{title}</p>
							{#if songs.length}
								<button
									class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5"
									onclick={() => {
										menuOpen = false;
										addAllToQueue(listed);
										showToast(
											`${listed.length} ${listed.length === 1 ? 'song' : 'songs'} added to the queue`,
											'icon-[mingcute--list-check-line]'
										);
									}}
								>
									<span class="icon-[mingcute--playlist-line] size-5"></span> Add to queue
								</button>
							{/if}
							{#if own}
								<button
									class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5"
									onclick={() => {
										menuOpen = false;
										newTitle = playlist?.title ?? '';
										editing = true;
									}}
								>
									<span class="icon-[mingcute--edit-2-line] size-5"></span> Rename
								</button>
								<button
									class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5"
									onclick={openDetails}
								>
									<span class="icon-[mingcute--pic-line] size-5"></span> Edit details
								</button>
								{#if songs.length > 1}
									<button
										class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5"
										onclick={() => {
											menuOpen = false;
											filter = '';
											setSort('custom');
											limit = songs.length;
											reordering = true;
										}}
									>
										<span class="icon-[mingcute--menu-line] size-5"></span> Reorder songs
									</button>
								{/if}
								<button
									class="w-full flex items-center gap-4 px-5 py-3.5 text-start text-red-400 active:bg-white/5"
									onclick={remove}
								>
									<span class="icon-[mingcute--delete-2-line] size-5"></span>
									{confirmDelete ? 'Tap again to delete' : 'Delete'}
								</button>
							{/if}
						</div>
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
	{:else if songs.length > 5}
		<div class="mx-2 mt-1 mb-2 flex items-center gap-2">
			{#if songs.length > 15}
				<div class="relative min-w-0 flex-1 flex items-center">
					<span
						class="icon-[mingcute--search-line] absolute left-3 size-4 text-secondary-600 pointer-events-none"
					></span>
					<input
						type="search"
						bind:value={filter}
						placeholder="Filter"
						aria-label="Filter songs in this playlist"
						class="w-full h-10 pl-9 pr-3 rounded-full bg-white/[0.06] focus:bg-white/10 text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition [&::-webkit-search-cancel-button]:hidden"
					/>
				</div>
			{/if}
			<button
				aria-label="Sort"
				class="shrink-0 h-10 px-3 flex items-center gap-1.5 rounded-full text-sm font-semibold {sort ===
				'custom'
					? 'bg-white/[0.06] text-white/80'
					: 'bg-primary-300 text-white'} {songs.length > 15 ? '' : 'ml-auto'}"
				onclick={() => (choosingSort = true)}
			>
				<span class="icon-[mingcute--sort-descending-line] size-4"></span>
				{SORTS.find((option) => option.value === sort)?.label}
			</button>
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
			<SongRow {song} {index} playlistId={id} onplay={() => play(listed, index)}>
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

{#if choosingSort}
	<div class="fixed inset-0 z-40 flex flex-col justify-end">
		<button
			class="absolute inset-0 bg-black/60"
			aria-label="Close"
			onclick={() => (choosingSort = false)}
			transition:fade={{ duration: 150 }}
		></button>
		<div
			class="relative rounded-t-2xl bg-panel pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
			transition:fly={{ y: 400, duration: 220, opacity: 1 }}
			use:swipe={{ axis: 'y', only: 1, onswipe: () => (choosingSort = false) }}
		>
			<div class="pt-2 flex justify-center">
				<span class="w-10 h-1 rounded-full bg-white/20"></span>
			</div>
			<p class="px-5 pt-3 pb-2 text-lg font-bold">Sort by</p>
			<ul class="pb-2">
				{#each SORTS as option (option.value)}
					<li>
						<button
							class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5 {sort ===
							option.value
								? 'text-primary-400 font-semibold'
								: ''}"
							onclick={() => {
								haptic();
								setSort(option.value);
							}}
						>
							<span class="flex-1">{option.label}</span>
							{#if sort === option.value}<span class="icon-[mingcute--check-line] size-5"
								></span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}

{#if details}
	<div class="fixed inset-0 z-40 flex flex-col justify-end">
		<button
			class="absolute inset-0 bg-black/60"
			aria-label="Close"
			onclick={closeDetails}
			transition:fade={{ duration: 150 }}
		></button>
		<form
			class="relative max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-panel px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
			transition:fly={{ y: 500, duration: 220, opacity: 1 }}
			onsubmit={(e) => {
				e.preventDefault();
				saveDetails();
			}}
		>
			<div class="pt-2 flex justify-center">
				<span class="w-10 h-1 rounded-full bg-white/20"></span>
			</div>
			<p class="pt-3 pb-3 text-lg font-bold">Edit details</p>
			<div class="flex items-center gap-4">
				<label class="relative shrink-0 size-24 rounded-md overflow-hidden bg-white/[0.06]">
					{#if details.preview}
						<img src={details.preview} alt="" class="size-full object-cover" />
					{:else}
						<PlaylistCover
							playlist={playlist ?? /** @type {any} */ ({ id, title })}
							class="size-full"
							iconClass="size-8"
						/>
					{/if}
					<span
						class="absolute inset-x-0 bottom-0 py-1 bg-black/60 text-center text-xs font-semibold"
						>Change</span
					>
					<input
						type="file"
						accept="image/png,image/jpeg,image/webp"
						class="sr-only"
						aria-label="Cover"
						onchange={pickCover}
					/>
				</label>
				<label class="min-w-0 flex-1">
					<span class="block text-xs font-semibold text-secondary-600">Name</span>
					<input
						bind:value={details.title}
						maxlength="100"
						required
						class="mt-1 w-full h-11 px-3 rounded-lg bg-white/[0.08] outline-none ring-1 ring-transparent focus:ring-white/20"
					/>
				</label>
			</div>
			<label class="mt-4 block">
				<span class="block text-xs font-semibold text-secondary-600">Description</span>
				<textarea
					bind:value={details.description}
					maxlength="300"
					rows="3"
					placeholder="What's this playlist about?"
					class="mt-1 w-full p-3 rounded-lg bg-white/[0.08] outline-none ring-1 ring-transparent focus:ring-white/20 resize-none placeholder:text-secondary-600"
				></textarea>
			</label>
			<button
				type="button"
				role="switch"
				aria-checked={details.isPublic}
				class="mt-3 w-full py-2 flex items-center justify-between gap-4 text-start"
				onclick={() => (details.isPublic = !details.isPublic)}
			>
				<span>
					<span class="block font-semibold">Public</span>
					<span class="block text-sm text-secondary-600">
						Everyone finds it in the community playlists and on your profile
					</span>
				</span>
				<span
					class="relative w-11 h-6 shrink-0 rounded-full transition {details.isPublic
						? 'bg-primary-400'
						: 'bg-white/20'}"
				>
					<span
						class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {details.isPublic
							? 'translate-x-5'
							: ''}"
					></span>
				</span>
			</button>
			{#if details.error}
				<p class="mt-2 text-sm text-red-400">{details.error}</p>
			{/if}
			<div class="mt-4 flex gap-3">
				<button
					type="button"
					class="flex-1 h-12 rounded-full bg-white/10 font-semibold"
					onclick={closeDetails}>Cancel</button
				>
				<button
					type="submit"
					class="flex-1 h-12 rounded-full bg-primary-300 font-semibold disabled:opacity-50"
					disabled={saving || !details.title.trim()}
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</div>
		</form>
	</div>
{/if}
