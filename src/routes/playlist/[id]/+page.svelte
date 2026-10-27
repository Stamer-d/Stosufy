<script>
	import { showToast } from '#lib/stores/toast.ts';
	import { offline } from '#lib/stores/network.ts';
	import { cancelHoverPrefetch, prefetchOnHover } from '#lib/stores/stream.ts';
	import { onDestroy } from 'svelte';
	import { sameSong, songKey, songsLength } from '#lib/tracks.ts';
	import SongCover from '#lib/components/SongCover.svelte';
	import Button from '#lib/components/Button.svelte';
	import { deleteSong, getImageUrl, downloadBeatmap, downloads } from '#lib/stores/data.ts';
	import {
		getPlaylistSongs,
		refreshOtherPlaylist,
		playlistLoadingStatus,
		playlists,
		playlistSongsCache,
		removeSongFromPlaylist,
		moveSongInPlaylist,
		savedPlaylists,
		otherPlaylists,
		loadOtherPlaylist,
		toggleSavedPlaylist
	} from '#lib/stores/playlist.ts';
	import { isFavourite, toggleFavourite, LIKED_ID } from '#lib/stores/favourites.ts';
	import {
		currentSong,
		setSongQueue,
		songQueue,
		togglePlayback,
		updateSongQueue
	} from '#lib/stores/audio.ts';
	import { page } from '$app/state';
	import { keyStore } from '#lib/stores/auth.ts';
	import ContextMenu from '#lib/components/ContextMenu.svelte';
	import SongToPlaylistModal from '#lib/components/SongToPlaylistModal.svelte';
	import QueueMenuItems from '#lib/components/QueueMenuItems.svelte';
	import PlaylistCover from '#lib/components/PlaylistCover.svelte';
	import PlayButton from '#lib/components/PlayButton.svelte';
	import Triangles from '#lib/components/Triangles.svelte';
	import { colorFromImage, colorFromString, mapDataStore } from '#lib/stores/data.ts';
	import { downloadQueue, queueDownloads, cancelDownloads } from '#lib/stores/downloadQueue.ts';
	import { shuffleQueue } from '#lib/stores/audio.ts';
	import { user, updateUserSettings } from '#lib/stores/user.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import Select from '#lib/components/Select.svelte';
	import { matchesQuery } from '#lib/stores/search.ts';
	import { sortOptions, sortSongs } from '#lib/songSort.ts';

	let playlistId = $derived(page.params?.id);
	// The "Downloaded Songs" playlist has the id -1
	let isDownloadedPlaylist = $derived(playlistId === '-1');
	let isLiked = $derived(playlistId == String(LIKED_ID));
	// The user's own, a saved one of someone else, or one opened from Community playlists
	let playlistData = $derived(
		$playlists.find((playlist) => playlist.id == playlistId) ??
			$savedPlaylists.find((playlist) => playlist.id == playlistId) ??
			$otherPlaylists[playlistId]
	);
	let isOwn = $derived(
		playlistData?.created_by != null && playlistData.created_by == $user?.stosufy_id
	);
	/** A public playlist of someone else: only to listen to and save */
	let isOther = $derived(
		!!playlistData && !isDownloadedPlaylist && !isLiked && !isOwn && Number(playlistId) > 0
	);
	let isSaved = $derived($savedPlaylists.some((playlist) => playlist.id == playlistId));
	let missing = $state('');
	$effect(() => {
		if (playlistId && !playlistData && Number(playlistId) > 0 && $keyStore.access_token) {
			openOther(playlistId);
		}
	});
	async function openOther(id) {
		missing = '';
		try {
			await loadOtherPlaylist(id);
		} catch (error) {
			if (id === playlistId) missing = "This playlist is private or doesn't exist anymore.";
		}
	}
	let isLoadingSongs = $derived($playlistLoadingStatus[playlistId] || false);
	// (taken out right away when a song is removed, before the cache has it)
	let songs = $derived($playlistSongsCache[playlistId]?.songs || []);
	// How long it lasts (once its songs are loaded)
	let duration = $derived(songsLength(songs));

	// Sorting (remembered per playlist) and filtering; playing follows what's shown
	let filterText = $state('');
	let sort = $derived($userSettings.settings?.playlistSort?.[playlistId] ?? 'custom');
	// Genre and language: from the song, else from the downloaded set (see backfillDetails)
	const detailsOf = (song) => {
		const stored = $mapDataStore[song.id];
		return {
			...song,
			genre: song.genre ?? stored?.genre ?? null,
			language: song.language ?? stored?.language ?? null,
			tags: song.tags || stored?.tags || '',
			songSource: song.songSource ?? stored?.songSource ?? ''
		};
	};
	let detailed = $derived(songs.map(detailsOf));
	let genre = $state('');
	let language = $state('');
	// (each playlist starts without a genre or language chosen)
	$effect(() => {
		void playlistId;
		genre = '';
		language = '';
	});
	const counted = (values) =>
		Object.entries(
			values.filter(Boolean).reduce((all, v) => ({ ...all, [v]: (all[v] ?? 0) + 1 }), {})
		).sort((a, b) => b[1] - a[1]);
	let genres = $derived(counted(detailed.map((song) => song.genre)));
	let languages = $derived(counted(detailed.map((song) => song.language)));
	let visibleSongs = $derived(
		sortSongs(
			detailed.filter(
				(song) =>
					(!filterText.trim() || matchesQuery(song, filterText)) &&
					(!genre || song.genre === genre) &&
					(!language || song.language === language)
			),
			sort
		)
	);
	// Only the rows on screen (and a few around them) exist: big libraries (thousands of
	// songs) stay smooth, also when the playing song changes. Every row is ROW pixels tall.
	const ROW = 56;
	const AROUND = 12;
	let listEl = $state(null);
	let scrollEl = null;
	let firstRow = $state(0);
	let rowCount = $state(40);
	function updateRows() {
		if (!listEl || !scrollEl) return;
		const top = listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
		firstRow = Math.max(0, Math.floor(-top / ROW) - AROUND);
		rowCount = Math.ceil(scrollEl.clientHeight / ROW) + AROUND * 2;
	}
	$effect(() => {
		if (!listEl || scrollEl) return;
		scrollEl = listEl.closest('[data-scroll-container]');
		scrollEl?.addEventListener('scroll', updateRows, { passive: true });
		window.addEventListener('resize', updateRows);
		updateRows();
	});
	onDestroy(() => {
		scrollEl?.removeEventListener('scroll', updateRows);
		if (typeof window !== 'undefined') window.removeEventListener('resize', updateRows);
	});
	// (the rows again when the list or the playlist changes)
	$effect(() => {
		void visibleSongs;
		void playlistId;
		if (listEl) requestAnimationFrame(updateRows);
	});
	let shownSongs = $derived(visibleSongs.slice(firstRow, firstRow + rowCount));

	// Dragging songs reorders the playlist; only in its own order, unfiltered, if it's yours
	let canReorder = $derived(
		!isDownloadedPlaylist &&
			sort === 'custom' &&
			!filterText.trim() &&
			playlistData?.created_by != null &&
			playlistData.created_by == $user?.stosufy_id
	);
	let dragFrom = $state(null);
	let dropAt = $state(null);

	function dragOver(event, index) {
		if (dragFrom === null) return;
		event.preventDefault();
		const rect = event.currentTarget.getBoundingClientRect();
		dropAt = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
	}

	function drop(event) {
		event.preventDefault();
		if (dragFrom !== null && dropAt !== null) {
			const to = dropAt > dragFrom ? dropAt - 1 : dropAt;
			if (to !== dragFrom) moveSongInPlaylist(playlistId, dragFrom, to);
		}
		dragFrom = dropAt = null;
	}

	function setSort(value) {
		updateUserSettings({
			playlistSort: { ...$userSettings.settings?.playlistSort, [playlistId]: value }
		});
	}

	// Background wash of the header, taken from the cover
	let headerColor = $state(null);
	$effect(() => {
		if (playlistData) updateHeaderColor(playlistData);
	});

	async function updateHeaderColor(playlist) {
		if (playlist.id == -1) {
			headerColor = 'oklch(0.42 0.17 300)';
			return;
		}
		if (playlist.id == LIKED_ID) {
			headerColor = 'oklch(0.45 0.17 290)';
			return;
		}
		headerColor = colorFromString(playlist.title);
		if (playlist.image_url) {
			const color = await colorFromImage(playlist.image_url);
			if (color && playlistData === playlist) headerColor = color;
		}
	}

	let isPlayingThis = $derived($songQueue.playlistId == playlistId && $currentSong?.isPlaying);
	let shuffleOn = $derived($userSettings.settings?.shuffle || false);
	// With streaming on, songs that aren't downloaded play too (from the mirror)
	let streamable = $derived(($userSettings.settings?.stream ?? false) && !$offline);
	const isCurrent = (song) =>
		sameSong($currentSong?.song, song) && $songQueue.playlistId == playlistId;

	async function playSong(index, song) {
		if (
			$songQueue.type === 'playlist' &&
			$songQueue.playlistId == playlistId &&
			sameSong($currentSong?.song, song)
		) {
			togglePlayback();
		} else {
			// The queue is the list as shown: sorted and filtered
			await setSongQueue(index, visibleSongs, 'playlist', playlistId);
		}
	}

	async function toggleShuffle() {
		updateUserSettings({ shuffle: !shuffleOn });
		await shuffleQueue();
	}

	let addPlaylistModal = $state({
		open: false,
		map: null
	});

	$effect(() => {
		if (playlistId && playlistData) loadSongs();
	});

	// Someone else's playlist: loaded fresh when opened, and again every minute while open
	let refreshedOther = null;
	let otherTimer = null;
	$effect(() => {
		if (!isOther) {
			clearInterval(otherTimer);
			refreshedOther = null;
			return;
		}
		if (playlistId === refreshedOther) return;
		refreshedOther = playlistId;
		refreshOtherPlaylist(playlistId).catch(() => {});
		clearInterval(otherTimer);
		const id = playlistId;
		otherTimer = setInterval(() => {
			if (id === playlistId) refreshOtherPlaylist(id).catch(() => {});
		}, 60_000);
	});
	onDestroy(() => clearInterval(otherTimer));

	async function loadSongs(forceRefresh = false) {
		await getPlaylistSongs(playlistId, forceRefresh);
	}

	async function startDownload(song, mapId) {
		if ($offline) {
			showToast(
				"You're offline: songs download once you're connected",
				'icon-[mingcute--wifi-off-line]'
			);
			return;
		}
		try {
			await downloadBeatmap(song, mapId, $keyStore.sessionKey, $keyStore.access_token);
		} catch (error) {
			console.error(`Failed to download map ${song.id}:`, error);
		}
	}

	const dateFormat = new Intl.DateTimeFormat('de-DE', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
	const dateStrings = new Map();
	/** "2 weeks ago" and the like, worked out once per date (big playlists have thousands) */
	function getDateString(timestamp) {
		if (!timestamp) return '';
		const key = String(timestamp);
		let text = dateStrings.get(key);
		if (text === undefined) {
			text = dateString(timestamp);
			dateStrings.set(key, text);
		}
		return text;
	}

	function dateString(timestamp) {
		const date =
			timestamp.toString().length > 10 ? new Date(timestamp) : new Date(timestamp * 1000);

		const diffMs = Date.now() - date.getTime();

		const plural = (value, unit) => `${value} ${unit}${value !== 1 ? 's' : ''} ago`;

		const MINUTE = 60 * 1000;
		const HOUR = 60 * MINUTE;
		const DAY = 24 * HOUR;
		const WEEK = 7 * DAY;

		if (diffMs < MINUTE) return 'Just now';
		if (diffMs < HOUR) return plural(Math.floor(diffMs / MINUTE), 'minute');
		if (diffMs < DAY) return plural(Math.floor(diffMs / HOUR), 'hour');

		const diffDays = Math.floor(diffMs / DAY);

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return plural(diffDays, 'day');
		if (diffDays < 30) return plural(Math.floor(diffDays / 7), 'week');

		return dateFormat.format(date);
	}

	async function removeSong(songId) {
		const currentIndex = $songQueue.currentIndex;
		const deletedIndex = songs.findIndex((song) => song.songInfo.id == songId);
		songs = songs.filter((song) => song.songInfo.id != songId);
		if ($songQueue?.type == 'playlist' && $songQueue?.playlistId == playlistId) {
			const isShuffled = $userSettings.settings.shuffle || false;

			if (isShuffled) {
				const currentQueue = $songQueue.queue.filter((song) => song.songInfo?.id !== songId);
				const deletedQueueIndex = $songQueue.queue.findIndex(
					(song) => song.songInfo?.id === songId
				);

				let newCurrentIndex = currentIndex;
				if (deletedQueueIndex < currentIndex) {
					newCurrentIndex = currentIndex - 1;
				} else if (deletedQueueIndex === currentIndex) {
					if (currentQueue.length > 0) {
						newCurrentIndex = Math.min(currentIndex, currentQueue.length - 1);
					}
				}

				songQueue.update((queue) => ({
					...queue,
					queue: currentQueue,
					currentIndex: newCurrentIndex
				}));
			} else {
				if (deletedIndex < currentIndex) {
					await updateSongQueue(currentIndex - 1, songs, 'playlist', playlistId);
				} else if (deletedIndex === currentIndex) {
					if (songs.length > 0) {
						const newIndex = Math.min(currentIndex, songs.length - 1);
						await updateSongQueue(newIndex, songs, 'playlist', playlistId);
					}
				} else {
					await updateSongQueue(currentIndex, songs, 'playlist', playlistId);
				}
			}
		}
		await removeSongFromPlaylist(playlistId, songId);
	}

	// Read from the library store, so rows and the header follow downloads as they finish
	// (a plain lookup in the template is only worked out once)
	const isDownloaded = (song) =>
		Object.prototype.hasOwnProperty.call($mapDataStore, String(song.id));
	let missingSongs = $derived(songs.filter((song) => !isDownloaded(song)));
	// Downloading all goes through the download queue (one after another, waiting out osu!'s
	// rate limit); it shows here while songs of this playlist are in it
	let missingIds = $derived(new Set(missingSongs.map((song) => String(song.id))));
	let queuedHere = $derived(
		$downloadQueue.items.filter(({ set }) => missingIds.has(String(set.id)))
	);
	let downloadingAll = $derived(queuedHere.length > 0);
	let downloadProgress = $derived(
		songs.length ? ((songs.length - missingSongs.length) / songs.length) * 100 : 0
	);

	function downloadAllSongs() {
		if ($offline) {
			showToast(
				"You're offline: songs download once you're connected",
				'icon-[mingcute--wifi-off-line]'
			);
			return;
		}
		queueDownloads(missingSongs.map((song) => ({ set: song, mapId: song.beatmaps[0].id })));
	}

	function stopDownloadingAll() {
		cancelDownloads(queuedHere.map(({ set }) => String(set.id)));
	}
</script>

{#if playlistData}
	<div
		class="transition-colors duration-500"
		style="background: linear-gradient(to bottom, {headerColor ??
			'transparent'} 0, transparent 26rem)"
	>
		<header class="relative flex items-end gap-6 px-6 pt-14 pb-6 overflow-hidden">
			<Triangles count={16} seed={Number(playlistId) || 7} />
			<PlaylistCover
				playlist={playlistData}
				class="relative size-44 xl:size-52 rounded-md shadow-2xl shadow-black/50"
				iconClass="size-16"
			/>
			<div class="relative min-w-0 pb-1">
				<p class="text-sm font-semibold">
					{isDownloadedPlaylist
						? 'On this device'
						: isLiked
							? 'Playlist'
							: playlistData.public
								? 'Public playlist'
								: 'Private playlist'}
				</p>
				<h1
					class="mt-1 text-4xl xl:text-6xl font-extrabold tracking-tight leading-[1.05] line-clamp-2 break-words"
				>
					{playlistData.title}
				</h1>
				{#if playlistData.description}
					<p class="mt-3 text-sm text-white/70 line-clamp-2">{playlistData.description}</p>
				{/if}
				<p class="mt-3 text-sm">
					{#if isOther}
						{#if playlistData.creator?.avatarUrl}
							<img
								src={playlistData.creator.avatarUrl}
								alt=""
								class="inline size-5 rounded-full align-[-4px] mr-1"
							/>
						{/if}
						{#if playlistData.creator?.osuId}
							<a href="/profile/{playlistData.creator.osuId}" class="font-bold hover:underline"
								>{playlistData.creator.username ?? 'Someone'}</a
							>
						{:else}
							<span class="font-bold">Someone</span>
						{/if}
						<span class="text-white/70"> · </span>
					{:else if !isDownloadedPlaylist && $user?.username}
						<a href="/profile/me" class="font-bold hover:underline">{$user.username}</a>
						<span class="text-white/70"> · </span>
					{/if}
					{#if playlistData.public && playlistData.saves}
						<span class="text-white/70">
							{playlistData.saves}
							{playlistData.saves === 1 ? 'save' : 'saves'} ·
						</span>
					{/if}
					<span class="text-white/70">
						{playlistData.song_amount}
						{playlistData.song_amount === 1 ? 'song' : 'songs'}{duration ? ` · ${duration}` : ''}
					</span>
				</p>
			</div>
		</header>

		<div class="flex items-center gap-5 px-6 py-4 bg-black/10">
			<PlayButton
				playing={isPlayingThis}
				disabled={!visibleSongs.length}
				onclick={async () => {
					if ($songQueue?.playlistId == playlistId) {
						togglePlayback();
					} else if (visibleSongs.length > 0) {
						await setSongQueue(0, visibleSongs, 'playlist', playlistId);
					}
				}}
			/>

			<button
				title={shuffleOn ? 'Disable shuffle' : 'Enable shuffle'}
				aria-label={shuffleOn ? 'Disable shuffle' : 'Enable shuffle'}
				aria-pressed={shuffleOn}
				class="relative size-10 grid place-items-center rounded-full cursor-pointer transition {shuffleOn
					? 'text-primary-500'
					: 'text-white/60 hover:text-white'}"
				onclick={toggleShuffle}
			>
				<span class="icon-[mingcute--shuffle-line] size-7"></span>
				{#if shuffleOn}
					<span class="absolute bottom-0 size-1 rounded-full bg-primary-500"></span>
				{/if}
			</button>

			{#if isOther}
				<button
					title={isSaved ? 'Remove from your library' : 'Save to your library'}
					aria-label={isSaved ? 'Remove from your library' : 'Save to your library'}
					aria-pressed={isSaved}
					class="size-10 grid place-items-center rounded-full cursor-pointer transition {isSaved
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					onclick={() => toggleSavedPlaylist(playlistData)}
				>
					<span
						class="{isSaved
							? 'icon-[mingcute--bookmark-fill]'
							: 'icon-[mingcute--bookmark-line]'} size-7"
					></span>
				</button>
			{/if}

			{#if !isDownloadedPlaylist}
				{#if downloadingAll}
					<div
						class="relative size-10"
						title="Downloading: {songs.length - missingSongs.length} of {songs.length} downloaded"
					>
						<svg class="size-10 -rotate-90" viewBox="0 0 36 36">
							<circle
								cx="18"
								cy="18"
								r="15.9"
								fill="none"
								stroke-width="3"
								class="stroke-white/15"
							/>
							<circle
								cx="18"
								cy="18"
								r="15.9"
								fill="none"
								stroke-width="3"
								stroke-linecap="round"
								stroke-dasharray="{downloadProgress}, 100"
								class="stroke-primary-400 transition-all duration-300 ease-out"
							/>
						</svg>
						<button
							aria-label="Stop downloading"
							onclick={stopDownloadingAll}
							class="absolute inset-0 grid place-items-center text-white/70 hover:text-white cursor-pointer"
						>
							<span class="icon-[mingcute--stop-fill] size-4"></span>
						</button>
					</div>
				{:else}
					{@const missing = missingSongs.length}
					<button
						title={missing
							? `Download ${missing} missing ${missing === 1 ? 'song' : 'songs'}`
							: 'All songs downloaded'}
						aria-label={missing ? 'Download all songs' : 'All songs downloaded'}
						disabled={!missing}
						class="size-10 grid place-items-center rounded-full cursor-pointer transition {missing
							? 'text-white/60 hover:text-white'
							: 'text-primary-500 cursor-default'}"
						onclick={downloadAllSongs}
					>
						<span
							class="{missing
								? 'icon-[mingcute--download-2-line]'
								: 'icon-[mingcute--check-circle-fill]'} size-7"
						></span>
					</button>
				{/if}
			{/if}

			<div class="ml-auto flex items-center gap-2">
				<div class="relative flex items-center">
					<span
						class="icon-[mingcute--search-line] absolute left-3 size-4 text-secondary-600 pointer-events-none"
					></span>
					<input
						type="search"
						bind:value={filterText}
						placeholder="Filter"
						aria-label="Filter songs in this playlist"
						class="w-48 h-9 pl-9 pr-3 rounded-full bg-white/[0.06] hover:bg-white/10 focus:bg-white/10 text-sm text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition [&::-webkit-search-cancel-button]:hidden"
					/>
				</div>
				{#if languages.length > 1}
					<Select
						label="Language"
						icon="icon-[mingcute--translate-2-line]"
						options={[
							{ value: '', label: 'Any' },
							...languages.map(([name, n]) => ({ value: name, label: `${name} (${n})` }))
						]}
						value={language}
						onchange={(value) => (language = value)}
					/>
				{/if}
				<Select
					label="Sort"
					icon="icon-[mingcute--sort-descending-line]"
					options={sortOptions(isDownloadedPlaylist)}
					value={sort}
					onchange={setSort}
				/>
			</div>
		</div>
	</div>

	<div class="px-6 pb-10">
		{#if genres.length > 1}
			<!-- The genres in the playlist, to listen to one of them -->
			<div class="flex flex-wrap gap-1.5 mb-4">
				{#each [{ name: '', n: detailed.length }, ...genres.map( ([name, n]) => ({ name, n }) )] as chip (chip.name)}
					<button
						class="h-8 px-3.5 rounded-full text-sm font-semibold cursor-pointer transition {genre ===
						chip.name
							? 'bg-white text-black'
							: 'bg-white/[0.06] text-white/75 hover:bg-white/10 hover:text-white'}"
						onclick={() => (genre = genre === chip.name ? '' : chip.name)}
					>
						{chip.name || 'All'}
						<span class="ml-1 opacity-50 font-normal">{chip.n}</span>
					</button>
				{/each}
			</div>
		{/if}
		<div
			class="grid grid-cols-[2rem_minmax(0,1fr)_9rem_2rem_2.5rem] items-center gap-4 px-4 h-9 mb-2 border-b border-white/10 text-sm text-secondary-600"
		>
			<span class="text-end">#</span>
			<span>Title</span>
			<span>{isDownloadedPlaylist ? 'Downloaded' : isLiked ? 'Date liked' : 'Date added'}</span>
			<span></span>
			<span></span>
		</div>

		{#if songs?.length}
			<div
				bind:this={listEl}
				style="padding-top: {firstRow * ROW}px; padding-bottom: {Math.max(
					0,
					visibleSongs.length - firstRow - shownSongs.length
				) * ROW}px"
			>
				{#each shownSongs as song, i (songKey(song))}
					{@const index = firstRow + i}
					{@const downloaded = isDownloaded(song)}
					{@const current = isCurrent(song)}
					{@const playingRow = current && $currentSong?.isPlaying && $songQueue.type == 'playlist'}
					{@const download = $downloads[song.id]}
					{@const playable = downloaded || streamable}
					{@const liked = $isFavourite(song)}
					<ContextMenu disabled={!playable}>
						<div
							role="button"
							tabindex="0"
							aria-label={playable ? `Play ${song.title}` : `Download ${song.title}`}
							draggable={canReorder}
							title={canReorder ? 'Drag to change the order' : undefined}
							ondragstart={(e) => {
								dragFrom = index;
								e.dataTransfer.effectAllowed = 'move';
								e.dataTransfer.setData('text/plain', String(index));
							}}
							ondragover={(e) => dragOver(e, index)}
							ondrop={drop}
							ondragend={() => (dragFrom = dropAt = null)}
							class="group relative grid grid-cols-[2rem_minmax(0,1fr)_9rem_2rem_2.5rem] items-center gap-4 px-4 h-14 rounded-md cursor-pointer transition-colors {current
								? 'bg-white/[0.08]'
								: 'hover:bg-white/[0.06]'} {dragFrom === index ? 'opacity-40' : ''}"
							onmouseenter={() => prefetchOnHover(song, downloaded)}
							onmouseleave={cancelHoverPrefetch}
							onclick={async () => {
								if (playable) {
									await playSong(index, song);
								} else if (!download?.isDownloading) {
									await startDownload(song, song.beatmaps[0].id);
								}
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter') e.currentTarget.click();
							}}
						>
							{#if dragFrom !== null && (dropAt === index || (dropAt === index + 1 && index === visibleSongs.length - 1))}
								<!-- Where the dragged song will land -->
								<div
									class="absolute left-2 right-2 h-0.5 rounded-full bg-primary-400 pointer-events-none {dropAt ===
									index
										? '-top-px'
										: '-bottom-px'}"
								></div>
							{/if}
							{#if canReorder}
								<span
									class="icon-[mingcute--menu-line] absolute left-1 size-3.5 text-secondary-600 opacity-0 group-hover:opacity-100 pointer-events-none"
								></span>
							{/if}
							<div
								class="relative h-5 flex items-center justify-end text-secondary-600 tabular-nums"
							>
								{#if !playable}
									<span class="group-hover:opacity-0 {download?.isDownloading ? 'opacity-0' : ''}">
										{index + 1}
									</span>
									<span
										class="icon-[mingcute--download-2-line] absolute size-5 text-white {download?.isDownloading
											? 'opacity-0'
											: 'opacity-0 group-hover:opacity-100'}"
									></span>
									{#if download?.isDownloading}
										<span class="absolute text-xs font-semibold text-primary-500">
											{Math.round(download.progress || 0)}%
										</span>
									{/if}
								{:else if playingRow}
									<span
										class="icon-[svg-spinners--bars-scale-middle] absolute size-4 text-primary-500 group-hover:opacity-0"
									></span>
									<span
										class="icon-[mingcute--pause-fill] absolute size-5 text-white opacity-0 group-hover:opacity-100"
									></span>
								{:else}
									<span class="group-hover:opacity-0 {current ? 'text-primary-500' : ''}">
										{index + 1}
									</span>
									<span
										class="icon-[mingcute--play-fill] absolute size-5 text-white opacity-0 group-hover:opacity-100"
									></span>
								{/if}
							</div>

							<div class="flex items-center gap-3 min-w-0 {playable ? '' : 'opacity-50'}">
								<SongCover
									setId={song.id}
									track={song.track}
									title={song.title}
									class="size-10 rounded"
									lazy
								/>
								<div class="min-w-0">
									<h3 class="font-semibold truncate {current ? 'text-primary-500' : ''}">
										{song.title}
									</h3>
									<p class="text-sm text-secondary-600 truncate">{song.artist}</p>
								</div>
							</div>

							<span class="flex items-center gap-2 min-w-0 text-sm text-secondary-600">
								{#if !downloaded && streamable}
									<!-- Streamed: the cloud, and on hover a button to download it after all -->
									<button
										title={download?.isDownloading
											? `Downloading… ${Math.round(download.progress || 0)}%`
											: 'Streams from the mirror. Download it to keep it'}
										aria-label="Download {song.title}"
										class="relative shrink-0 size-7 grid place-items-center rounded-full hover:bg-white/10 hover:text-white cursor-pointer transition"
										disabled={download?.isDownloading}
										onclick={async (e) => {
											e.stopPropagation();
											await startDownload(song, song.beatmaps[0].id);
										}}
									>
										{#if download?.isDownloading}
											<span class="text-[10px] font-bold text-primary-500 tabular-nums"
												>{Math.round(download.progress || 0)}</span
											>
										{:else}
											<span class="icon-[mingcute--cloud-line] size-4 group-hover:opacity-0"></span>
											<span
												class="icon-[mingcute--download-2-line] absolute size-4 opacity-0 group-hover:opacity-100"
											></span>
										{/if}
									</button>
								{:else if downloaded && !isDownloadedPlaylist}
									<span
										title="Downloaded"
										aria-label="Downloaded"
										class="icon-[mingcute--arrow-down-circle-fill] shrink-0 size-4 text-primary-500"
									></span>
								{/if}
								<span class="truncate"
									>{getDateString(song?.created_at || song?.songInfo?.created_at)}</span
								>
							</span>

							<button
								title={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
								aria-label={liked
									? `Remove ${song.title} from Liked Songs`
									: `Add ${song.title} to Liked Songs`}
								aria-pressed={liked}
								class="size-8 grid place-items-center rounded-full cursor-pointer transition {liked
									? 'text-primary-500'
									: 'text-secondary-600 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
								onclick={(e) => {
									e.stopPropagation();
									toggleFavourite(song);
								}}
							>
								<span
									class="{liked
										? 'icon-[mingcute--heart-fill]'
										: 'icon-[mingcute--heart-line]'} size-[18px]"
								></span>
							</button>

							{#if isOther || isLiked}
								<span></span>
							{:else}
								<button
									title={isDownloadedPlaylist ? 'Delete download' : 'Remove from playlist'}
									aria-label={isDownloadedPlaylist
										? `Delete download of ${song.title}`
										: `Remove ${song.title} from playlist`}
									disabled={!isDownloadedPlaylist && !song?.songInfo?.id}
									class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer transition"
									onclick={async (e) => {
										e.stopPropagation();
										if (isDownloadedPlaylist) {
											// (just this song of a set with several)
											await deleteSong(song.id, song.track);
											songs = songs.filter((s) => !sameSong(s, song));
										} else {
											removeSong(song.songInfo.id);
										}
									}}
								>
									<span
										class="{isDownloadedPlaylist
											? 'icon-[mingcute--delete-2-line]'
											: 'icon-[mingcute--close-line]'} size-[18px]"
									></span>
								</button>
							{/if}

							{#if download?.isDownloading}
								<div class="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-white/10">
									<div
										class="h-full rounded-full bg-primary-400 transition-all duration-200 ease-out"
										style="width: {download.progress || 0}%;"
									></div>
								</div>
							{/if}
						</div>
						{#snippet menu()}
							<QueueMenuItems {song} />
							<Button
								type="ghost"
								class="w-full rounded-md text-sm hover:bg-secondary-400"
								icon="icon-[mingcute--add-circle-line]"
								onclick={() => {
									addPlaylistModal.open = true;
									addPlaylistModal.map = song;
								}}
							>
								Add to playlist
							</Button>
						{/snippet}
					</ContextMenu>
				{/each}
			</div>
		{/if}

		{#if songs?.length && !visibleSongs.length}
			<p class="mt-10 text-center text-secondary-600">No songs match "{filterText}".</p>
		{/if}

		{#if !isLoadingSongs && !songs?.length}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<span class="icon-[mingcute--music-2-line] size-10 text-secondary-600"></span>
				<p class="text-lg font-semibold">
					{isDownloadedPlaylist
						? 'No downloaded songs yet'
						: isLiked
							? 'Songs you like show up here'
							: 'This playlist is empty'}
				</p>
				<p class="text-sm text-secondary-600">
					{isDownloadedPlaylist
						? 'Download beatmaps on the home page to listen to them here.'
						: isLiked
							? 'Click the heart next to a song to like it.'
							: isOther
								? 'Nothing in here yet.'
								: 'Right-click a song and choose "Add to playlist".'}
				</p>
			</div>
		{/if}
		{#if isLoadingSongs && !songs.length}
			<div class="grid place-items-center py-16">
				<span class="size-10 icon-[svg-spinners--ring-resize] text-primary-400"></span>
			</div>
		{/if}
	</div>
{/if}

{#if !playlistData && missing}
	<div class="flex flex-col items-center gap-2 py-24 text-center">
		<span class="icon-[mingcute--lock-line] size-10 text-secondary-600"></span>
		<p class="text-lg font-semibold">{missing}</p>
	</div>
{/if}

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
