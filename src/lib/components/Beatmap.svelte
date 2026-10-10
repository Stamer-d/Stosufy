<script>
	import { songQueue, togglePlayback, currentSong, updateSongQueue } from '#lib/stores/audio.ts';
	import {
		downloadBeatmap,
		deleteSong,
		downloads,
		mapDataStore,
		formatSongData,
		colorFromString
	} from '#lib/stores/data.ts';
	import { beatmapStatus, difficultyColor } from '#lib/beatmapStatus.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import { playlists } from '#lib/stores/playlist.ts';

	/** @type {import('#lib/types.ts').MapSet} */
	export let map;
	export let isDownloaded = false;
	/** @type {import('#lib/types.ts').MapSet | null} */
	export let playMap = null;

	$: sortedBeatmaps = sortAndColorDifficulties(map.beatmaps);
	$: status = beatmapStatus(map.status);
	$: isPlaying =
		$currentSong.song?.id == map.id && $currentSong.isPlaying && $songQueue.type != 'playlist';
	$: download = $downloads[map.id];
	let coverFailed = false;

	function startDownload(mapData, mapId) {
		return downloadBeatmap(mapData, mapId, $keyStore.sessionKey, $keyStore.access_token).then(
			async () => {
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
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function sortAndColorDifficulties(beatmaps) {
		if (!beatmaps) return [];
		const beatmapsArray = Array.isArray(beatmaps) ? [...beatmaps] : Object.values(beatmaps);
		return beatmapsArray
			.sort((a, b) => a.difficulty_rating - b.difficulty_rating)
			.map((beatmap) => ({
				...beatmap,
				difficultyColor: difficultyColor(beatmap.difficulty_rating)
			}));
	}
</script>

<article
	class="group relative rounded-lg overflow-hidden bg-secondary-200 hover:bg-secondary-300 transition-colors"
>
	<div
		class="relative aspect-[400/140] overflow-hidden"
		style="background-color: {colorFromString(map.title)}"
	>
		{#if !coverFailed}
			<img
				src="https://assets.ppy.sh/beatmaps/{map.id}/covers/card@2x.jpg"
				alt=""
				loading="lazy"
				class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
				on:error={() => (coverFailed = true)}
			/>
		{:else}
			<div class="size-full grid place-items-center">
				<span class="icon-[mingcute--music-2-fill] size-8 text-white/60"></span>
			</div>
		{/if}

		<div class="absolute top-2 left-2 right-2 flex items-start justify-between gap-2">
			<span class="px-1.5 py-0.5 rounded text-[11px] font-bold leading-none {status.badge}">
				{status.label}
			</span>
			<span
				class="px-1.5 py-0.5 rounded bg-black/60 text-[11px] font-semibold leading-none tabular-nums"
			>
				{convertTotalSecondsToTime(map.beatmaps[0].total_length)}
			</span>
		</div>

		<button
			aria-label={isPlaying ? `Pause preview of ${map.title}` : `Play preview of ${map.title}`}
			class="absolute bottom-2 right-2 size-10 grid place-items-center rounded-full bg-primary-300 text-white ring-2 ring-white shadow-lg shadow-black/40 cursor-pointer transition duration-200 hover:scale-105 hover:bg-primary-400 {isPlaying
				? 'opacity-100 translate-y-0'
				: 'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100'}"
			on:click={() => {
				if ($currentSong.song?.id == map.id && $songQueue.type != 'playlist') {
					togglePlayback();
				} else {
					playMap = map;
				}
			}}
		>
			<span
				class="{isPlaying ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
			></span>
		</button>
	</div>

	<div class="p-3 flex gap-3 items-end">
		<div class="min-w-0 flex-1">
			<h3 class="font-semibold truncate {isPlaying ? 'text-primary-500' : ''}">{map.title}</h3>
			<p class="text-sm text-secondary-600 truncate">{map.artist}</p>
			<div class="mt-2 flex items-center gap-2 text-xs text-secondary-600 min-w-0">
				<span class="truncate">by {map.creator}</span>
				{#if sortedBeatmaps.length}
					<span
						class="flex items-center gap-0.5 shrink-0"
						title="{sortedBeatmaps.length} difficulties"
					>
						{#each sortedBeatmaps.slice(0, 8) as beatmap (beatmap.id)}
							<span
								class="w-1.5 h-3 rounded-full ring-1 ring-black/30"
								style="background-color: {beatmap.difficultyColor}"
								title="{beatmap.version} ({beatmap.difficulty_rating?.toFixed(2)}★)"
							></span>
						{/each}
						{#if sortedBeatmaps.length > 8}
							<span class="ml-0.5">+{sortedBeatmaps.length - 8}</span>
						{/if}
					</span>
				{/if}
			</div>
		</div>

		{#if isDownloaded}
			<div class="flex items-center shrink-0">
				<button
					title="Delete download"
					aria-label="Delete download of {map.title}"
					class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer transition"
					on:click={async () => {
						try {
							await deleteSong(map.id);
						} catch (err) {
							console.error('Error in delete handler:', err);
						}
					}}
				>
					<span class="icon-[mingcute--delete-2-line] size-[18px]"></span>
				</button>
				<span class="size-8 grid place-items-center text-primary-500" title="Downloaded">
					<span class="icon-[mingcute--check-circle-fill] size-5"></span>
				</span>
			</div>
		{:else if !download?.isDownloading}
			<button
				title="Download"
				aria-label="Download {map.title}"
				class="size-8 shrink-0 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-400 cursor-pointer transition"
				on:click={async () => {
					await startDownload(map, map.beatmaps[0].id);
				}}
			>
				<span class="icon-[mingcute--download-2-line] size-5"></span>
			</button>
		{:else}
			<span
				class="size-8 shrink-0 grid place-items-center text-xs font-semibold tabular-nums text-primary-500"
			>
				{Math.round(download.progress || 0)}%
			</span>
		{/if}
	</div>

	{#if download?.isDownloading}
		<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-secondary-400">
			<div
				class="h-full bg-primary-400 transition-all duration-200 ease-out"
				style="width: {download.progress || 0}%;"
			></div>
		</div>
	{/if}
</article>
