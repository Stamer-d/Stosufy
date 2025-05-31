<script>
	import Button from '$lib/components/Button.svelte';
	import {
		deleteSong,
		getImageUrl,
		isSongDownloaded,
		downloadBeatmap,
		handleImageError
	} from '$lib/stores/data';
	import {
		getPlaylistSongs,
		playlistLoadingStatus,
		playlists,
		playlistSongsCache,
		removeSongFromPlaylist
	} from '$lib/stores/playlist';
	import {
		currentSong,
		setSongQueue,
		songQueue,
		stopPlayback,
		togglePlayback,
		updateSongQueue
	} from '$lib/stores/audio';
	import { downloads } from '$lib/stores/data';
	import { page } from '$app/stores';
	import { keyStore } from '$lib/stores/auth';
	import ContextMenu from '$lib/components/ContextMenu.svelte';
	import SongToPlaylistModal from '$lib/components/SongToPlaylistModal.svelte';
	import { userSettings } from '$lib/stores/user';

	$: playlistId = $page.params?.id;
	$: playlistData = $playlists.find((playlist) => playlist.id == playlistId);
	$: isLoadingSongs = $playlistLoadingStatus[playlistId] || false;
	$: songs = $playlistSongsCache[playlistId]?.songs || [];

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
			playlists.update((allPlaylists) => {
				return allPlaylists.map((playlist) => {
					if (playlist.id == -1) {
						return {
							...playlist,
							song_amount: playlist.song_amount + 1
						};
					}
					return playlist;
				});
			});
		} catch (error) {
			console.error(`Failed to download map ${song.id}:`, error);
		}
	}

	function getDateString(timestamp) {
		const date =
			timestamp.toString().length > 10 ? new Date(timestamp) : new Date(timestamp * 1000);

		const now = new Date();
		const diffMs = now - date;

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
	<div class="flex flex-col gap-3">
		<div class="flex items-center gap-4 mb-2">
			<div class="relative shrink-0">
				<img
					src={playlistId != -1 ? getImageUrl(playlistData.image_path) : '/NoLetterLogo.png'}
					alt=""
					class="xl:size-50 size-40 bg-secondary-200 rounded-md object-cover"
				/>
				{#if playlistId == -1}
					<span
						class="icon-[fa6-solid--circle-arrow-down] text-white xl:size-25 size-18 absolute xl:top-15 xl:left-12.5 top-13 left-11"
					></span>
				{/if}
			</div>

			<div class="flex xl:gap-2 gap-1 flex-col">
				<div>{playlistData.public ? 'Public Playlist' : 'Private Playlist'}</div>
				<div class="xl:text-6xl text-3xl font-bold">{playlistData.title}</div>
				<div class=" line-clamp-1 w-full text-secondary-600 font-semibold">
					{playlistData.description}
				</div>
				<div>
					{playlistData.song_amount} Song{playlistData.song_amount > 1 ? 's' : ''}
				</div>
			</div>
		</div>
		<div class="flex items-center gap-1">
			{#key [$songQueue, $currentSong, playlistId]}
				<Button
					type="ghost"
					class="{!songs.length
						? 'text-secondary-500'
						: 'text-primary-200 hover:text-primary-300 active:text-primary-400'} text-6xl"
					disabled={!songs.length}
					icon={$songQueue.playlistId == playlistId && $currentSong?.isPlaying
						? 'icon-[fa6-solid--circle-pause]'
						: 'icon-[fa6-solid--circle-play]'}
					on:click={async () => {
						if ($songQueue?.playlistId == playlistId) {
							togglePlayback();
						} else if (songs.length > 0) {
							await setSongQueue(0, songs, 'playlist', playlistId);
						}
					}}
				/>
			{/key}
			{#key getNotDownloadedSongs().length}
				{#if playlistId != -1}
					{#if downloadingAll.downloading}
						<div class="relative w-12 h-12">
							<!-- Gray background circle -->
							<svg class="w-12 h-12" viewBox="0 0 36 36">
								<path
									class="text-secondary-300"
									stroke="currentColor"
									stroke-width="3"
									fill="none"
									d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
								/>
								<!-- Progress circle -->
								<path
									class="text-primary-300 transition-all duration-300 ease-out"
									stroke="currentColor"
									stroke-width="3"
									fill="none"
									stroke-dasharray="{downloadingAll.progress}, 100"
									stroke-linecap="round"
									d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
								/>
							</svg>
							<button
								on:click={() => {
									downloadingAll.abort = true;
									downloadingAll.downloading = false;
								}}
								class="cursor-pointer absolute inset-0 flex text-secondary-500 z-10 hover:text-secondary-600 items-center justify-center text-xs font-semibold rounded-full transition-colors"
							>
								<span class="icon-[fa6-solid--stop] size-5"></span>
							</button>
						</div>
					{:else}
						<Button
							type="ghost"
							class="text-3xl"
							icon="icon-[fa6-solid--circle-arrow-down] {getNotDownloadedSongs().length > 0
								? ''
								: 'text-primary-400'} "
							on:click={async () => {
								await downloadAllSongs();
							}}
						/>
					{/if}
				{/if}
			{/key}
		</div>
		<div class="flex flex-col">
			{#if songs?.length}
				{#key playlistId}
					{#each songs as song, index (song.id)}
						<!-- REMOVE IF AND CONTENT COMPLETLY AND MAKE ONE BUTTON OUT OF IT-->
						{#if !isSongDownloaded(song.id)}
							<button
								class="cursor-pointer group grid grid-cols-[40px_56px_1fr_200px_auto] items-center hover:bg-secondary-300 rounded p-2 relative"
								on:click={async () => {
									if ($downloads[song.id]?.isDownloading) {
										return;
									}
									await startDownload(song, song.beatmaps[0].id);
								}}
							>
								<div class="relative flex justify-end mr-4">
									<span
										class="icon-[fa6-solid--arrow-down] cursor-pointer absolute size-5 top-0.5 opacity-0 group-hover:opacity-100 text-white"
									></span>
									<div class="group-hover:opacity-0 text-start">
										{index + 1}
									</div>
								</div>
								<img
									src="https://assets.ppy.sh/beatmaps/{song.id}/covers/list.jpg"
									alt={song.title}
									on:error={handleImageError}
									class="size-14 rounded"
								/>
								<div class="flex flex-col text-start ml-4">
									<h3 class="font-semibold">
										{song.title}
									</h3>
									<p class="text-sm text-secondary-600 w-auto">{song.artist}</p>
								</div>

								<div class="flex text-start">
									{getDateString(song?.created_at || song?.songInfo?.created_at)}
								</div>
								<div>
									<Button
										class="group-hover:opacity-100 opacity-0 duration-0"
										type="ghost"
										disabled={playlistId != -1 && !song?.songInfo?.id}
										icon={playlistId == -1
											? 'icon-[fa6-solid--trash-can]'
											: 'icon-[fa6-solid--xmark]'}
										on:click={async (e) => {
											event.stopPropagation();
											if (playlistId == -1) {
												await deleteSong(song.id);
											} else {
												removeSong(song.songInfo.id);
											}
										}}
									/>
								</div>
								{#if $downloads[song.id]?.isDownloading}
									<div class="absolute bottom-0 left-0 right-0 h-1 bg-secondary-400 z-20 rounded">
										<div
											class="h-full bg-lime-400 transition-all duration-200 ease-out rounded"
											style="width: {$downloads[song.id]?.progress || 0}%;"
										></div>
									</div>
								{/if}
							</button>
						{:else}
							<ContextMenu disabled={playlistId != -1 ? true : false}>
								<button
									class="cursor-pointer w-full group grid grid-cols-[40px_56px_1fr_200px_auto] items-center hover:bg-secondary-300 rounded p-2"
									on:click={async () => {
										if ($songQueue.type !== 'playlist' || $songQueue.playlistId != playlistId) {
											await setSongQueue(index, songs, 'playlist', playlistId);
											return;
										} else if (
											$songQueue.playlistId == playlistId &&
											$currentSong?.song?.id != song.id
										) {
											if ($userSettings.settings.shuffle) {
												await setSongQueue(index, songs, 'playlist', playlistId);
											} else {
												stopPlayback();
												await updateSongQueue(index, null, null, null);
												togglePlayback();
											}
											return;
										}
										if ($currentSong?.song?.id == song.id) {
											togglePlayback();
											return;
										}
									}}
								>
									<div class="relative flex justify-end mr-4">
										{#if $currentSong?.song?.id == song.id && $currentSong?.isPlaying && $songQueue.type == 'playlist' && $songQueue.playlistId == playlistId}
											<span
												class="icon-[svg-spinners--bars-scale-middle] cursor-pointer absolute size-5 top-0.5 group-hover:opacity-0 {$currentSong
													?.song?.id == song?.id
													? 'text-primary-200'
													: ''}"
											></span>
											<span
												class="icon-[fa6-solid--pause] cursor-pointer absolute size-5 top-0.5 opacity-0 group-hover:opacity-100 text-white"
											></span>
										{:else}
											<span
												class=" icon-[fa6-solid--play] cursor-pointer absolute size-5 top-0.5 opacity-0 group-hover:opacity-100 text-white"
											></span>
										{/if}
										<div
											class="{$currentSong?.song?.id == song.id && $currentSong?.isPlaying
												? 'opacity-0'
												: ''} {$currentSong?.song?.id == song?.id &&
											$songQueue.playlistId == playlistId
												? 'text-primary-200'
												: ''} group-hover:opacity-0 text-start"
										>
											{index + 1}
										</div>
									</div>
									<img
										src="https://assets.ppy.sh/beatmaps/{song.id}/covers/list.jpg"
										alt={song.title}
										on:error={handleImageError}
										class="size-14 rounded"
									/>
									<div class="flex flex-col text-start ml-4">
										<h3
											class="font-semibold {$currentSong?.song?.id == song?.id &&
											$songQueue.playlistId == playlistId
												? 'text-primary-200'
												: ''}"
										>
											{song.title}
										</h3>
										<p class="text-sm text-secondary-600 w-auto">{song.artist}</p>
									</div>
									<div class="flex text-start">
										{getDateString(song?.created_at || song?.songInfo?.created_at)}
									</div>
									<div>
										<Button
											class="group-hover:opacity-100 opacity-0 duration-0"
											type="ghost"
											disabled={playlistId != -1 && !song?.songInfo?.id}
											icon={playlistId == -1
												? 'icon-[fa6-solid--trash-can]'
												: 'icon-[fa6-solid--xmark]'}
											on:click={async (e) => {
												event.stopPropagation();
												if (playlistId == -1) {
													await deleteSong(song.id);
													songs = songs.filter((s) => s.id != song.id);
												} else {
													removeSong(song.songInfo.id);
												}
											}}
										/>
									</div>
								</button>
								<svelte:fragment slot="menu">
									<Button
										type="ghost"
										class="w-full py-3 rounded-sm hover:bg-secondary-400"
										icon="icon-[fa6-solid--plus]"
										on:click={() => {
											addPlaylistModal.open = true;
											addPlaylistModal.map = song;
										}}
									>
										Add to Playlist
									</Button>
								</svelte:fragment>
							</ContextMenu>
						{/if}
					{/each}
				{/key}
			{/if}
			{#if !isLoadingSongs && !songs?.length}
				<div class="text-xl text-center text-secondary-600">No Songs found</div>
				<div class="text-xl text-center text-secondary-600">Start adding Songs to the playlist</div>
			{/if}
			{#if isLoadingSongs && !songs.length}
				<div class="w-full text-center mt-30">
					<span class="size-20 icon-[svg-spinners--ring-resize] text-primary-300"></span>
				</div>
			{/if}
		</div>
	</div>
{/if}

<SongToPlaylistModal bind:open={addPlaylistModal.open} bind:map={addPlaylistModal.map} />
