<script>
	const base = __WEB_BASE__;
	// Search: your playlists' songs first, then osu!'s (they stream); the searches of before
	// while nothing is typed. osu!'s songs by status, genre, language and order, as in the
	// desktop app (the same filters: they're in the account's settings).
	import { page } from '$app/state';
	import { play, slim } from '../../player';
	import SongRow from '../../SongRow.svelte';
	import { libraryPool, fetchMaps } from '../../shims/data';
	import { userSettings, updateUserSettings } from '../../shims/user';
	import { BEATMAP_STATUS } from '../../../lib/beatmapStatus';
	import { GENRES, LANGUAGES } from '../../../lib/genres';
	import { fade, fly } from 'svelte/transition';

	const FILTERS = {
		status: {
			label: 'Status',
			options: [
				{ value: 'any', label: 'All' },
				...['ranked', 'loved', 'qualified', 'pending', 'graveyard'].map((value) => ({
					value,
					label: BEATMAP_STATUS[value].label,
					dot: BEATMAP_STATUS[value].dot
				}))
			]
		},
		sort: {
			label: 'Sort',
			options: [
				{ value: '', label: 'Relevance' },
				{ value: 'plays_desc', label: 'Most played' },
				{ value: 'favourites_desc', label: 'Most favourited' },
				{ value: 'rating_desc', label: 'Highest rated' },
				{ value: 'ranked_desc', label: 'Newest' },
				{ value: 'title_asc', label: 'Title (A-Z)' }
			]
		},
		genre: {
			label: 'Genre',
			options: [
				{ value: '', label: 'Any genre' },
				...Object.entries(GENRES).map(([value, label]) => ({ value, label }))
			]
		},
		language: {
			label: 'Language',
			options: [
				{ value: '', label: 'Any language' },
				...Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))
			]
		}
	};
	const DEFAULTS = { status: 'any', sort: '', genre: '', language: '' };
	let filters = $derived({ ...DEFAULTS, ...$userSettings.settings?.searchFilters });
	let filtered = $derived(
		Object.keys(DEFAULTS).some((key) => (filters[key] ?? '') !== DEFAULTS[key])
	);
	/** The filter whose options are shown */
	let choosing = $state(null);
	function setFilter(key, value) {
		choosing = null;
		updateUserSettings({ searchFilters: { ...filters, [key]: value } });
	}
	const chipLabel = (key) =>
		filters[key] !== DEFAULTS[key]
			? (FILTERS[key].options.find((o) => o.value === filters[key])?.label ?? FILTERS[key].label)
			: FILTERS[key].label;

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
	let query = $state(page.url.searchParams.get('q') ?? sessionStorage.getItem(KEY) ?? '');
	// (opened for an artist, a mapper, an anime: from a beatmap's page)
	$effect(() => {
		const asked = page.url.searchParams.get('q');
		if (asked != null) query = asked;
	});
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
		const data = await fetchMaps(words, after, filters);
		return { songs: (data.beatmapsets ?? []).map(songOf), cursor: data.cursor_string ?? '' };
	}

	/** What's searched: the words and the filters (filters alone browse osu!) */
	let asking = $derived(`${query.trim()}|${JSON.stringify(filters)}`);

	// A moment after the typing stops
	$effect(() => {
		const words = query.trim();
		const wanted = asking;
		const browse = !words && filtered;
		try {
			sessionStorage.setItem(KEY, query);
		} catch {
			// (private browsing)
		}
		error = '';
		if (!words && !browse) {
			results = [];
			cursor = '';
			return;
		}
		searching = true;
		const timer = setTimeout(
			async () => {
				try {
					const found = await search(words);
					if (asking !== wanted) return;
					results = found.songs;
					cursor = found.cursor;
				} catch (e) {
					if (asking === wanted) error = e instanceof Error ? e.message : String(e);
				} finally {
					if (asking === wanted) searching = false;
				}
			},
			browse ? 0 : 400
		);
		return () => clearTimeout(timer);
	});

	async function more() {
		const words = query.trim();
		const wanted = asking;
		searching = true;
		try {
			const found = await search(words, cursor);
			if (asking !== wanted) return;
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
	<div class="-mx-3 mt-3 px-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" data-no-swipe>
		{#each Object.keys(FILTERS) as key (key)}
			{@const on = filters[key] !== DEFAULTS[key]}
			<button
				class="shrink-0 h-9 pl-3.5 pr-2.5 flex items-center gap-1 rounded-full text-sm font-semibold transition {on
					? 'bg-primary-300 text-white'
					: 'bg-white/[0.08] text-white/80'}"
				onclick={() => (choosing = key)}
			>
				{chipLabel(key)}
				<span class="icon-[mingcute--down-line] size-4 opacity-70"></span>
			</button>
		{/each}
		{#if filtered}
			<button
				class="shrink-0 h-9 px-3 rounded-full text-sm text-secondary-600"
				onclick={() => updateUserSettings({ searchFilters: { ...DEFAULTS } })}
			>
				Reset
			</button>
		{/if}
	</div>
</header>

{#if choosing}
	{@const filter = FILTERS[choosing]}
	<div class="fixed inset-0 z-40 flex flex-col justify-end">
		<button
			class="absolute inset-0 bg-black/60"
			aria-label="Close"
			onclick={() => (choosing = null)}
			transition:fade={{ duration: 150 }}
		></button>
		<div
			class="relative max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-panel pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
			transition:fly={{ y: 400, duration: 220, opacity: 1 }}
		>
			<div class="pt-2 flex justify-center">
				<span class="w-10 h-1 rounded-full bg-white/20"></span>
			</div>
			<p class="px-5 pt-3 pb-2 text-lg font-bold">{filter.label}</p>
			<ul class="pb-2">
				{#each filter.options as option (option.value)}
					{@const picked = (filters[choosing] ?? '') === option.value}
					<li>
						<button
							class="w-full flex items-center gap-4 px-5 py-3.5 text-start active:bg-white/5 {picked
								? 'text-primary-400 font-semibold'
								: ''}"
							onclick={() => setFilter(choosing, option.value)}
						>
							{#if option.dot}<span class="size-2.5 rounded-full {option.dot}"></span>{/if}
							<span class="flex-1">{option.label}</span>
							{#if picked}<span class="icon-[mingcute--check-line] size-5"></span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}

{#if !query.trim() && !filtered}
	<a
		href="{base}/community"
		class="mx-3 mt-1 mb-2 flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-primary-300/40 to-white/[0.04] active:opacity-80"
	>
		<span class="size-11 grid place-items-center rounded-lg bg-black/25">
			<span class="icon-[mingcute--earth-2-line] size-6"></span>
		</span>
		<span class="min-w-0 flex-1">
			<span class="block font-semibold">Community playlists</span>
			<span class="block text-sm text-white/70">Public playlists of other Stosufy users</span>
		</span>
		<span class="icon-[mingcute--right-line] size-5 text-white/60"></span>
	</a>
{/if}

{#if !query.trim() && !filtered && recent.length}
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
{:else if (query.trim() || filtered) && !searching && !results.length && !yours.length}
	<p class="px-5 text-sm text-secondary-600">No songs found</p>
{/if}

{#if results.length}
	<h2 class="px-4 pt-2 pb-1 text-lg font-bold">{query.trim() ? 'On osu!' : 'Songs on osu!'}</h2>
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
