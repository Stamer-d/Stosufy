<script>
	// Search: your playlists' songs first, then osu!'s (they stream); the searches of before
	// while nothing is typed
	import { freshToken } from '../../shims/auth';
	import { osuApi } from '../../shims/http';
	import { play, slim } from '../../player';
	import SongRow from '../../SongRow.svelte';
	import { libraryPool } from '../../shims/data';

	const RECENT_KEY = 'stosufy-web-recent-searches';
	let recent = $state(readRecent());
	function readRecent() {
		try {
			return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		} catch {
			return [];
		}
	}
	function keepRecent(list) {
		recent = list;
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(list));
		} catch {
			// (only for now)
		}
	}
	/** A search that found what was wanted (a song of it was played) */
	function remember() {
		const words = query.trim();
		if (!words) return;
		keepRecent(
			[words, ...recent.filter((w) => w.toLowerCase() !== words.toLowerCase())].slice(0, 8)
		);
	}

	/** Your songs with all the words in their title, artist, mapper or source */
	let yours = $derived.by(() => {
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

	const KEY = 'stosufy-web-search';
	let query = $state(sessionStorage.getItem(KEY) ?? '');
	let results = $state([]);
	let searching = $state(false);
	let error = $state('');
	let cursor = $state('');

	/** A beatmap set of osu!'s search as a song (its osu! standard difficulty first) */
	function songOf(set) {
		const maps = [...(set.beatmaps ?? [])].sort(
			(a, b) => Number(b.mode === 'osu') - Number(a.mode === 'osu')
		);
		return slim({
			id: set.id,
			title: set.title,
			artist: set.artist,
			creator: set.creator,
			beatmaps: maps
		});
	}

	async function search(words, after = '') {
		const params = new URLSearchParams({ q: words });
		if (after) params.set('cursor_string', after);
		const response = await osuApi(`beatmapsets/search?${params}`, await freshToken());
		if (!response.ok) throw new Error(`osu! answered ${response.status}`);
		const data = await response.json();
		return { songs: (data.beatmapsets ?? []).map(songOf), cursor: data.cursor_string ?? '' };
	}

	// A moment after the typing stops
	$effect(() => {
		const words = query.trim();
		try {
			sessionStorage.setItem(KEY, query);
		} catch {
			// (private browsing)
		}
		error = '';
		if (!words) {
			results = [];
			cursor = '';
			return;
		}
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const found = await search(words);
				if (query.trim() !== words) return;
				results = found.songs;
				cursor = found.cursor;
			} catch (e) {
				if (query.trim() === words) error = e instanceof Error ? e.message : String(e);
			} finally {
				if (query.trim() === words) searching = false;
			}
		}, 400);
		return () => clearTimeout(timer);
	});

	async function more() {
		const words = query.trim();
		searching = true;
		try {
			const found = await search(words, cursor);
			if (query.trim() !== words) return;
			results = [...results, ...found.songs];
			cursor = found.cursor;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			searching = false;
		}
	}
</script>

<header class="sticky top-[env(safe-area-inset-top)] z-10 px-3 pt-4 pb-3 bg-panel">
	<label
		class="flex items-center gap-3 h-12 px-4 rounded-full bg-white/[0.08] ring-1 ring-transparent focus-within:ring-white/20 focus-within:bg-white/10 transition"
	>
		<span class="icon-[mingcute--search-line] size-6 text-secondary-600"></span>
		<input
			bind:value={query}
			type="search"
			enterkeyhint="search"
			class="flex-1 min-w-0 bg-transparent outline-none placeholder:text-secondary-600 [&::-webkit-search-cancel-button]:hidden"
			placeholder="What do you want to listen to?"
			aria-label="Search"
		/>
		{#if searching}
			<span class="icon-[svg-spinners--ring-resize] size-5 text-secondary-600"></span>
		{:else if query}
			<button
				aria-label="Clear"
				class="-mr-1 size-7 grid place-items-center text-secondary-600"
				onclick={() => (query = '')}
			>
				<span class="icon-[mingcute--close-circle-fill] size-5"></span>
			</button>
		{/if}
	</label>
</header>

{#if !query.trim() && recent.length}
	<section class="px-4 pt-2">
		<div class="flex items-center justify-between">
			<h2 class="font-bold">Searched before</h2>
			<button class="text-sm text-secondary-600" onclick={() => keepRecent([])}>Clear</button>
		</div>
		<ul class="mt-1">
			{#each recent as words (words)}
				<li class="flex items-center">
					<button
						class="min-w-0 flex-1 flex items-center gap-3 py-2.5 text-start"
						onclick={() => (query = words)}
					>
						<span class="icon-[mingcute--time-line] size-5 text-secondary-600"></span>
						<span class="truncate">{words}</span>
					</button>
					<button
						aria-label="Forget {words}"
						class="size-10 grid place-items-center text-secondary-600"
						onclick={() => keepRecent(recent.filter((w) => w !== words))}
					>
						<span class="icon-[mingcute--close-line] size-4"></span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if yours.length}
	<h2 class="px-4 pt-2 pb-1 text-lg font-bold">Your songs</h2>
	<ul class="px-2 pb-3">
		{#each yours as song, i (`${song.id}:${song.track ?? 0}`)}
			<SongRow
				{song}
				onplay={() => {
					remember();
					play(yours, i);
				}}
			/>
		{/each}
	</ul>
{/if}

{#if error}
	<p class="px-5 text-sm text-red-400">Couldn't search: {error}</p>
{:else if query.trim() && !searching && !results.length && !yours.length}
	<p class="px-5 text-sm text-secondary-600">No songs found</p>
{/if}

{#if results.length}
	<h2 class="px-4 pt-2 pb-1 text-lg font-bold">On osu!</h2>
{/if}
<ul class="px-2 pb-4">
	{#each results as song, i (`${song.id}:${i}`)}
		<SongRow
			{song}
			onplay={() => {
				remember();
				play(results, i);
			}}
		/>
	{/each}
</ul>
{#if cursor && results.length}
	<div class="p-4 flex justify-center">
		<button
			class="h-10 px-5 rounded-full bg-white/10 font-semibold disabled:opacity-40"
			disabled={searching}
			onclick={more}
		>
			More
		</button>
	</div>
{/if}
