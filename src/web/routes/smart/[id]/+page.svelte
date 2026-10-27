<script>
	const base = __WEB_BASE__;
	// A smart playlist (made in the desktop app or here): a few songs put in, and the songs
	// autofill found like them. They're kept in the account's settings, so they're the same
	// as on the desktop.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { libraryPool, fetchMaps, colorFromString } from '../../../shims/data';
	import { offline } from '../../../../lib/stores/network';
	import { showToast } from '../../../../lib/stores/toast';
	import {
		smartPlaylists,
		smartSongs,
		isSeed,
		addSeed,
		autofill,
		filling,
		songFromSearch,
		updateSmartPlaylist,
		deleteSmartPlaylist,
		SIZES
	} from '../../../../lib/stores/smartPlaylists';
	import { songKey, songsLength, sameSong } from '../../../../lib/tracks';
	import { play, playing, queue, toggle } from '../../../player';
	import { downloadAll, bulk } from '../../../downloads';
	import SongRow from '../../../SongRow.svelte';
	import PageHeader from '../../../PageHeader.svelte';
	import MixCover from '../../../../lib/components/MixCover.svelte';
	import PlayButton from '../../../../lib/components/PlayButton.svelte';
	import SongCover from '../../../../lib/components/SongCover.svelte';

	let id = $derived(page.params.id);
	let playlist = $derived($smartPlaylists.find((p) => p.id === id) ?? null);
	// (again when the library changes: once it's loaded, a downloaded song plays from the phone)
	let songs = $derived.by(() => {
		void $libraryPool;
		return playlist ? smartSongs(playlist) : [];
	});
	let busy = $derived(!!$filling[id]);
	let playingThis = $derived(
		$playing && songs.some((song) => sameSong(song, $queue.songs[$queue.index]))
	);

	// Adding songs: open for a new one (and for one without songs)
	let adding = $state(false);
	let showAdding = $derived(adding || !playlist?.seeds.length);
	let query = $state('');
	let searchInput = $state();
	$effect(() => {
		void id;
		const edit = page.url.searchParams.has('edit');
		query = '';
		adding = edit;
		if (edit) tick().then(() => searchInput?.focus());
	});

	let libraryResults = $derived.by(() => {
		const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return [];
		const found = [];
		for (const song of $libraryPool) {
			const text =
				`${song.title} ${song.artist} ${song.creator ?? ''} ${song.songSource ?? ''}`.toLowerCase();
			if (words.every((word) => text.includes(word))) found.push(song);
			if (found.length >= 5) break;
		}
		return found;
	});
	let onlineResults = $state([]);
	let searching = $state(false);
	// osu!'s songs a moment after the typing stops
	$effect(() => {
		const words = query.trim();
		onlineResults = [];
		if (!words || $offline) return;
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const result = await fetchMaps(words);
				if (query.trim() !== words) return;
				const yours = new Set(libraryResults.map(songKey));
				onlineResults = (result?.beatmapsets ?? [])
					.map(songFromSearch)
					.filter((song) => !yours.has(songKey(song)))
					.slice(0, 8);
			} catch {
				// (your songs are still there)
			} finally {
				if (query.trim() === words) searching = false;
			}
		}, 400);
		return () => {
			clearTimeout(timer);
			searching = false;
		};
	});

	async function fill() {
		try {
			const added = await autofill(id);
			if (!added)
				showToast(
					playlist?.online && !$offline
						? 'Found no songs like these'
						: 'Found no songs like these in your playlists',
					'icon-[mingcute--magic-2-line]'
				);
			else adding = false;
		} catch (error) {
			console.error('Autofill failed:', error);
			showToast("Couldn't autofill right now", 'icon-[mingcute--warning-line]');
		}
	}

	const update = (change) => updateSmartPlaylist(id, change);

	let renaming = $state(false);
	let confirmDelete = $state(false);
	function remove() {
		if (!confirmDelete) {
			confirmDelete = true;
			setTimeout(() => (confirmDelete = false), 3000);
			return;
		}
		deleteSmartPlaylist(id);
		showToast('Smart playlist deleted', 'icon-[mingcute--delete-2-line]');
		goto(`${base}/library`);
	}
</script>

