<script>
	// @ts-nocheck

	import { songQueue, setSongQueue, updateSongQueue, currentSong } from '../stores/audio';
	import { fetchMaps } from '../stores/data';
	import Beatmap from './Beatmap.svelte';
	import Input from './Input.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { mapDataStore } from '../stores/data';
	import { user } from '../stores/auth';
	import ContextMenu from './ContextMenu.svelte';
	import Button from './Button.svelte';
	import Modal from './Modal.svelte';
	import { keyStore } from '../stores/auth';
	import { getPlaylistSongs, playlists, playlistSongsCache } from '$lib/stores/playlist';
	import { getImageUrl } from '$lib/stores/data';
	import { addSongToPlaylist } from '$lib/stores/playlist';
	import SongToPlaylistModal from './SongToPlaylistModal.svelte';

	let initialTokenLoad = $state(true);

	let search = $state('');
	let osuMapsSearch = $state(null);
	let searchTimeout = null;
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

	// Function to handle the async operation
	function handlePlayMapChange(map) {
		if (!map) return;

		// Call your async function
		setQueue(map);
	}
	async function setQueue(map) {
		await setSongQueue(
			allMaps.findIndex((beatmap) => {
				return beatmap.id === map.id;
			}),
			allMaps,
			'preview'
		);
	}

	function debouncedSearch(args) {
		if (searchTimeout) clearTimeout(searchTimeout);

		searchTimeout = setTimeout(async () => {
			osuMapsSearch = await fetchMaps(args);
			allMaps = osuMapsSearch.beatmapsets;
		}, 500);
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

	$effect(async () => {
		if ($keyStore.access_token && initialTokenLoad) {
			osuMapsSearch = await fetchMaps();
			allMaps = osuMapsSearch.beatmapsets;
			loading = false;
			initialTokenLoad = false;
		}
	});

	onDestroy(() => {
		if (searchTimeout) clearTimeout(searchTimeout);

		observer = null;
	});
</script>

<div class="flex w-full items-center gap-2 mb-2">
	<Input
		bind:value={search}
		on:input={(e) => {
			debouncedSearch(e.target.value);
		}}
		placeholder="Search"
	/>
</div>
<div class="text-2xl flex gap-1">
	Welcome back {$user?.username}
</div>
{#if osuMapsSearch}
	<div class="grid xl:grid-cols-3 md:grid-cols-2 gap-2 grid-cols-1">
		{#key allMaps}
			{#each allMaps as map}
				<ContextMenu>
					<Beatmap bind:playMap {map} isDownloaded={isMapDownloaded(map.id.toString())} />
					<svelte:fragment slot="menu">
						<Button
							type="ghost"
							icon="icon-[fa6-solid--plus]"
							class="w-full py-3 rounded-sm hover:bg-secondary-300"
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
