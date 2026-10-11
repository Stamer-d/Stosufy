<script>
	import { onDestroy } from 'svelte';
	import { sameSong, songKey } from '#lib/tracks.ts';
	import SongCover from '#lib/components/SongCover.svelte';
	import Button from '#lib/components/Button.svelte';
	import {
		deleteSong,
		getImageUrl,
		isSongDownloaded,
		downloadBeatmap,
		downloads
	} from '#lib/stores/data.ts';
	import {
		getPlaylistSongs,
		playlistLoadingStatus,
		playlists,
		playlistSongsCache,
		removeSongFromPlaylist,
		moveSongInPlaylist
	} from '#lib/stores/playlist.ts';
	import {
		currentSong,
		setSongQueue,
		songQueue,
		togglePlayback,
		updateSongQueue
	} from '#lib/stores/audio.ts';
	import { page } from '$app/state';
	import { toStore } from 'svelte/store';
	import { keyStore } from '#lib/stores/auth.ts';
	import ContextMenu from '#lib/components/ContextMenu.svelte';
	import SongToPlaylistModal from '#lib/components/SongToPlaylistModal.svelte';
	import QueueMenuItems from '#lib/components/QueueMenuItems.svelte';
	import PlaylistCover from '#lib/components/PlaylistCover.svelte';
	import PlayButton from '#lib/components/PlayButton.svelte';
	import Triangles from '#lib/components/Triangles.svelte';
	import { colorFromImage, colorFromString } from '#lib/stores/data.ts';
	import { shuffleQueue } from '#lib/stores/audio.ts';
	import { user, updateUserSettings } from '#lib/stores/user.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import Select from '#lib/components/Select.svelte';
	import { matchesQuery } from '#lib/stores/search.ts';
	import { sortOptions, sortSongs } from '#lib/songSort.ts';

	const pagePlaylistId = toStore(() => page.params?.id);
	$: playlistId = $pagePlaylistId;
	// The "Downloaded Songs" playlist has the id -1
	$: isDownloadedPlaylist = playlistId === '-1';
	$: playlistData = $playlists.find((playlist) => playlist.id == playlistId);
	$: isLoadingSongs = $playlistLoadingStatus[playlistId] || false;
	$: songs = $playlistSongsCache[playlistId]?.songs || [];

	// Sorting (remembered per playlist) and filtering; playing follows what's shown
	let filterText = '';
	$: sort = $userSettings.settings?.playlistSort?.[playlistId] ?? 'custom';
	$: visibleSongs = sortSongs(
		filterText.trim() ? songs.filter((song) => matchesQuery(song, filterText)) : songs,
		sort
	);
	// Big playlists render the first rows at once and the rest frame by frame, so opening
	// them doesn't freeze the app
	const FIRST_ROWS = 60;
	const ROWS_PER_FRAME = 30;
	let shownRows = FIRST_ROWS;
	let rowsFrame = null;
	$: (playlistId, (shownRows = FIRST_ROWS));
	$: if (shownRows < visibleSongs.length && typeof window !== 'undefined') {
		cancelAnimationFrame(rowsFrame);
		rowsFrame = requestAnimationFrame(() => (shownRows += ROWS_PER_FRAME));
	}
	onDestroy(() => cancelAnimationFrame(rowsFrame));

	// Dragging songs reorders the playlist; only in its own order, unfiltered, if it's yours
	$: canReorder =
		!isDownloadedPlaylist &&
		sort === 'custom' &&
		!filterText.trim() &&
		playlistData?.created_by != null &&
		playlistData.created_by == $user?.stosufy_id;
	let dragFrom = null;
	let dropAt = null;

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
	let headerColor = null;
	$: if (playlistData) updateHeaderColor(playlistData);

	async function updateHeaderColor(playlist) {
		if (playlist.id == -1) {
			headerColor = 'oklch(0.42 0.17 300)';
			return;
		}
		headerColor = colorFromString(playlist.title);
		if (playlist.image_url) {
			const color = await colorFromImage(playlist.image_url);
			if (color && playlistData === playlist) headerColor = color;
		}
	}

	$: isPlayingThis = $songQueue.playlistId == playlistId && $currentSong?.isPlaying;
	$: shuffleOn = $userSettings.settings?.shuffle || false;
	$: isCurrent = (song) =>
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

	let addPlaylistModal = {
		open: false,
		map: null
	};

	let downloadingAll = {
		downloading: false,
		progress: 0,
		abort: false
	};

	$: if (playlistId && playlistData) {
		loadSongs();
	}

	async function loadSongs(forceRefresh = false) {
		await getPlaylistSongs(playlistId, forceRefresh);
	}

	async function startDownload(song, mapId) {
		try {
			await downloadBeatmap(song, mapId, $keyStore.sessionKey, $keyStore.access_token);

			setTimeout(() => {
				songs = [...songs];
			}, 500);
		} catch (error) {
			console.error(`Failed to download map ${song.id}:`, error);
		}
	}

	function getDateString(timestamp) {
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

		return date.toLocaleDateString('de-DE', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
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

	function getNotDownloadedSongs() {
		return songs.filter((song) => !isSongDownloaded(song.id));
	}

	async function downloadAllSongs() {
		const notDownloadedSongs = getNotDownloadedSongs();
		if (notDownloadedSongs.length === 0) {
			return;
		}

		downloadingAll.downloading = true;
		downloadingAll.progress = 0;
		downloadingAll.abort = false;

		let completedDownloads = 0;
		const totalSongs = notDownloadedSongs.length;

		for (const song of notDownloadedSongs) {
			if (downloadingAll.abort) {
				break;
			}

			try {
				await startDownload(song, song.beatmaps[0].id);
				completedDownloads++;

				downloadingAll.progress = (completedDownloads / totalSongs) * 100;
			} catch (error) {
				console.error(`Failed to download ${song.title}:`, error);
				completedDownloads++;
				downloadingAll.progress = (completedDownloads / totalSongs) * 100;
			}
		}
		setTimeout(() => {
			downloadingAll.downloading = false;
		}, 500);

		if (!downloadingAll.abort) {
			downloadingAll.progress = 100;
		}
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
					{#if !isDownloadedPlaylist && $user?.username}
						<span class="font-bold">{$user.username}</span>
						<span class="text-white/70"> · </span>
					{/if}
					<span class="text-white/70">
						{playlistData.song_amount}
						{playlistData.song_amount === 1 ? 'song' : 'songs'}
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
				on:click={toggleShuffle}
			>
				<span class="icon-[mingcute--shuffle-line] size-7"></span>
				{#if shuffleOn}
					<span class="absolute bottom-0 size-1 rounded-full bg-primary-500"></span>
				{/if}
			</button>

			{#if !isDownloadedPlaylist}
				{#if downloadingAll.downloading}
					<div class="relative size-10" title="Downloading {Math.round(downloadingAll.progress)}%">
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
								stroke-dasharray="{downloadingAll.progress}, 100"
								class="stroke-primary-400 transition-all duration-300 ease-out"
							/>
						</svg>
						<button
							aria-label="Stop downloading"
							on:click={() => {
								downloadingAll.abort = true;
								downloadingAll.downloading = false;
							}}
							class="absolute inset-0 grid place-items-center text-white/70 hover:text-white cursor-pointer"
						>
							<span class="icon-[mingcute--stop-fill] size-4"></span>
						</button>
					</div>
				{:else}
					{@const missing = getNotDownloadedSongs().length}
					<button
						title={missing
							? `Download ${missing} missing ${missing === 1 ? 'song' : 'songs'}`
							: 'All songs downloaded'}
						aria-label={missing ? 'Download all songs' : 'All songs downloaded'}
						disabled={!missing}
						class="size-10 grid place-items-center rounded-full cursor-pointer transition {missing
							? 'text-white/60 hover:text-white'
							: 'text-primary-500 cursor-default'}"
						on:click={downloadAllSongs}
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
		<div
			class="grid grid-cols-[2rem_minmax(0,1fr)_9rem_2.5rem] items-center gap-4 px-4 h-9 mb-2 border-b border-white/10 text-sm text-secondary-600"
		>
			<span class="text-end">#</span>
			<span>Title</span>
			<span>{isDownloadedPlaylist ? 'Downloaded' : 'Date added'}</span>
			<span></span>
		</div>

		{#if songs?.length}
			{#key playlistId}
				{#each visibleSongs.slice(0, shownRows) as song, index (songKey(song))}
					{@const downloaded = isSongDownloaded(song.id)}
					{@const current = isCurrent(song)}
					{@const playingRow = current && $currentSong?.isPlaying && $songQueue.type == 'playlist'}
					{@const download = $downloads[song.id]}
					<ContextMenu disabled={!downloaded}>
						<div
							role="button"
							tabindex="0"
							aria-label={downloaded ? `Play ${song.title}` : `Download ${song.title}`}
							draggable={canReorder}
							title={canReorder ? 'Drag to change the order' : undefined}
							on:dragstart={(e) => {
								dragFrom = index;
								e.dataTransfer.effectAllowed = 'move';
								e.dataTransfer.setData('text/plain', String(index));
							}}
							on:dragover={(e) => dragOver(e, index)}
							on:drop={drop}
							on:dragend={() => (dragFrom = dropAt = null)}
							class="group relative grid grid-cols-[2rem_minmax(0,1fr)_9rem_2.5rem] items-center gap-4 px-4 h-14 rounded-md cursor-pointer transition-colors {current
								? 'bg-white/[0.08]'
								: 'hover:bg-white/[0.06]'} {dragFrom === index ? 'opacity-40' : ''}"
							on:click={async () => {
								if (downloaded) {
									await playSong(index, song);
								} else if (!download?.isDownloading) {
									await startDownload(song, song.beatmaps[0].id);
								}
							}}
							on:keydown={(e) => {
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
								{#if !downloaded}
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

							<div class="flex items-center gap-3 min-w-0 {downloaded ? '' : 'opacity-50'}">
								<SongCover setId={song.id} title={song.title} class="size-10 rounded" lazy />
								<div class="min-w-0">
									<h3 class="font-semibold truncate {current ? 'text-primary-500' : ''}">
										{song.title}
									</h3>
									<p class="text-sm text-secondary-600 truncate">{song.artist}</p>
								</div>
							</div>

							<span class="text-sm text-secondary-600 truncate">
								{getDateString(song?.created_at || song?.songInfo?.created_at)}
							</span>

							<button
								title={isDownloadedPlaylist ? 'Delete download' : 'Remove from playlist'}
								aria-label={isDownloadedPlaylist
									? `Delete download of ${song.title}`
									: `Remove ${song.title} from playlist`}
								disabled={!isDownloadedPlaylist && !song?.songInfo?.id}
								class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer transition"
								on:click={async (e) => {
									e.stopPropagation();
									if (isDownloadedPlaylist) {
										await deleteSong(song.id);
										songs = songs.filter((s) => s.id != song.id);
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

							{#if download?.isDownloading}
								<div class="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-white/10">
									<div
										class="h-full rounded-full bg-primary-400 transition-all duration-200 ease-out"
										style="width: {download.progress || 0}%;"
									></div>
								</div>
							{/if}
						</div>
						<svelte:fragment slot="menu">
							<QueueMenuItems {song} />
							<Button
								type="ghost"
								class="w-full rounded-md text-sm hover:bg-secondary-400"
								icon="icon-[mingcute--add-circle-line]"
								on:click={() => {
									addPlaylistModal.open = true;
									addPlaylistModal.map = song;
								}}
							>
								Add to playlist
							</Button>
						</svelte:fragment>
					</ContextMenu>
				{/each}
			{/key}
		{/if}

		{#if songs?.length && !visibleSongs.length}
			<p class="mt-10 text-center text-secondary-600">No songs match "{filterText}".</p>
		{/if}

		{#if !isLoadingSongs && !songs?.length}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<span class="icon-[mingcute--music-2-line] size-10 text-secondary-600"></span>
				<p class="text-lg font-semibold">
					{isDownloadedPlaylist ? 'No downloaded songs yet' : 'This playlist is empty'}
				</p>
				<p class="text-sm text-secondary-600">
					{isDownloadedPlaylist
						? 'Download beatmaps on the home page to listen to them here.'
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

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
