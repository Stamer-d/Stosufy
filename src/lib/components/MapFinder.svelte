<script>
	import { songQueue, setSongQueue, updateSongQueue } from '#lib/stores/audio.ts';
	import { DEFAULT_SEARCH_FILTERS, fetchMaps, mapDataStore } from '#lib/stores/data.ts';
	import { user, userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import Beatmap from './Beatmap.svelte';
	import Input from './Input.svelte';
	import { onDestroy } from 'svelte';
	import ContextMenu from './ContextMenu.svelte';
	import Button from './Button.svelte';
	import SongToPlaylistModal from './SongToPlaylistModal.svelte';
	import QueueMenuItems from './QueueMenuItems.svelte';

	const STATUS_OPTIONS = [
		{ value: 'any', label: 'All' },
		{ value: 'ranked', label: 'Ranked' },
		{ value: 'loved', label: 'Loved' },
		{ value: 'qualified', label: 'Qualified' },
		{ value: 'pending', label: 'Pending' },
		{ value: 'graveyard', label: 'Graveyard' }
	];
	const SORT_OPTIONS = [
		{ value: '', label: 'Relevance' },
		{ value: 'plays_desc', label: 'Most played' },
		{ value: 'favourites_desc', label: 'Most favourited' },
		{ value: 'rating_desc', label: 'Highest rated' },
		{ value: 'ranked_desc', label: 'Newest' },
		{ value: 'title_asc', label: 'Title (A-Z)' }
	];

	let filters = $derived($userSettings.settings?.searchFilters ?? DEFAULT_SEARCH_FILTERS);

	function setFilter(change) {
		updateUserSettings({ searchFilters: { ...filters, ...change } });
		if (searchTimeout) clearTimeout(searchTimeout);
		runSearch(search);
	}

	let search = $state('');
	let searching = $state(false);
	let searchError = $state(null);
	let osuMapsSearch = $state(null);
	let searchTimeout = null;
	let searchRequestId = 0;
	let allMaps = $state([]);

	let endOfContent = $state(null);
	let observer = null;
	let loading = $state(true);

	let playMap = $state(null);
	let addPlaylistModal = $state({
		open: false,
		map: null
	});

	$effect(() => {
		if (playMap !== null) {
			setQueue(playMap);
			playMap = null;
		}
	});

	async function setQueue(map) {
		await setSongQueue(
			allMaps.findIndex((beatmap) => {
				return beatmap.id === map.id;
			}),
			allMaps,
			'preview'
		);
	}

	async function runSearch(query) {
		// Ignore responses of outdated searches that finish after a newer one
		const requestId = ++searchRequestId;
		searching = true;
		try {
			const result = await fetchMaps(query, '', filters);
			if (requestId !== searchRequestId) return;
			osuMapsSearch = result;
			allMaps = result.beatmapsets ?? [];
			searchError = null;
		} catch (error) {
			if (requestId === searchRequestId) {
				searchError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (requestId === searchRequestId) {
				searching = false;
				loading = false;
			}
		}
	}

	function debouncedSearch(query) {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => runSearch(query), 500);
	}

	function clearSearch() {
		if (searchTimeout) clearTimeout(searchTimeout);
		search = '';
		runSearch('');
	}

	function isMapDownloaded(setId) {
		return !!$mapDataStore[setId];
	}

	const setupObserver = () => {
		const options = {
			root: null,
			rootMargin: '0px',
			threshold: 0
		};

		observer = new IntersectionObserver(handleIntersect, options);
		if (endOfContent) {
			observer.observe(endOfContent);
		}
	};

	const handleIntersect = (entries) => {
		entries.forEach(async (entry) => {
			if (allMaps?.length < 50) return;
			if (entry.isIntersecting) {
				loading = true;
				try {
					osuMapsSearch = await fetchMaps(search, osuMapsSearch?.cursor_string, filters);

					// Safely check that beatmapsets exists and is an array
					if (osuMapsSearch && Array.isArray(osuMapsSearch.beatmapsets)) {
						allMaps = [...allMaps, ...osuMapsSearch.beatmapsets];

						if ($songQueue.type == 'preview') {
							await updateSongQueue(null, allMaps);
						}
					} else {
						console.error('Invalid response: beatmapsets is not an array', osuMapsSearch);
					}
				} catch (error) {
					console.error('Error fetching more maps:', error);
				} finally {
					loading = false;
				}
			}
		});
	};

	$effect(() => {
		if (endOfContent) {
			if (!observer) {
				setupObserver();
			}
		}
	});

	// Load the maps once logged in, and again whenever the token changes (e.g. after it
	// was refreshed) as long as nothing could be loaded yet
	let loadedWithToken = null;
	$effect(() => {
		const token = $keyStore.access_token;
		if (token && token !== loadedWithToken && !allMaps?.length) {
			loadedWithToken = token;
			runSearch(search);
		}
	});

	onDestroy(() => {
		if (searchTimeout) clearTimeout(searchTimeout);
		observer?.disconnect();
		observer = null;
	});
</script>

<div class="text-2xl font-semibold mb-3">
	Welcome back{$user?.username ? `, ${$user.username}` : ''}
</div>
<div class="relative flex w-full items-center mb-4">
	<span
		class="icon-[fa6-solid--magnifying-glass] absolute left-3 size-4 text-secondary-600 pointer-events-none"
	></span>
	<Input
		bind:value={search}
		on:input={(e) => {
			debouncedSearch(/** @type {HTMLInputElement} */ (e.target).value);
		}}
		placeholder="Search beatmaps by title, artist or mapper"
		class="pl-9 pr-9"
	/>
	{#if searching}
		<span
			class="icon-[svg-spinners--ring-resize] absolute right-3 size-4 text-primary-400 pointer-events-none"
		></span>
	{:else if search}
		<button
			aria-label="Clear search"
			class="absolute right-2 p-1 flex text-secondary-600 hover:text-white cursor-pointer"
			onclick={clearSearch}
		>
			<span class="icon-[fa6-solid--xmark] size-4"></span>
		</button>
	{/if}
</div>
<div class="flex flex-wrap items-center gap-2 mb-4">
	<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Beatmap status">
		{#each STATUS_OPTIONS as option (option.value)}
			{@const active = filters.status === option.value}
			<button
				role="radio"
				aria-checked={active}
				class="px-3 py-1 rounded-full text-sm font-medium cursor-pointer transition {active
					? 'bg-primary-200 text-white'
					: 'bg-secondary-300 text-secondary-600 hover:text-white hover:bg-secondary-400'}"
				onclick={() => !active && setFilter({ status: option.value })}
			>
				{option.label}
			</button>
		{/each}
	</div>
	<label class="ml-auto flex items-center gap-2 text-sm text-secondary-600">
		<span class="icon-[fa6-solid--arrow-down-short-wide] size-4"></span>
		<span class="sr-only">Sort by</span>
		<select
			class="bg-secondary-300 text-white rounded-md px-2 py-1 outline-none cursor-pointer hover:bg-secondary-400 focus:ring-1 focus:ring-secondary-600"
			value={filters.sort}
			onchange={(e) => setFilter({ sort: e.currentTarget.value })}
		>
			{#each SORT_OPTIONS as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
</div>
{#if searchError && !allMaps?.length}
	<div class="flex flex-col items-center gap-3 mt-16 text-secondary-600">
		<span class="icon-[fa6-solid--triangle-exclamation] size-10 text-red-400"></span>
		<p class="text-xl">Couldn't load beatmaps</p>
		<p class="text-sm">{searchError}</p>
		<Button type="primary" on:click={() => runSearch(search)}>Try again</Button>
	</div>
{:else if osuMapsSearch && !allMaps?.length}
	<div class="flex flex-col items-center gap-2 mt-16 text-secondary-600">
		<span class="icon-[fa6-solid--music] size-10"></span>
		<p class="text-xl">No beatmaps found{search ? ` for "${search}"` : ''}</p>
		<p>
			{filters.status !== 'any'
				? 'Try a different search term or status'
				: 'Try a different search term'}
		</p>
	</div>
{:else if osuMapsSearch}
	<div
		class="grid xl:grid-cols-3 md:grid-cols-2 gap-2 grid-cols-1 transition-opacity {searching
			? 'opacity-50'
			: ''}"
	>
		{#key allMaps}
			{#each allMaps as map}
				<ContextMenu>
					<Beatmap bind:playMap {map} isDownloaded={isMapDownloaded(map.id.toString())} />
					<svelte:fragment slot="menu">
						{#if isMapDownloaded(map.id.toString())}
							<QueueMenuItems song={map} />
						{/if}
						<Button
							type="ghost"
							icon="icon-[fa6-solid--plus]"
							class="w-full py-3 rounded-sm hover:bg-secondary-400"
							on:click={() => {
								addPlaylistModal.open = true;
								addPlaylistModal.map = map;
							}}
						>
							Add to Playlist
						</Button>
					</svelte:fragment>
				</ContextMenu>
			{/each}
		{/key}
	</div>

	<div bind:this={endOfContent} class=""></div>
{/if}

{#if loading && !searchError}
	<div class="w-full text-center">
		<span class="size-20 icon-[svg-spinners--ring-resize] text-primary-300"></span>
	</div>
{/if}

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
