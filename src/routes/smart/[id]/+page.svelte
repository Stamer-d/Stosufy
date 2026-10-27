<script>
	// A smart playlist: a few songs the user put in, and the songs autofill found like them
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { fetchMaps, formatSongData, mapDataStore } from '#lib/stores/data.ts';
	import { matchesQuery } from '#lib/stores/search.ts';
	import { offline } from '#lib/stores/network.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import {
		smartPlaylists,
		smartSongs,
		isSeed,
		addSeed,
		removeSong,
		autofill,
		filling,
		songFromSearch,
		updateSmartPlaylist,
		deleteSmartPlaylist,
		SIZES
	} from '#lib/stores/smartPlaylists.ts';
	import { songKey } from '#lib/tracks.ts';
	import MixView from '#lib/components/MixView.svelte';
	import Select from '#lib/components/Select.svelte';
	import SongCover from '#lib/components/SongCover.svelte';

	let id = $derived(page.params.id);
	let playlist = $derived($smartPlaylists.find((p) => p.id === id) ?? null);
	// (again when the library changes, e.g. once it's loaded or a song was downloaded)
	let songs = $derived.by(() => {
		void $mapDataStore;
		return playlist ? smartSongs(playlist) : [];
	});
	let busy = $derived(!!$filling[id]);

	// Adding songs: open for a new one (and for one without songs)
	let adding = $state(false);
	let showAdding = $derived(adding || !playlist?.seeds.length);
	let query = $state('');
	let searchInput = $state();
	// (again for each smart playlist opened)
	$effect(() => {
		void id;
		const edit = page.url.searchParams.has('edit');
		query = '';
		adding = edit;
		if (edit) tick().then(() => searchInput?.focus());
	});

	let libraryResults = $derived.by(() => {
		const words = query.trim();
		if (!words) return [];
		return formatSongData($mapDataStore)
			.filter((song) => matchesQuery(song, words))
			.slice(0, 5);
	});
	let onlineResults = $state([]);
	let searching = $state(false);
	// osu!'s songs a moment after the typing stops (the downloaded ones are above already)
	$effect(() => {
		const words = query.trim();
		onlineResults = [];
		if (!words || $offline) return;
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const result = await fetchMaps(words);
				if (query.trim() !== words) return;
				onlineResults = (result?.beatmapsets ?? [])
					.filter((set) => !$mapDataStore[set.id])
					.slice(0, 8)
					.map(songFromSearch);
			} catch {
				// (the library's songs are still there)
			} finally {
				if (query.trim() === words) searching = false;
			}
		}, 400);
		return () => {
			clearTimeout(timer);
			searching = false;
		};
	});

	function add(song) {
		addSeed(id, song);
	}

	async function fill() {
		try {
			const added = await autofill(id);
			if (!added)
				showToast(
					playlist?.online && !$offline
						? 'Found no songs like these'
						: 'Found no songs like these in your library',
					'icon-[mingcute--magic-2-line]'
				);
			else adding = false;
		} catch (error) {
			console.error('Autofill failed:', error);
			showToast("Couldn't autofill right now", 'icon-[mingcute--warning-line]');
		}
	}

	const update = (change) => updateSmartPlaylist(id, change);
	const SIZE_OPTIONS = SIZES.map((size) => ({ value: String(size), label: `${size} songs` }));

	let confirmDelete = $state(false);
	function remove() {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		deleteSmartPlaylist(id);
		goto('/home');
	}
</script>

{#snippet result(song, downloaded)}
	{@const added = isSeed(playlist, song)}
	<li>
		<button
			class="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-start transition {added
				? 'opacity-50 cursor-default'
				: 'hover:bg-white/5 cursor-pointer'}"
			disabled={added}
			onclick={() => add(song)}
			title={added ? 'Added' : `Add ${song.title}`}
		>
			<SongCover setId={song.id} track={song.track} title={song.title} class="size-10 rounded" />
			<span class="min-w-0 flex-1">
				<span class="block truncate font-semibold">{song.title}</span>
				<span class="block truncate text-sm text-secondary-600">{song.artist}</span>
			</span>
			{#if !downloaded}
				<span
					class="icon-[mingcute--cloud-line] size-4 shrink-0 text-secondary-600"
					title="Not downloaded: it streams from osu!"
				></span>
			{/if}
			<span
				class="{added
					? 'icon-[mingcute--check-line] text-primary-500'
					: 'icon-[mingcute--add-line] text-secondary-600'} size-5 shrink-0"
			></span>
		</button>
	</li>
{/snippet}

