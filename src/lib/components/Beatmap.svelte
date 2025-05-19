<script>
	// @ts-nocheck

	import { songQueue } from '$lib/stores/audio';
	import { togglePlayback, currentSong, updateSongQueue } from '$lib/stores/audio';
	import { downloadBeatmap, deleteSong, mapDataStore, formatSongData } from '$lib/stores/data';
	import { onMount } from 'svelte';
	import Button from './Button.svelte';
	import { keyStore } from '$lib/stores/auth';
	import { playlists } from '$lib/stores/playlist';
	import { downloads } from '$lib/stores/data';

	export let map;
	export let isDownloaded = false;

	let isDownloading = false;
	let downloadProgress = 0;
	let downloadProgressInterval;

	let sortedBeatmaps = [];
	let imgNotFound = false;

	$: {
		if ($downloads[map.id]) {
			isDownloading = $downloads[map.id].isDownloading;
			downloadProgress = $downloads[map.id].progress;
		}
	}

	export let playMap = null;

	function startDownload(mapData, mapId) {
		downloads.update((state) => ({
			...state,
			[mapId]: { isDownloading: true, progress: 0 }
		}));

		downloadProgressInterval = setInterval(() => {
			downloads.update((state) => {
				const currentProgress = state[mapId]?.progress || 0;
				const newProgress = Math.min(currentProgress + 5 * Math.random(), 95);
				return {
					...state,
					[mapId]: { ...state[mapId], progress: newProgress }
				};
			});
		}, 200);
		return downloadBeatmap(mapData, mapId, $keyStore.sessionKey, $keyStore.access_token).then(
			async () => {
				clearInterval(downloadProgressInterval);

				downloads.update((state) => ({
					...state,
					[mapId]: { isDownloading: true, progress: 100 }
				}));

				setTimeout(() => {
					downloads.update((state) => {
						const newState = { ...state, [mapId]: { isDownloading: false, progress: 100 } };
						return newState;
					});
				}, 500);
				downloads.update((state) => {
					const newState = { ...state };
					delete newState[map.id];
					return newState;
				});
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

				if ($songQueue.type == 'playlist' && $songQueue.playlistId == -1) {
					await updateSongQueue(
						$songQueue.currentIndex + 1,
						formatSongData($mapDataStore),
						'playlist',
						-1
					);
				}
			}
		);
	}

	function convertTotalSecondsToTime(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = Math.floor(totalSeconds % 60);
		return `~ ${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function getIcon() {
		if (
			$currentSong.song?.id == map.id &&
			$currentSong.isPlaying &&
			$songQueue.type != 'playlist'
		) {
			return 'icon-[fa6-solid--pause]';
		} else {
			return 'icon-[fa6-solid--play]';
		}
	}

	function sortAndColorDifficulties(beatmaps) {
		// Handle both array and object structures
		if (!beatmaps) return [];

		// Convert object structure to array if needed
		let beatmapsArray = Array.isArray(beatmaps) ? beatmaps : Object.values(beatmaps);

		// If empty, return empty array
		if (!beatmapsArray.length) return [];

		return beatmapsArray
			.sort((a, b) => a.difficulty_rating - b.difficulty_rating)
			.map((beatmap) => {
				const rating = beatmap.difficulty_rating;
				let color, name;
				if (rating < 2.0) {
					color = 'bg-blue-500';
				} else if (rating < 2.7) {
					color = 'bg-green-500';
				} else if (rating < 4.0) {
					color = 'bg-yellow-400';
				} else if (rating < 5.3) {
					color = 'bg-red-400';
				} else if (rating < 6.0) {
					color = 'bg-pink-500';
				} else if (rating < 6.5) {
					color = 'bg-purple-600';
				} else if (rating < 7.5) {
					color = 'bg-indigo-700';
				} else if (rating < 8.0) {
					color = 'bg-violet-950';
				} else {
					color = 'bg-stone-950';
				}
				return {
					...beatmap,
					difficultyColor: color,
					difficultyName: name
				};
			});
	}
	onMount(() => {
		sortedBeatmaps = sortAndColorDifficulties(map.beatmaps);
	});
	function handleImageError(event) {
		event.target.src = 'logo.png';
		imgNotFound = true;
	}
</script>

<div class="rounded group hover:ring-2 ring-primary-300 transition duration-100 relative">
	<div class="flex justify-start h-25 relative">
		<img
			src="https://assets.ppy.sh/beatmaps/{map.id}/covers/list.jpg"
			on:error={(e) => handleImageError(e)}
			alt=""
			class="{imgNotFound
				? 'grayscale bg-secondary-200'
				: ''} h-full w-[100px] rounded-s object-cover"
		/>
		<!-- svelte-ignore a11y_consider_explicit_label -->
		<!-- svelte-ignore element_invalid_self_closing_tag -->
		<button
			on:click={() => {
				if ($currentSong.song?.id == map.id && $songQueue.type != 'playlist') {
					togglePlayback();
				} else {
					playMap = map;
					console.log('playMap', playMap);
				}
			}}
			class="{getIcon()} cursor-pointer absolute size-12 text-primary-200/100 left-6.5 top-6.5 opacity-0 transition duration-75 group-hover:opacity-100"
		/>
		{#if $currentSong.song?.id === map.id && $currentSong.isPlaying}
			<span
				class="icon-[svg-spinners--bars-scale-middle] cursor-pointer absolute size-12 text-primary-200/100 left-6.5 top-6.5 group-hover:hidden"
			></span>
		{/if}
		<div class="relative w-full overflow-hidden rounded-r-lg">
			<div
				style="background-image: url('https://assets.ppy.sh/beatmaps/{map.id}/covers/card.jpg');"
				class="absolute inset-0 bg-cover bg-center blur-xs"
			></div>
			<div class="relative z-10 p-2 bg-secondary-100/60 h-full">
				<div class="flex justify-between items-center">
					<div class="font-semibold line-clamp-1 overflow-hidden flex-1 mr-2">{map.title}</div>
					<div class="text-sm text-secondary-600 whitespace-nowrap flex-shrink-0">
						{convertTotalSecondsToTime(map.beatmaps[0].total_length)}
					</div>
				</div>
				<div class="font-semibold line-clamp-1 text-sm">from {map.artist}</div>
				<div class="text-xs text-gray-400 line-clamp-1">Mapped by {map.creator}</div>
				<div class="flex items-center gap-2 mt-1">
					<span
						class="{map.status == 'ranked'
							? 'bg-lime-400'
							: map.status == 'loved'
								? 'bg-fuchsia-500'
								: map.status == 'graveyard'
									? 'bg-gray-600 '
									: map.status == 'pending'
										? 'bg-yellow-400'
										: map.status == 'wip'
											? 'bg-orange-400'
											: map.status == 'qualified'
												? 'bg-blue-500'
												: 'bg-cyan-500'} rounded-full p-0.5 text-[10px] text-stone-800 font-bold uppercase"
					>
						{map.status}
					</span>

					{#if sortedBeatmaps && sortedBeatmaps.length}
						<div class="flex flex-wrap gap-0.5">
							{#each sortedBeatmaps as beatmap (beatmap.id)}
								<div class="{beatmap.difficultyColor} rounded px-1 py-1.5 flex items-center"></div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>

		{#if isDownloading}
			<div class="absolute bottom-0 left-0 right-0 h-1 bg-secondary-200 z-20 rounded">
				<div
					class="h-full bg-lime-400 transition-all duration-200 ease-out rounded"
					style="width: {downloadProgress}%;"
				></div>
			</div>
		{/if}
	</div>
	{#if isDownloaded}
		<div class="absolute right-2 bottom-0 z-10 flex gap-2 items-center">
			<span class=" group-hover:opacity-100 opacity-0 transition duration-100 text-red-400">
				<Button
					type="ghost"
					icon="icon-[fa6-solid--trash-can]"
					on:click={async () => {
						try {
							await deleteSong(map.id);
						} catch (err) {
							console.error('Error in delete handler:', err);
						}
					}}
				/>
			</span>
			<span class=" icon-[fa6-solid--check] text-lime-400 size-4"></span>
		</div>
	{:else if !isDownloading}
		<div class="absolute right-1 bottom-0 z-10 flex gap-2 items-center">
			<span class="group-hover:opacity-100 opacity-0 transition duration-100 text-red-400">
				<Button
					class="text-lg"
					type="ghost"
					icon="icon-[fa6-solid--circle-arrow-down]"
					on:click={async () => {
						await startDownload(map, map.id);
					}}
				/>
			</span>
		</div>
	{/if}
</div>
