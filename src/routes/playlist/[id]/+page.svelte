<script>
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		mapDataStore,
		deleteSong,
		getImageUrl,
		formatSongData,
		isSongDownloaded,
		downloadBeatmap
	} from '$lib/stores/data';
	import { getPlaylistSongs, playlists, removeSongFromPlaylist } from '$lib/stores/playlist';
	import {
		currentSong,
		setSongQueue,
		songQueue,
		stopPlayback,
		togglePlayback,
		updateSongQueue
	} from '$lib/stores/audio';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { keyStore } from '$lib/stores/auth';
	import { writable } from 'svelte/store';

	let lastPlaylistId = null;
	let isLoadingSongs = false;

	// Modify your reactive declarations
	$: playlistId = $page.params?.id;
	$: playlistData = $playlists.find((playlist) => playlist.id == playlistId);
	$: if (
		playlistId !== undefined &&
		playlistData &&
		!isLoadingSongs &&
		lastPlaylistId !== playlistId
	) {
		loadPlaylistSongs();
	}

	const downloadingMap = writable({});
	const downloadProgressMap = writable({});
	const downloadIntervalMap = {};

	// Add this function to handle downloads with progress
	async function startDownload(song, mapId) {
		// Set initial states
		downloadingMap.update((state) => ({ ...state, [song.id]: true }));
		downloadProgressMap.update((state) => ({ ...state, [song.id]: 0 }));

		// Create progress simulation interval
		downloadIntervalMap[song.id] = setInterval(() => {
			downloadProgressMap.update((state) => ({
				...state,
				[song.id]: Math.min((state[song.id] || 0) + 5 * Math.random(), 95)
			}));
		}, 200);

		try {
			// Start actual download
			await downloadBeatmap(song, mapId, $keyStore.sessionKey, $keyStore.access_token);

			// Complete the progress
			downloadProgressMap.update((state) => ({ ...state, [song.id]: 100 }));
			clearInterval(downloadIntervalMap[song.id]);

			// Reset after a delay
			setTimeout(() => {
				downloadingMap.update((state) => ({ ...state, [song.id]: false }));
				downloadProgressMap.update((state) => ({ ...state, [song.id]: 0 }));
				songs = [...songs];
			}, 500);
		} catch (error) {
			console.error(`Failed to download map ${song.id}:`, error);

			// Reset on error
			clearInterval(downloadIntervalMap[song.id]);
			downloadingMap.update((state) => ({ ...state, [song.id]: false }));
			downloadProgressMap.update((state) => ({ ...state, [song.id]: 0 }));
		}
	}

	async function loadPlaylistSongs() {
		isLoadingSongs = true;
		lastPlaylistId = playlistId;
		if (playlistId == -1) {
			songs = formatSongData($mapDataStore);
		} else if (playlistData) {
			songs = [];

			const playlistSongs = await getPlaylistSongs(playlistId);

			// Group songs by beatmapset_id
			const beatmapsetGroups = {};

			// First pass: create the beatmapset groups
			playlistSongs.songs.forEach((song) => {
				const beatmapsetId = song.beatmap.beatmapset.id;

				if (!beatmapsetGroups[beatmapsetId]) {
					// Create a new beatmapset entry with the right structure
					beatmapsetGroups[beatmapsetId] = {
						...song.beatmap.beatmapset,
						songInfo: { ...song },

						beatmaps: []
					};
				}
				// Add this difficulty to the beatmaps array
				beatmapsetGroups[beatmapsetId].beatmaps.push({
					...song.beatmap
				});
			});

			// Convert the grouped data to an array
			songs = Object.values(beatmapsetGroups);
			console.log('Structured songs:', songs);
		}
		isLoadingSongs = false;
	}

	function getDateString(timestamp) {
		// Check if timestamp is in milliseconds (13 digits) or seconds (10 digits)
		const date =
			timestamp.toString().length > 10
				? new Date(timestamp) // Already in milliseconds
				: new Date(timestamp * 1000); // Convert seconds to milliseconds

		const now = new Date();

		// Calculate time differences
		const diffTime = now - date;
		const diffMinutes = Math.floor(diffTime / (1000 * 60));
		const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
		const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

		if (diffMinutes < 60) {
			if (diffMinutes < 1) {
				return 'Just now';
			}
			return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
		} else if (diffDays < 30) {
			if (diffDays === 0) {
				return 'Today';
			} else if (diffDays === 1) {
				return 'Yesterday';
			} else if (diffDays < 7) {
				return `${diffDays} days ago`;
			} else {
				const weeks = Math.floor(diffDays / 7);
				return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
			}
		} else {
			const options = { day: 'numeric', month: 'long', year: 'numeric' };
			return date.toLocaleDateString('de-DE', options);
		}
	}

	async function removeSong(songId) {
		songs = songs.filter((song) => song.songInfo.id != songId);
		const updatedPlaylists = $playlists.map((p) => {
			if (p.id == playlistId) {
				return { ...p, song_amount: Math.max(0, p.song_amount - 1) }; // Ensure count doesn't go negative
			}
			return p;
		});
		console.log(updatedPlaylists);

		playlists.set(updatedPlaylists);

		await removeSongFromPlaylist(playlistId, songId);
	}

	let songs;

	onDestroy(() => {
		songs = null;
	});
