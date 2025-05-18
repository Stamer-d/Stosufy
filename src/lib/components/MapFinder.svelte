<script>
// @ts-nocheck

	import { songQueue, setSongQueue, updateSongQueue } from '../stores/audio';
	import { fetchMaps } from '../stores/data';
	import Beatmap from './Beatmap.svelte';
	import Input from './Input.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { mapDataStore } from '../stores/data';
	import { user } from '../stores/auth';
	let search;
	let osuMapsSearch = null;
	let searchTimeout = null;
	let allMaps = [];

	let endOfContent = null;
	let observer = null;
	let loading = true;

	let playMap = null;
	$: if (playMap) {
		handlePlayMapChange(playMap);
	}

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
				osuMapsSearch = await fetchMaps(search, osuMapsSearch.cursor_string);
				allMaps = [...allMaps, ...osuMapsSearch.beatmapsets];
				loading = false;
				if ($songQueue.type == 'preview') {
					await updateSongQueue(null, allMaps);
				}
			}
		});
	};

	$: if (endOfContent) {
		if (!observer) {
			setupObserver();
		}
	}

	onMount(async () => {
		osuMapsSearch = await fetchMaps();
		allMaps = osuMapsSearch.beatmapsets;
		loading = false;
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
				<Beatmap bind:playMap {map} isDownloaded={isMapDownloaded(map.id.toString())} />
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
