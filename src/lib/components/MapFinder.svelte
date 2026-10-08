<script>
	import { songQueue, setSongQueue, updateSongQueue } from '#lib/stores/audio.ts';
	import { fetchMaps, mapDataStore } from '#lib/stores/data.ts';
	import { user } from '#lib/stores/user.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import Beatmap from './Beatmap.svelte';
	import Input from './Input.svelte';
	import { onDestroy } from 'svelte';
	import ContextMenu from './ContextMenu.svelte';
	import Button from './Button.svelte';
	import SongToPlaylistModal from './SongToPlaylistModal.svelte';

	let initialTokenLoad = $state(true);

	let search = $state('');
	let searching = $state(false);
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
			const result = await fetchMaps(query);
			if (requestId !== searchRequestId) return;
			osuMapsSearch = result;
			allMaps = result.beatmapsets;
		} finally {
			if (requestId === searchRequestId) searching = false;
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
					osuMapsSearch = await fetchMaps(search, osuMapsSearch?.cursor_string);

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

	$effect(() => {
		if ($keyStore.access_token && initialTokenLoad) {
			initialTokenLoad = false;
			fetchMaps().then((result) => {
				osuMapsSearch = result;
				allMaps = result.beatmapsets;
				loading = false;
			});
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
{#if osuMapsSearch && !allMaps?.length}
	<div class="flex flex-col items-center gap-2 mt-16 text-secondary-600">
		<span class="icon-[fa6-solid--music] size-10"></span>
		<p class="text-xl">No beatmaps found{search ? ` for "${search}"` : ''}</p>
		<p>Try a different search term</p>
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

{#if loading}
	<div class="w-full text-center">
		<span class="size-20 icon-[svg-spinners--ring-resize] text-primary-300"></span>
	</div>
{/if}

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
