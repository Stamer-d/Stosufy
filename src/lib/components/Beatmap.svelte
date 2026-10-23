<script>
	import {
		songQueue,
		togglePlayback,
		currentSong,
		updateSongQueue,
		playbackTime
	} from '#lib/stores/audio.ts';
	import {
		downloadBeatmap,
		deleteSong,
		downloads,
		mapDataStore,
		formatSongData,
		colorFromString
	} from '#lib/stores/data.ts';
	import { beatmapStatus } from '#lib/beatmapStatus.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import MapperLink from './MapperLink.svelte';

	/** @type {import('#lib/types.ts').MapSet} */
	export let map;
	export let isDownloaded = false;
	/** @type {import('#lib/types.ts').MapSet | null} */
	export let playMap = null;

	$: status = beatmapStatus(map.status);
	$: isCurrent = $currentSong.song?.id == map.id && $songQueue.type != 'playlist';
	$: isPlaying = isCurrent && $currentSong.isPlaying;
	$: download = $downloads[map.id];
	// How far the preview is (0–1), as a line under the cover
	$: progress =
		isCurrent && $playbackTime.duration ? $playbackTime.current / $playbackTime.duration : 0;
	$: stars = (map.beatmaps ?? []).map((beatmap) => beatmap.difficulty_rating ?? 0);
	$: lowest = stars.length ? Math.min(...stars) : 0;
	$: highest = stars.length ? Math.max(...stars) : 0;
	let coverFailed = false;

	function startDownload(mapData, mapId) {
		return downloadBeatmap(mapData, mapId, $keyStore.sessionKey, $keyStore.access_token).then(
			async () => {
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

	function playPreview() {
		if (isCurrent) togglePlayback();
		else playMap = map;
	}
</script>

<article class="group min-w-0">
	<div
		class="relative aspect-[20/7] overflow-hidden rounded-xl"
		style="background-color: {colorFromString(map.title ?? '')}"
	>
		{#if !coverFailed}
			<img
				src="https://assets.ppy.sh/beatmaps/{map.id}/covers/card@2x.jpg"
				alt=""
				loading="lazy"
				class="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
				on:error={() => (coverFailed = true)}
			/>
		{:else}
			<div class="size-full grid place-items-center">
				<span class="icon-[mingcute--music-2-fill] size-8 text-white/60"></span>
			</div>
		{/if}
		<div
			class="absolute inset-0 transition-colors duration-300 {isCurrent
				? 'bg-black/25'
				: 'bg-black/0 group-hover:bg-black/25'}"
		></div>

		<button
			aria-label={isPlaying ? `Pause preview of ${map.title}` : `Play preview of ${map.title}`}
			class="absolute bottom-3 right-3 size-10 grid place-items-center rounded-full bg-white text-black shadow-lg shadow-black/30 cursor-pointer transition duration-200 hover:scale-105 {isCurrent
				? 'opacity-100'
				: 'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100'}"
			on:click={playPreview}
		>
			<span
				class="{isPlaying ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
			></span>
		</button>

		{#if isCurrent}
			<div class="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
				<div class="h-full bg-white" style="width: {progress * 100}%"></div>
			</div>
		{/if}
		{#if download?.isDownloading}
			<div class="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
				<div
					class="h-full bg-primary-400 transition-[width] duration-200"
					style="width: {download.progress || 0}%"
				></div>
			</div>
		{/if}
	</div>

	<div class="mt-2.5 flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<h3
				class="font-semibold leading-snug truncate {isCurrent ? 'text-primary-500' : ''}"
				title={map.title}
			>
				{map.title}
			</h3>
			<p class="text-sm text-secondary-600 truncate">{map.artist}</p>
			<p class="mt-1 flex items-center gap-1.5 text-xs text-secondary-600 min-w-0">
				<span class="size-1.5 shrink-0 rounded-full {status.dot}" title={status.label}></span>
				<span class="truncate"
					><MapperLink name={map.creator} id={map.user_id ?? map.creatorId} /></span
				>
				<span class="shrink-0">·</span>
				<span class="shrink-0 tabular-nums"
					>{convertTotalSecondsToTime(map.beatmaps?.[0]?.total_length ?? 0)}</span
				>
				{#if stars.length}
					<span class="shrink-0">·</span>
					<span
						class="shrink-0 tabular-nums"
						title="{stars.length} {stars.length === 1 ? 'difficulty' : 'difficulties'}"
					>
						{lowest.toFixed(1)}{highest - lowest >= 0.05 ? `–${highest.toFixed(1)}` : ''}★
					</span>
				{/if}
			</p>
		</div>

		{#if isDownloaded}
			<div class="flex items-center shrink-0 -mr-1">
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
		{:else if download?.isDownloading}
			<span
				class="h-8 shrink-0 grid place-items-center text-xs font-semibold tabular-nums text-primary-500"
				title="Downloading"
			>
				{Math.round(download.progress || 0)}%
			</span>
		{:else}
			<button
				title="Download"
				aria-label="Download {map.title}"
				class="size-8 shrink-0 -mr-1 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer transition"
				on:click={async () => {
					// Errors are shown as a toast by downloadBeatmap
					await startDownload(map, map.beatmaps[0].id).catch(() => {});
				}}
			>
				<span class="icon-[mingcute--download-2-line] size-5"></span>
			</button>
		{/if}
	</div>
</article>