{#if playlist}
	<MixView {songs} queueId="smart:{id}" label="Smart playlist" title={playlist.title}>
		{#snippet heading()}
			<input
				class="w-full bg-transparent text-5xl font-extrabold tracking-tight outline-none rounded focus-visible:ring-2 focus-visible:ring-primary-300"
				aria-label="Name"
				value={playlist.title}
				onchange={(e) => update({ title: e.currentTarget.value.trim() || 'Smart playlist' })}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			/>
		{/snippet}
		{#snippet actions()}
			<button
				class="flex items-center gap-2 px-4 h-9 rounded-full text-sm font-semibold cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none {playlist
					.seeds.length && !playlist.filled.length
					? 'bg-primary-300 text-white hover:bg-primary-400'
					: 'bg-white/10 hover:bg-white/20'}"
				disabled={!playlist.seeds.length || busy}
				title={playlist.seeds.length
					? `Adds songs like yours, up to ${playlist.size}`
					: 'Add a few songs first'}
				onclick={fill}
			>
				<span
					class="{busy
						? 'icon-[svg-spinners--ring-resize]'
						: 'icon-[mingcute--magic-2-line]'} size-4"
				></span>
				{busy ? 'Looking for songs…' : playlist.filled.length ? 'Autofill again' : 'Autofill'}
			</button>
			<button
				class="flex items-center gap-2 px-4 h-9 rounded-full text-sm font-semibold cursor-pointer transition {showAdding
					? 'bg-white text-black hover:bg-white/90'
					: 'bg-white/10 hover:bg-white/20'}"
				aria-expanded={showAdding}
				onclick={() => (adding = !showAdding)}
			>
				<span class="icon-[mingcute--add-line] size-4"></span>
				Add songs
			</button>
			<button
				class="ml-auto text-sm underline underline-offset-2 cursor-pointer transition {confirmDelete
					? 'text-red-400 hover:text-red-300'
					: 'text-secondary-600 hover:text-white'}"
				onclick={remove}
				onblur={() => (confirmDelete = false)}
			>
				{confirmDelete ? 'Click again to delete it' : 'Delete'}
			</button>
		{/snippet}

		{#if showAdding}
			<section
				class="mx-8 mb-6 p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5 flex flex-col gap-3"
			>
				<p class="text-sm text-secondary-600">
					Add a few songs you like, then <span class="font-semibold text-white">Autofill</span> finds
					more like them.
				</p>
				<label
					class="flex items-center gap-2 h-10 px-3 rounded-lg bg-secondary-300 focus-within:ring-2 focus-within:ring-primary-300"
				>
					<span class="icon-[mingcute--search-line] size-4 text-secondary-600"></span>
					<input
						bind:this={searchInput}
						bind:value={query}
						class="flex-1 min-w-0 bg-transparent text-sm text-white outline-none"
						placeholder="Search your songs and osu!"
						aria-label="Search songs to add"
						onkeydown={(e) => e.key === 'Escape' && (query = '')}
					/>
					{#if searching}
						<span class="icon-[svg-spinners--ring-resize] size-4 text-secondary-600"></span>
					{/if}
				</label>

				{#if libraryResults.length || onlineResults.length}
					<div class="flex flex-col gap-2 max-h-96 overflow-y-auto">
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
					</div>
				{:else if query.trim() && !searching}
					<p class="px-2 text-sm text-secondary-600">No songs found</p>
				{/if}

				<div class="flex flex-wrap items-center gap-x-6 gap-y-3 pt-3 border-t border-white/5">
					<div class="flex items-center gap-2 text-sm text-secondary-600">
						Fill up to
						<Select
							label="Size"
							hideLabel
							options={SIZE_OPTIONS}
							value={String(playlist.size)}
							onchange={(size) => update({ size: Number(size) })}
						/>
					</div>
					<div class="flex items-center gap-3 text-sm">
						<button
							role="switch"
							aria-checked={playlist.online}
							aria-label="Also songs you don't have"
							class="relative w-11 h-6 shrink-0 rounded-full cursor-pointer transition {playlist.online
								? 'bg-primary-500'
								: 'bg-secondary-300'}"
							onclick={() => update({ online: !playlist.online })}
						>
							<span
								class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {playlist.online
									? 'translate-x-5'
									: ''}"
							></span>
						</button>
						<span>
							Also songs you don't have
							<span class="block text-xs text-secondary-600"
								>From osu!, they stream when played</span
							>
						</span>
					</div>
				</div>
			</section>
		{/if}

		{#snippet row(song)}
			{#if isSeed(playlist, song)}
				<span
					class="size-9 grid place-items-center shrink-0 text-primary-500"
					title="You added it: autofill looks for songs like it"
				>
					<span class="icon-[mingcute--pin-fill] size-4"></span>
				</span>
			{:else}
				<button
					title="More like this: autofill looks for songs like it too"
					aria-label="Keep {song.title} and find more like it"
					class="size-9 grid place-items-center shrink-0 rounded-full text-secondary-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-white/10 cursor-pointer transition"
					onclick={() => add(song)}
				>
					<span class="icon-[mingcute--pin-line] size-4"></span>
				</button>
			{/if}
			<button
				title="Remove"
				aria-label="Remove {song.title}"
				class="size-9 mr-1 grid place-items-center shrink-0 rounded-full text-secondary-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-white/10 cursor-pointer transition"
				onclick={() => removeSong(id, song)}
			>
				<span class="icon-[mingcute--close-line] size-4"></span>
			</button>
		{/snippet}

		{#snippet empty()}
			<div class="px-8 py-10 flex flex-col items-center text-center gap-2 text-secondary-600">
				<span class="icon-[mingcute--magic-2-line] size-10"></span>
				<p>Search for a few songs you like and add them, then hit Autofill.</p>
			</div>
		{/snippet}
	</MixView>
{:else}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--magic-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">This smart playlist isn't here anymore</p>
		<a href="/home" class="mt-2 text-sm font-semibold hover:underline">Go home</a>
	</div>
{/if}