{#snippet result(song, yours)}
	{@const added = isSeed(playlist, song)}
	<li>
		<button
			class="w-full flex items-center gap-3 p-2 rounded-md text-start active:bg-white/[0.06] {added
				? 'opacity-50'
				: ''}"
			disabled={added}
			onclick={() => addSeed(id, song)}
		>
			<SongCover setId={song.id} track={song.track} title={song.title} class="size-11 rounded" />
			<span class="min-w-0 flex-1">
				<span class="block truncate font-semibold">{song.title}</span>
				<span class="block truncate text-sm text-secondary-600">{song.artist}</span>
			</span>
			{#if !yours}
				<span class="icon-[mingcute--cloud-line] size-4 shrink-0 text-secondary-600"></span>
			{/if}
			<span
				class="{added
					? 'icon-[mingcute--check-line] text-primary-500'
					: 'icon-[mingcute--add-circle-line] text-secondary-600'} size-6 shrink-0"
			></span>
		</button>
	</li>
{/snippet}

{#if playlist}
	<PageHeader
		color={colorFromString(playlist.title)}
		seed={playlist.id.length * 5}
		label="Smart playlist"
		title={playlist.title}
		back="{base}/library"
		onplay={songs.length ? () => play(songs, 0) : undefined}
	>
		{#snippet cover()}
			{#if songs.length}
				<MixCover {songs} class="size-48 rounded-md shadow-2xl shadow-black/50" />
			{:else}
				<div class="size-48 rounded-md bg-white/[0.06] grid place-items-center shadow-2xl">
					<span class="icon-[mingcute--magic-2-line] size-16 text-secondary-600"></span>
				</div>
			{/if}
		{/snippet}
		{#if renaming}
			<form
				class="mt-2 flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					const title = new FormData(e.currentTarget).get('title')?.toString().trim();
					if (title) update({ title });
					renaming = false;
				}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					name="title"
					value={playlist.title}
					autofocus
					maxlength="100"
					class="flex-1 min-w-0 h-10 px-3 rounded-md bg-black/30 outline-none ring-1 ring-white/10 focus:ring-white/30"
					aria-label="Name"
				/>
				<button class="h-10 px-4 rounded-md bg-primary-300 font-semibold">Save</button>
			</form>
		{/if}
		<p class="mt-2 text-sm text-white/70">
			{songs.length} songs{songs.length ? ` · ${songsLength(songs)}` : ''}
		</p>
		{#snippet actions()}
			<PlayButton
				playing={playingThis}
				disabled={!songs.length}
				onclick={() => (playingThis ? toggle() : play(songs, 0))}
			/>
			<button
				aria-label="Shuffle"
				class="size-10 grid place-items-center text-white/60 disabled:opacity-30"
				disabled={!songs.length}
				onclick={() => play(songs, 0, { shuffled: true })}
			>
				<span class="icon-[mingcute--shuffle-line] size-7"></span>
			</button>
			<button
				aria-label="Download all"
				class="size-10 grid place-items-center text-white/60 disabled:opacity-30"
				disabled={!!$bulk || !songs.length}
				onclick={() => downloadAll(songs)}
			>
				<span
					class="{$bulk
						? 'icon-[svg-spinners--ring-resize]'
						: 'icon-[mingcute--download-2-line]'} size-7"
				></span>
			</button>
			<button
				aria-label="Rename"
				class="size-10 grid place-items-center text-white/60"
				onclick={() => (renaming = !renaming)}
			>
				<span class="icon-[mingcute--edit-2-line] size-6"></span>
			</button>
			<button
				aria-label={confirmDelete ? 'Tap again to delete it' : 'Delete'}
				class="ml-auto h-10 px-2 flex items-center gap-1.5 text-sm {confirmDelete
					? 'text-red-400'
					: 'text-white/60'}"
				onclick={remove}
			>
				<span class="icon-[mingcute--delete-2-line] size-6"></span>
				{#if confirmDelete}Tap again{/if}
			</button>
		{/snippet}
	</PageHeader>

	<div class="px-4 pt-4 flex gap-2">
		<button
			class="flex-1 h-11 flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:opacity-40 {playlist
				.seeds.length && !playlist.filled.length
				? 'bg-primary-300'
				: 'bg-white/10'}"
			disabled={!playlist.seeds.length || busy}
			onclick={fill}
		>
			<span
				class="{busy ? 'icon-[svg-spinners--ring-resize]' : 'icon-[mingcute--magic-2-line]'} size-5"
			></span>
			{busy ? 'Looking…' : playlist.filled.length ? 'Autofill again' : 'Autofill'}
		</button>
		<button
			class="flex-1 h-11 flex items-center justify-center gap-2 rounded-full font-semibold transition {showAdding
				? 'bg-white text-black'
				: 'bg-white/10'}"
			aria-expanded={showAdding}
			onclick={() => (adding = !showAdding)}
		>
			<span class="icon-[mingcute--add-line] size-5"></span>
			Add songs
		</button>
	</div>

	{#if showAdding}
		<section
			class="mx-3 mt-3 p-3 rounded-xl bg-white/[0.04] ring-1 ring-white/5 flex flex-col gap-3"
		>
			<p class="px-1 text-sm text-secondary-600">
				Add a few songs you like, then <span class="font-semibold text-white">Autofill</span> finds more
				like them.
			</p>
			<label
				class="flex items-center gap-3 h-11 px-4 rounded-full bg-white/[0.08] ring-1 ring-transparent focus-within:ring-white/20"
			>
				<span class="icon-[mingcute--search-line] size-5 text-secondary-600"></span>
				<input
					bind:this={searchInput}
					bind:value={query}
					type="search"
					enterkeyhint="search"
					class="flex-1 min-w-0 bg-transparent outline-none placeholder:text-secondary-600 [&::-webkit-search-cancel-button]:hidden"
					placeholder="Search your songs and osu!"
					aria-label="Search songs to add"
				/>
				{#if searching}
					<span class="icon-[svg-spinners--ring-resize] size-5 text-secondary-600"></span>
				{/if}
			</label>

			{#if libraryResults.length}
				<div>
					<p class="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-secondary-600">
						Your songs
					</p>
					<ul>
						{#each libraryResults as song (songKey(song))}
							{@render result(song, true)}
						{/each}
					</ul>
				</div>
			{/if}
			{#if onlineResults.length}
				<div>
					<p class="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-secondary-600">
						On osu!
					</p>
					<ul>
						{#each onlineResults as song (songKey(song))}
							{@render result(song, false)}
						{/each}
					</ul>
				</div>
			{/if}
			{#if query.trim() && !searching && !libraryResults.length && !onlineResults.length}
				<p class="px-2 text-sm text-secondary-600">No songs found</p>
			{/if}

			<div class="pt-3 border-t border-white/5 flex flex-col gap-3">
				<div class="px-1 flex items-center justify-between gap-3 text-sm">
					<span>Fill up to</span>
					<div class="flex rounded-full bg-white/[0.06] p-0.5">
						{#each SIZES as size (size)}
							<button
								class="h-8 px-3 rounded-full text-sm font-semibold {playlist.size === size
									? 'bg-white text-black'
									: 'text-secondary-600'}"
								aria-pressed={playlist.size === size}
								onclick={() => update({ size })}
							>
								{size}
							</button>
						{/each}
					</div>
				</div>
				<button
					class="px-1 flex items-center justify-between gap-3 text-start"
					role="switch"
					aria-checked={playlist.online}
					onclick={() => update({ online: !playlist.online })}
				>
					<span class="text-sm">
						Also songs you don't have
						<span class="block text-xs text-secondary-600">From osu!, they stream when played</span>
					</span>
					<span
						class="relative w-11 h-6 shrink-0 rounded-full transition {playlist.online
							? 'bg-primary-400'
							: 'bg-white/20'}"
					>
						<span
							class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {playlist.online
								? 'translate-x-5'
								: ''}"
						></span>
					</span>
				</button>
			</div>
		</section>
	{/if}

	<ol class="px-2 pt-3 pb-4">
		{#each songs as song, i (songKey(song))}
			<SongRow {song} index={i} playlistId="smart:{id}" onplay={() => play(songs, i)}>
				{#snippet extra()}
					{#if isSeed(playlist, song)}
						<span
							class="size-8 grid place-items-center shrink-0 text-primary-500"
							title="You added it: autofill looks for songs like it"
						>
							<span class="icon-[mingcute--pin-fill] size-4"></span>
						</span>
					{/if}
				{/snippet}
			</SongRow>
		{:else}
			<li class="px-8 py-10 flex flex-col items-center text-center gap-2 text-secondary-600">
				<span class="icon-[mingcute--magic-2-line] size-10"></span>
				<p>Search for a few songs you like and add them, then tap Autofill.</p>
			</li>
		{/each}
	</ol>
{:else}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--magic-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">This smart playlist isn't here anymore</p>
		<a href="{base}/library" class="mt-2 text-sm font-semibold">Go to your library</a>
	</div>
{/if}