</script>

{#if playlistData}
	<div class="flex flex-col">
		<div class="flex items-center gap-4 mb-2">
			<div class="relative">
				<img
					src={playlistId != -1 ? getImageUrl(playlistData.image_path) : '/NoLetterLogo.png'}
					alt=""
					class="xl:size-50 size-40 bg-secondary-200 rounded-md object-cover"
				/>
				{#if playlistId == -1}
					<span
						class="icon-[fa6-solid--circle-arrow-down] text-secondary-600 xl:size-25 size-18 absolute xl:top-15 xl:left-12.5 top-13 left-11"
					></span>
				{/if}
			</div>

			<div class="flex xl:gap-2 gap-1 flex-col">
				<div>{playlistData.public ? 'Public Playlist' : 'Private Playlist'}</div>
				<div class="xl:text-6xl text-3xl font-bold">{playlistData.title}</div>
				<div>
					{playlistData.song_amount} Song{playlistData.song_amount > 1 ? 's' : ''}
				</div>
			</div>
		</div>
		{#if songs?.length}
			{#each songs as song, index}
				{#if !isSongDownloaded(song.id)}
					<button
						class="cursor-pointer group grid grid-cols-[40px_56px_1fr_200px_auto] items-center hover:bg-secondary-200 rounded p-2 relative"
						on:click={async () => {
							await startDownload(song, song.beatmaps[0].id);
						}}
					>
						<!-- Existing content -->
						<div class="relative flex justify-end mr-4">
							<span
								class="icon-[fa6-solid--arrow-down] cursor-pointer absolute size-5 top-0.5 opacity-0 group-hover:opacity-100 text-white"
							></span>
							<div class="group-hover:opacity-0 text-start">
								{index + 1}
							</div>
						</div>
						<!-- Rest of existing content -->
						<img
							src="https://assets.ppy.sh/beatmaps/{song.id}/covers/list.jpg"
							alt={song.title}
							class="size-14 rounded"
						/>
						<div class="flex flex-col text-start ml-4">
							<h3 class="font-semibold">
								{song.title}
							</h3>
							<p class="text-sm text-secondary-600 w-auto">{song.artist}</p>
						</div>
						<div class="flex text-start">
							{getDateString(song?.created_at || song?.songInfo.created_at)}
						</div>
						<div>
							<Button
								class="group-hover:opacity-100 opacity-0 duration-0"
								type="ghost"
								icon={playlistId == -1 ? 'icon-[fa6-solid--trash-can]' : 'icon-[fa6-solid--xmark]'}
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
						<!-- Add progress bar -->
						{#if $downloadingMap[song.id]}
							<div class="absolute bottom-0 left-0 right-0 h-1 bg-secondary-200 z-20 rounded">
								<div
									class="h-full bg-lime-400 transition-all duration-200 ease-out rounded"
									style="width: {$downloadProgressMap[song.id] || 0}%;"
								></div>
							</div>
						{/if}
					</button>
				{:else}
					<button
						class="cursor-pointer group grid grid-cols-[40px_56px_1fr_200px_auto] items-center hover:bg-secondary-200 rounded p-2"
						on:click={async () => {
							if ($songQueue.type !== 'playlist' || $songQueue.playlistId != playlistId) {
								await setSongQueue(index, songs, 'playlist', playlistId);
								return;
							} else if ($songQueue.playlistId == playlistId && $currentSong?.song?.id != song.id) {
								stopPlayback();
								await updateSongQueue(index);
								togglePlayback();
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
									: ''} {$currentSong?.song?.id == song?.id && $songQueue.playlistId == playlistId
									? 'text-primary-200'
									: ''} group-hover:opacity-0 text-start"
							>
								{index + 1}
							</div>
						</div>
						<img
							src="https://assets.ppy.sh/beatmaps/{song.id}/covers/list.jpg"
							alt={song.title}
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
							{getDateString(song?.created_at || song?.songInfo.created_at)}
						</div>
						<div>
							<Button
								class="group-hover:opacity-100 opacity-0 duration-0"
								type="ghost"
								icon={playlistId == -1 ? 'icon-[fa6-solid--trash-can]' : 'icon-[fa6-solid--xmark]'}
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
					</button>
				{/if}
			{/each}
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
{/if}
