<script>
	// osu!'s songs: search, play (they stream), like, add to a playlist, download
	import { freshToken } from '../../shims/auth';
	import { osuApi } from '../../shims/http';
	import { play, slim } from '../../player';
	import SongRow from '../../SongRow.svelte';

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

<header class="px-5 pt-6 pb-3">
	<h1 class="text-3xl font-extrabold">Search</h1>
	<label
		class="mt-3 flex items-center gap-2 h-11 px-3 rounded-xl bg-secondary-300 focus-within:ring-2 focus-within:ring-primary-400"
	>
		<span class="icon-[mingcute--search-line] size-5 text-secondary-600"></span>
		<input
			bind:value={query}
			type="search"
			enterkeyhint="search"
			class="flex-1 min-w-0 bg-transparent outline-none text-base"
			placeholder="Songs and artists on osu!"
			aria-label="Search"
		/>
		{#if searching}
			<span class="icon-[svg-spinners--ring-resize] size-5 text-secondary-600"></span>
		{/if}
	</label>
</header>

{#if error}
	<p class="px-5 text-sm text-red-400">Couldn't search: {error}</p>
{:else if query.trim() && !searching && !results.length}
	<p class="px-5 text-sm text-secondary-600">No songs found</p>
{/if}

<ul class="px-3">
	{#each results as song, i (`${song.id}:${i}`)}
		<SongRow {song} onplay={() => play(results, i)} />
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
