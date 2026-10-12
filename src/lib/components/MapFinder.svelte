<script>
	import { sameSong, songKey } from '#lib/tracks.ts';
	import { GENRES, LANGUAGES } from '#lib/genres.ts';
	import { offline, noteNetworkError } from '#lib/stores/network.ts';
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
	import SongCover from './SongCover.svelte';
	import { get } from 'svelte/store';
	import { searchQuery, matchesQuery } from '#lib/stores/search.ts';
	import { onDestroy, tick, untrack } from 'svelte';
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
	import Gameplay from './Gameplay.svelte';
	import GameplayControls from './GameplayControls.svelte';
	import { playingLive } from '#lib/gameplay/play.ts';
	import Triangles from './Triangles.svelte';
	import PlayButton from './PlayButton.svelte';
	import { openSettings } from '#lib/stores/settings.ts';
	import DesktopCanvas from './DesktopCanvas.svelte';
	import WidgetStore from './WidgetStore.svelte';
	import MapperLink from './MapperLink.svelte';

	let editingWidgets = $state(false);
	// The gameplay of the song on the desktop, like osu!'s autoplay
	let gameplayOn = $derived($userSettings.settings?.gameplay ?? false);
	let widgetsInGameplay = $derived($userSettings.settings?.widgetsInGameplay ?? true);
	const toggleGameplay = () => updateUserSettings({ gameplay: !gameplayOn });
	let widgetStoreOpen = $state(false);

	// The desktop controls only show while the mouse moves over the desktop, like on macOS,
	// so they don't sit on top of the widgets
	const CONTROLS_HIDE_DELAY = 2000;
	let controlsActive = $state(false);
	let controlsHovered = $state(false);
	let controlsTimer;
	let showControls = $derived(controlsActive || controlsHovered || editingWidgets);

	// Right-click menu of the desktop
	let desktopMenu = $derived([
		{
			icon: 'icon-[mingcute--layout-4-line]',
			label: editingWidgets ? 'Done editing' : 'Edit widgets',
			action: () => (editingWidgets = !editingWidgets)
		},
		{
			icon: 'icon-[mingcute--add-line]',
			label: 'Add widgets',
			action: () => {
				editingWidgets = true;
				widgetStoreOpen = true;
			}
		},
		{
			icon: 'icon-[mingcute--target-line]',
			label: gameplayOn ? 'Hide gameplay' : 'Show gameplay',
			action: toggleGameplay
		},
		{
			icon: 'icon-[mingcute--fullscreen-line]',
			label: 'Focus mode',
			action: () => focusMode.set(true)
		},
		{
			icon: 'icon-[mingcute--palette-line]',
			label: 'Customize',
			action: () => openSettings('home')
		}
	]);

	function revealControls() {
		controlsActive = true;
		clearTimeout(controlsTimer);
		controlsTimer = setTimeout(() => (controlsActive = false), CONTROLS_HIDE_DELAY);
	}
	import { wallpaper } from '#lib/stores/home.ts';
	import { DEFAULT_HOME } from '#lib/stores/user.ts';

	let homeSettings = $derived({ ...DEFAULT_HOME, ...$userSettings.settings?.home });

	let hero = $derived($wallpaper);
	let heroPlaying = $derived(sameSong($currentSong.song, hero.song) && $currentSong.isPlaying);

	function playHero() {
		if (sameSong($currentSong.song, hero.song)) togglePlayback();
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
			songs.findIndex((s) => sameSong(s, song)),
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

	const GENRE_OPTIONS = [
		{ value: '', label: 'Any', icon: 'icon-[mingcute--music-2-line]' },
		...Object.entries(GENRES).map(([value, label]) => ({ value, label }))
	];
	const LANGUAGE_OPTIONS = [
		{ value: '', label: 'Any', icon: 'icon-[mingcute--translate-2-line]' },
		...Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))
	];

	let filters = $derived($userSettings.settings?.searchFilters ?? DEFAULT_SEARCH_FILTERS);

	function setFilter(change) {
		updateUserSettings({ searchFilters: { ...filters, ...change } });
		if (searchTimeout) clearTimeout(searchTimeout);
		runSearch(search);
	}

	/** @type {{ searchPage?: boolean }} */
	let { searchPage = false } = $props();

	// On the search page the query comes from the search bar in the title bar
	let search = $state(untrack(() => searchPage) ? get(searchQuery) : '');
	$effect(() => {
		const query = $searchQuery;
		if (searchPage && query !== search) {
			search = query;
			debouncedSearch(query);
		}
	});
	let libraryMatches = $derived(
		searchPage ? formatSongData($mapDataStore).filter((song) => matchesQuery(song, search)) : []
	);
	let searching = $state(false);
	let searchError = $state(null);
	// Back online after a failed search: tried again
	$effect(() => {
		if (!$offline && untrack(() => searchError)) runSearch(untrack(() => search));
	});
	let osuMapsSearch = $state(null);
	let searchTimeout = null;
	let searchRequestId = 0;
	let allMaps = $state([]);

	let endOfContent = $state(null);
	let loading = $state(true);
	// Start loading the next page a bit before the end of the list is reached
	const LOAD_AHEAD = 400;

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
			noteNetworkError(error);
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

	function isMapDownloaded(setId) {
		return !!$mapDataStore[setId];
	}

	let loadingMore = false;

	/** Loads the next page of the current search, until the end of the list is out of view */
	async function loadMore() {
		const cursor = osuMapsSearch?.cursor_string;
		// No cursor: the last page is loaded (asking without one would start over)
		if (loadingMore || searching || !cursor || !endOfContent) return;
		const requestId = searchRequestId;
		loadingMore = true;
		loading = true;
		try {
			const result = await fetchMaps(search, cursor, filters);
			// A new search started meanwhile: these results belong to the old one
			if (requestId !== searchRequestId) return;
			if (!Array.isArray(result?.beatmapsets)) {
				console.error('Invalid response: beatmapsets is not an array', result);
				return;
			}
			osuMapsSearch = result;
			const known = new Set(allMaps.map((map) => map.id));
			const added = result.beatmapsets.filter((map) => !known.has(map.id));
			allMaps = [...allMaps, ...added];
			// Nothing new: don't keep asking for more right away
			if (!added.length) return;
			if ($songQueue.type == 'preview') await updateSongQueue(null, allMaps);
		} catch (error) {
			console.error('Error fetching more maps:', error);
			return;
		} finally {
			loadingMore = false;
			loading = false;
		}
		// The new maps may not fill the screen; the observer only reports changes
		await tick();
		if (endOfContent && isInView(endOfContent)) loadMore();
	}

	// The list scrolls inside the main panel, not the window
	const scrollRoot = (element) => element.closest('[data-scroll-container]');

	function isInView(element) {
		const bottom = scrollRoot(element)?.getBoundingClientRect().bottom ?? window.innerHeight;
		return element.getBoundingClientRect().top < bottom + LOAD_AHEAD;
	}

	// Watches the end of the list. It is re-created with the list, so the observer follows it
	$effect(() => {
		const sentinel = endOfContent;
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => entries.some((entry) => entry.isIntersecting) && loadMore(),
			{ root: scrollRoot(sentinel), rootMargin: `0px 0px ${LOAD_AHEAD}px 0px` }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
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
	});
