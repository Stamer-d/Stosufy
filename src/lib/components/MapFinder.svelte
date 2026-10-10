<script>
	import {
		songQueue,
		setSongQueue,
		updateSongQueue,
		togglePlayback,
		currentSong,
		focusMode
	} from '#lib/stores/audio.ts';
	import {
		DEFAULT_SEARCH_FILTERS,
		fetchMaps,
		formatSongData,
		mapDataStore
	} from '#lib/stores/data.ts';
	import { user, userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import Beatmap from './Beatmap.svelte';
	import Input from './Input.svelte';
	import { onDestroy } from 'svelte';
	import ContextMenu from './ContextMenu.svelte';
	import Button from './Button.svelte';
	import SongToPlaylistModal from './SongToPlaylistModal.svelte';
	import QueueMenuItems from './QueueMenuItems.svelte';
	import Select from './Select.svelte';
	import PlaylistCover from './PlaylistCover.svelte';
	import { playlists } from '#lib/stores/playlist.ts';
	import { goto } from '$app/navigation';
	import { BEATMAP_STATUS } from '#lib/beatmapStatus.ts';
	import BeatmapBackground from './BeatmapBackground.svelte';
	import Triangles from './Triangles.svelte';
	import PlayButton from './PlayButton.svelte';
	import HomeCustomize from './HomeCustomize.svelte';
	import ClockWidget from './desktop/ClockWidget.svelte';
	import NowPlayingWidget from './desktop/NowPlayingWidget.svelte';
	import FetchWidget from './desktop/FetchWidget.svelte';
	import PlaylistDock from './desktop/PlaylistDock.svelte';
	import { wallpaper } from '#lib/stores/home.ts';
	import { DEFAULT_HOME } from '#lib/stores/user.ts';

	let customizeOpen = $state(false);
	let homeSettings = $derived({ ...DEFAULT_HOME, ...$userSettings.settings?.home });

	let hero = $derived($wallpaper);
	let heroPlaying = $derived($currentSong.song?.id == hero.song?.id && $currentSong.isPlaying);

	function playHero() {
		if ($currentSong.song?.id == hero.song.id) togglePlayback();
		else playDownloaded(hero.song);
	}

	const hour = new Date().getHours();
	const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

	// Newest downloads first
	let downloadedSongs = $derived(formatSongData($mapDataStore).reverse());

	function playDownloaded(song) {
		// Play it within the "Downloaded Songs" playlist (sorted oldest first, like that page)
		const songs = formatSongData($mapDataStore);
		setSongQueue(
			songs.findIndex((s) => s.id === song.id),
			songs,
			'playlist',
			-1
		);
	}

	// Colors match the status badges on the beatmap cards
	const STATUS_OPTIONS = [
		{ value: 'any', label: 'All', icon: 'icon-[fa6-solid--layer-group]' },
		...['ranked', 'loved', 'qualified', 'pending', 'graveyard'].map((value) => ({
			value,
			label: BEATMAP_STATUS[value].label,
			color: BEATMAP_STATUS[value].dot
		}))
	];
	const SORT_OPTIONS = [
		{ value: '', label: 'Relevance', icon: 'icon-[fa6-solid--wand-magic-sparkles]' },
		{ value: 'plays_desc', label: 'Most played', icon: 'icon-[fa6-solid--play]' },
		{ value: 'favourites_desc', label: 'Most favourited', icon: 'icon-[fa6-solid--heart]' },
		{ value: 'rating_desc', label: 'Highest rated', icon: 'icon-[fa6-solid--star]' },
		{ value: 'ranked_desc', label: 'Newest', icon: 'icon-[fa6-solid--clock]' },
		{ value: 'title_asc', label: 'Title (A-Z)', icon: 'icon-[fa6-solid--arrow-down-a-z]' }
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

{#snippet heroSection()}
	{#if hero.song}
		<section class="relative h-64 xl:h-72 rounded-xl overflow-hidden">
			<BeatmapBackground setId={hero.song.id} title={hero.song.title} class="absolute inset-0" />
			<!-- Keeps the text readable on bright backgrounds -->
			<div class="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/5"></div>
			<Triangles count={14} seed={Number(hero.song.id)} />
			<div class="relative h-full flex flex-col justify-end gap-2 p-6 max-w-2xl">
				<span
					class="w-fit px-2 py-0.5 rounded bg-primary-300 text-[11px] font-bold uppercase tracking-wide"
				>
					{hero.label}
				</span>
				<h2
					class="text-4xl font-extrabold tracking-tight leading-tight line-clamp-2 drop-shadow-lg"
				>
					{hero.song.title}
				</h2>
				<p class="text-white/80 font-medium truncate">
					{hero.song.artist}{hero.song.creator ? ` · mapped by ${hero.song.creator}` : ''}
				</p>
				<div class="mt-3 flex items-center gap-4">
					<PlayButton
						playing={heroPlaying}
						label={heroPlaying ? 'Pause' : `Play ${hero.song.title}`}
						onclick={playHero}
					/>
					{#if hero.downloaded}
						<button
							class="px-4 h-9 rounded-full bg-white/10 hover:bg-white/20 text-sm font-semibold cursor-pointer transition"
							onclick={() => goto('/playlist/-1')}
						>
							Open downloads
						</button>
					{/if}
				</div>
			</div>
		</section>
	{/if}
{/snippet}

{#snippet playlistsSection()}
	{#if $playlists.length}
		<div class="grid grid-cols-2 xl:grid-cols-3 gap-2">
			{#each $playlists.slice(0, 6) as playlist (playlist.id)}
				{@const playingThis = $songQueue.playlistId == playlist.id && $currentSong.isPlaying}
				<button
					class="group flex items-center gap-3 h-14 pr-3 rounded-md overflow-hidden bg-white/[0.06] hover:bg-white/[0.12] text-start cursor-pointer transition-colors"
					onclick={() => goto(`/playlist/${playlist.id}`)}
				>
					<PlaylistCover {playlist} class="size-14" />
					<span class="flex-1 min-w-0 font-semibold truncate">{playlist.title}</span>
					{#if playingThis}
						<span class="icon-[svg-spinners--bars-scale-middle] size-4 text-primary-500 shrink-0"
						></span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet recentSection()}
	{#if downloadedSongs.length}
		<section>
			<div class="flex items-baseline justify-between mb-3">
				<h2 class="text-xl font-bold tracking-tight">Recently downloaded</h2>
				<a
					href="/playlist/-1"
					class="text-sm font-semibold text-secondary-600 hover:text-white hover:underline"
				>
					Show all
				</a>
			</div>
			<div class="grid grid-cols-3 xl:grid-cols-6 gap-4">
				{#each downloadedSongs.slice(0, 6) as song, index (song.id)}
					{@const playingThis = $currentSong.song?.id == song.id && $currentSong.isPlaying}
					<div class="group min-w-0 {index >= 3 ? 'hidden xl:block' : ''}">
						<div class="relative aspect-square rounded-md overflow-hidden mb-2">
							<BeatmapBackground setId={song.id} title={song.title} class="absolute inset-0" />
							<button
								aria-label="Play {song.title}"
								class="absolute bottom-2 right-2 size-10 grid place-items-center rounded-full bg-primary-300 text-white shadow-lg shadow-black/40 cursor-pointer transition duration-200 hover:scale-105 hover:bg-primary-400 {playingThis
									? 'opacity-100'
									: 'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100'}"
								onclick={() => (playingThis ? togglePlayback() : playDownloaded(song))}
							>
								<span
									class="{playingThis
										? 'icon-[mingcute--pause-fill]'
										: 'icon-[mingcute--play-fill]'} size-5"
								></span>
							</button>
						</div>
						<p class="font-semibold text-sm truncate {playingThis ? 'text-primary-500' : ''}">
							{song.title}
						</p>
						<p class="text-sm text-secondary-600 truncate">{song.artist}</p>
					</div>
				{/each}
			</div>
		</section>
	{/if}
{/snippet}

{#snippet discoverSection()}
	<section>
		<h2 class="text-xl font-bold tracking-tight mb-3">Discover beatmaps</h2>
		<div class="flex flex-wrap items-center gap-2 mb-4">
			<div class="relative flex flex-1 min-w-64 items-center">
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
			<Select
				label="Status"
				options={STATUS_OPTIONS}
				value={filters.status}
				onchange={(status) => setFilter({ status })}
			/>
			<Select
				label="Sort"
				icon="icon-[fa6-solid--arrow-down-short-wide]"
				options={SORT_OPTIONS}
				value={filters.sort}
				onchange={(sort) => setFilter({ sort })}
			/>
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
				class="grid xl:grid-cols-3 md:grid-cols-2 gap-4 grid-cols-1 transition-opacity {searching
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
									icon="icon-[mingcute--add-circle-line]"
									class="w-full rounded-md text-sm hover:bg-secondary-400"
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
	</section>
{/snippet}

{#snippet customizeButton(onWallpaper)}
	<button
		class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold cursor-pointer transition {onWallpaper
			? 'bg-black/45 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white'
			: 'text-secondary-600 hover:text-white hover:bg-white/10'}"
		onclick={() => (customizeOpen = true)}
	>
		<span class="icon-[mingcute--palette-line] size-[18px]"></span>
		Customize
	</button>
{/snippet}

{#if homeSettings.layout === 'desktop'}
	<!-- Desktop: the beatmap background as wallpaper with widgets on it -->
	<section class="relative h-full min-h-[34rem] overflow-hidden">
		<BeatmapBackground
			setId={$wallpaper.song?.id ?? null}
			title={$wallpaper.song?.title}
			class="absolute inset-0"
		/>
		<div class="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60"></div>
		<div class="relative h-full flex flex-col justify-between gap-6 p-8">
			<div class="flex items-start justify-between gap-6">
				<ClockWidget />
				<div class="flex flex-col items-end gap-3">
					<div class="flex gap-2">
						<button
							class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold bg-black/45 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer transition"
							onclick={() => focusMode.set(true)}
						>
							<span class="icon-[mingcute--fullscreen-line] size-[18px]"></span>
							Focus
						</button>
						{@render customizeButton(true)}
					</div>
					<div class="hidden lg:block w-80"><FetchWidget /></div>
				</div>
			</div>
			<div class="flex items-end justify-between gap-6">
				<NowPlayingWidget class="w-full max-w-sm" />
				<div class="flex flex-col items-end gap-4">
					<PlaylistDock />
					<button
						class="flex items-center gap-1.5 text-sm font-semibold text-white/70 hover:text-white cursor-pointer drop-shadow"
						onclick={(e) =>
							e.currentTarget.closest('[data-scroll-container]')?.scrollTo({
								top: e.currentTarget.closest('section').offsetHeight,
								behavior: 'smooth'
							})}
					>
						Browse beatmaps
						<span class="icon-[mingcute--arrow-down-line] size-4"></span>
					</button>
				</div>
			</div>
		</div>
	</section>

	<div class="px-6 pt-8 pb-10 flex flex-col gap-10">
		{#each homeSettings.sections.filter((section) => section.visible && section.id !== 'hero') as section (section.id)}
			{#if section.id === 'playlists'}
				{@render playlistsSection()}
			{:else if section.id === 'recent'}
				{@render recentSection()}
			{:else if section.id === 'discover'}
				{@render discoverSection()}
			{/if}
		{/each}
	</div>
{:else}
	<div class="px-6 pt-6 pb-10 flex flex-col gap-10">
		<div class="flex items-center justify-between gap-4 -mb-4">
			<h1 class="text-3xl font-bold tracking-tight">
				{greeting}{$user?.username ? `, ${$user.username}` : ''}
			</h1>
			{@render customizeButton(false)}
		</div>

		{#each homeSettings.sections.filter((section) => section.visible) as section (section.id)}
			{#if section.id === 'hero'}
				{@render heroSection()}
			{:else if section.id === 'playlists'}
				{@render playlistsSection()}
			{:else if section.id === 'recent'}
				{@render recentSection()}
			{:else if section.id === 'discover'}
				{@render discoverSection()}
			{/if}
		{/each}
	</div>
{/if}

<HomeCustomize bind:open={customizeOpen} />

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