</script>

{#snippet heroSection()}
	{#if hero.song}
		<section class="relative h-64 xl:h-72 rounded-xl overflow-hidden">
			<BeatmapBackground
				setId={hero.song.id}
				mapId={hero.song?.beatmaps?.[0]?.id}
				title={hero.song.title}
				class="absolute inset-0"
			/>
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
					{hero.song.artist}{#if hero.song.creator}
						· mapped by <MapperLink
							name={hero.song.creator}
							id={hero.song.user_id ?? hero.song.creatorId}
						/>{/if}
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
				{#each downloadedSongs.slice(0, 6) as song, index (songKey(song))}
					{@const playingThis = sameSong($currentSong.song, song) && $currentSong.isPlaying}
					<div class="group min-w-0 {index >= 3 ? 'hidden xl:block' : ''}">
						<div class="relative aspect-square rounded-md overflow-hidden mb-2">
							<BeatmapBackground
								setId={song.id}
								mapId={song?.beatmaps?.[0]?.id}
								title={song.title}
								class="absolute inset-0"
							/>
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
		<div class="flex flex-wrap items-center gap-2 mb-4">
			<h2 class="flex-1 text-xl font-bold tracking-tight">
				{searchPage ? (search ? 'Beatmaps' : 'Popular beatmaps') : 'Discover beatmaps'}
			</h2>
			{#if searching}
				<span class="icon-[svg-spinners--ring-resize] size-4 text-primary-400"></span>
			{/if}
			<Select
				label="Status"
				options={STATUS_OPTIONS}
				value={filters.status}
				onchange={(status) => setFilter({ status })}
			/>
			<Select
				label="Genre"
				options={GENRE_OPTIONS}
				value={filters.genre ?? ''}
				onchange={(genre) => setFilter({ genre })}
			/>
			<Select
				label="Language"
				options={LANGUAGE_OPTIONS}
				value={filters.language ?? ''}
				onchange={(language) => setFilter({ language })}
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
				{#if $offline}
					<span class="icon-[mingcute--wifi-off-line] size-10 text-amber-300"></span>
					<p class="text-xl">You're offline</p>
					<p class="text-sm">Beatmaps show up again once you're connected.</p>
				{:else}
					<span class="icon-[fa6-solid--triangle-exclamation] size-10 text-red-400"></span>
					<p class="text-xl">Couldn't load beatmaps</p>
					<p class="text-sm">{searchError}</p>
				{/if}
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
				{#each allMaps as map (map.id)}
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
			</div>

			<div bind:this={endOfContent}></div>
		{/if}

		{#if loading && !searchError}
			<div class="w-full text-center">
				<span class="size-20 icon-[svg-spinners--ring-resize] text-primary-300"></span>
			</div>
		{/if}
	</section>
{/snippet}

{#snippet desktopButton(icon, label, onclick)}
	<button
		class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold bg-black/30 backdrop-blur-2xl ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer transition"
		{onclick}
	>
		<span class="{icon} size-[18px]"></span>
		{label}
	</button>
{/snippet}

{#snippet customizeButton(onWallpaper)}
	<button
		class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold cursor-pointer transition {onWallpaper
			? 'bg-black/30 backdrop-blur-2xl ring-1 ring-white/10 text-white/80 hover:text-white'
			: 'text-secondary-600 hover:text-white hover:bg-white/10'}"
		onclick={() => openSettings('home')}
	>
		<span class="icon-[mingcute--palette-line] size-[18px]"></span>
		Customize
	</button>
{/snippet}

{#if searchPage}
	<div class="px-6 pt-6 pb-10 flex flex-col gap-10">
		{#if libraryMatches.length}
			<section>
				<h2 class="text-xl font-bold tracking-tight mb-3">In your library</h2>
				<div class="grid md:grid-cols-2 gap-1">
					{#each libraryMatches.slice(0, 8) as song (songKey(song))}
						{@const playingThis = sameSong($currentSong.song, song) && $currentSong.isPlaying}
						<button
							class="group flex items-center gap-3 p-2 rounded-md text-start cursor-pointer hover:bg-white/[0.06] transition-colors"
							onclick={() =>
								sameSong($currentSong.song, song) ? togglePlayback() : playDownloaded(song)}
						>
							<div class="relative shrink-0">
								<SongCover
									setId={song.id}
									track={song.track}
									title={song.title}
									class="size-12 rounded"
								/>
								<span
									class="absolute inset-0 grid place-items-center rounded bg-black/50 transition-opacity {playingThis
										? 'opacity-100'
										: 'opacity-0 group-hover:opacity-100'}"
								>
									<span
										class="{playingThis
											? 'icon-[mingcute--pause-fill]'
											: 'icon-[mingcute--play-fill]'} size-5 text-white"
									></span>
								</span>
							</div>
							<span class="min-w-0">
								<span
									class="block font-semibold truncate {sameSong($currentSong.song, song)
										? 'text-primary-500'
										: 'text-white'}">{song.title}</span
								>
								<span class="block text-sm text-secondary-600 truncate">
									{song.artist}{#if song.creator}
										· mapped by <MapperLink
											name={song.creator}
											id={song.user_id ?? song.creatorId}
										/>{/if}
								</span>
							</span>
						</button>
					{/each}
				</div>
				{#if libraryMatches.length > 8}
					<p class="mt-2 text-sm text-secondary-600">
						And {libraryMatches.length - 8} more in Downloaded Songs.
					</p>
				{/if}
			</section>
		{/if}
		{@render discoverSection()}
	</div>
{:else if homeSettings.layout === 'desktop'}
	<!-- Desktop: the beatmap background as wallpaper with widgets on it -->
	<ContextMenu class="h-full">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<section
			class="relative h-full min-h-[34rem] overflow-hidden"
			onpointermove={revealControls}
			onpointerleave={() => (controlsActive = false)}
		>
			<BeatmapBackground
				setId={$wallpaper.song?.id ?? null}
				mapId={$wallpaper.song?.beatmaps?.[0]?.id}
				title={$wallpaper.song?.title}
				class="absolute inset-0"
				video
				beat
			/>
			<div
				class="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60"
			></div>
			{#if gameplayOn && $currentSong.song}
				<!-- The song's gameplay, like osu!'s autoplay, over a dimmed background -->
				<div class="absolute inset-0 bg-black/45"></div>
				<!-- (playing it yourself, it fills the window instead: PlayOverlay) -->
				{#if !$playingLive && !$focusMode}
					<Gameplay class="absolute inset-0" />
				{/if}
			{/if}
			<!-- The widgets make way when you play yourself (unless they're being edited) -->
			{#if !$focusMode && (!gameplayOn || !$currentSong.song || editingWidgets || (widgetsInGameplay && !$playingLive))}
				<DesktopCanvas editing={editingWidgets} />
			{/if}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute top-6 right-6 z-30 flex gap-2 transition-opacity duration-300 focus-within:opacity-100 {showControls
					? 'opacity-100'
					: 'opacity-0 pointer-events-none'}"
				onpointerenter={() => (controlsHovered = true)}
				onpointerleave={() => (controlsHovered = false)}
			>
				{#if editingWidgets}
					{@render desktopButton(
						'icon-[mingcute--add-line]',
						'Add widgets',
						() => (widgetStoreOpen = true)
					)}
					<button
						class="flex items-center gap-2 px-4 h-9 rounded-full text-sm font-bold bg-white text-black hover:bg-white/90 cursor-pointer transition"
						onclick={() => (editingWidgets = false)}
					>
						Done
					</button>
				{:else}
					{@render desktopButton(
						'icon-[mingcute--layout-4-line]',
						'Edit widgets',
						() => (editingWidgets = true)
					)}
					{@render desktopButton(
						gameplayOn ? 'icon-[mingcute--target-fill]' : 'icon-[mingcute--target-line]',
						gameplayOn ? 'Hide gameplay' : 'Gameplay',
						toggleGameplay
					)}
					{#if gameplayOn && $currentSong.song}
						<GameplayControls />
					{/if}
					{@render desktopButton('icon-[mingcute--fullscreen-line]', 'Focus', () =>
						focusMode.set(true)
					)}
					{@render customizeButton(true)}
				{/if}
			</div>
			<button
				class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 text-sm font-semibold text-white/70 hover:text-white cursor-pointer drop-shadow transition-opacity duration-300 focus-visible:opacity-100 {showControls
					? 'opacity-100'
					: 'opacity-0'}"
				onclick={(e) =>
					e.currentTarget.closest('[data-scroll-container]')?.scrollTo({
						top: e.currentTarget.closest('section').offsetHeight,
						behavior: 'smooth'
					})}
			>
				Browse beatmaps
				<span class="icon-[mingcute--arrow-down-line] size-4"></span>
			</button>
		</section>
		<svelte:fragment slot="menu">
			{#each desktopMenu as item (item.label)}
				<Button
					type="ghost"
					icon={item.icon}
					class="w-full rounded-md text-sm hover:bg-secondary-400"
					on:click={item.action}
				>
					{item.label}
				</Button>
			{/each}
		</svelte:fragment>
	</ContextMenu>

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

<WidgetStore bind:open={widgetStoreOpen} />

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
