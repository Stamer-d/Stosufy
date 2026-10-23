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
		colorFromString,
		colorFromImage
	} from '#lib/stores/data.ts';
	import { beatmapStatus, difficultyColor } from '#lib/beatmapStatus.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import MapperLink from './MapperLink.svelte';

	/** @type {import('#lib/types.ts').MapSet} */
	export let map;
	export let isDownloaded = false;
	/** @type {import('#lib/types.ts').MapSet | null} */
	export let playMap = null;

	$: sortedBeatmaps = sortAndColorDifficulties(map.beatmaps);
	$: status = beatmapStatus(map.status);
	$: isCurrent = $currentSong.song?.id == map.id && $songQueue.type != 'playlist';
	$: isPlaying = isCurrent && $currentSong.isPlaying;
	$: download = $downloads[map.id];
	// How far the preview is (0–1), for the ring around the play button
	$: progress =
		isCurrent && $playbackTime.duration ? $playbackTime.current / $playbackTime.duration : 0;
	let coverFailed = false;
	let avatarFailed = false;

	// The card takes the colour of its cover (a small copy of it, measured once)
	let tint = colorFromString(map.title ?? '');
	$: colorFromImage(`https://assets.ppy.sh/beatmaps/${map.id}/covers/list.jpg`).then((color) => {
		if (color) tint = color;
	});

	$: stars = sortedBeatmaps.map((beatmap) => beatmap.difficulty_rating ?? 0);
	$: lowest = stars.length ? Math.min(...stars) : 0;
	$: highest = stars.length ? Math.max(...stars) : 0;

	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

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

	function playPreview() {
		if (isCurrent) togglePlayback();
		else playMap = map;
	}
</script>

<article
	class="@container group relative rounded-xl overflow-hidden bg-secondary-200 ring-1 transition duration-300 ease-out hover:-translate-y-1 {isCurrent
		? 'ring-2'
		: 'ring-white/5 hover:ring-white/10'}"
	style="--tint: {tint}; {isCurrent
		? 'box-shadow: 0 14px 40px -14px var(--tint); --tw-ring-color: color-mix(in srgb, var(--tint) 70%, white)'
		: ''}"
>
	<!-- The glow of its colour on hover -->
	<div
		class="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
		style="box-shadow: inset 0 -80px 80px -60px color-mix(in srgb, var(--tint) 55%, transparent)"
	></div>

	<div
		class="relative aspect-[400/150] overflow-hidden"
		style="background-color: {colorFromString(map.title ?? '')}"
	>
		{#if !coverFailed}
			<img
				src="https://assets.ppy.sh/beatmaps/{map.id}/covers/card@2x.jpg"
				alt=""
				loading="lazy"
				class="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
				on:error={() => (coverFailed = true)}
			/>
		{:else}
			<div class="size-full grid place-items-center">
				<span class="icon-[mingcute--music-2-fill] size-8 text-white/60"></span>
			</div>
		{/if}
		<!-- Dark at the bottom, for the title -->
		<div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"></div>

		<div class="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between gap-2">
			<span
				class="flex items-center gap-1.5 h-6 px-2 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10 text-[11px] font-bold"
			>
				<span class="size-1.5 rounded-full {status.dot}"></span>
				{status.label}
			</span>
			<span class="flex items-center gap-1">
				{#if map.video}
					<span
						class="h-6 w-7 grid place-items-center rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10"
						title="Has a video"
					>
						<span class="icon-[mingcute--video-line] size-3.5"></span>
					</span>
				{/if}
				{#if map.storyboard}
					<span
						class="h-6 w-7 grid place-items-center rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10"
						title="Has a storyboard"
					>
						<span class="icon-[mingcute--pic-line] size-3.5"></span>
					</span>
				{/if}
				<span
					class="h-6 px-2 grid place-items-center rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10 text-[11px] font-semibold tabular-nums"
				>
					{convertTotalSecondsToTime(map.beatmaps?.[0]?.total_length ?? 0)}
				</span>
			</span>
		</div>

		<!-- Title and artist on the cover -->
		<div class="absolute left-3 right-16 bottom-2.5 min-w-0">
			{#if map.source}
				<p
					class="text-[11px] font-bold uppercase tracking-wide text-white/60 truncate"
					title={map.source}
				>
					{map.source}
				</p>
			{/if}
			<h3
				class="flex items-center gap-1.5 text-lg font-extrabold leading-tight drop-shadow-md {isCurrent
					? 'text-white'
					: ''}"
			>
				{#if isPlaying}
					<span
						class="icon-[svg-spinners--bars-scale-middle] size-4 shrink-0"
						style="color: var(--tint); filter: brightness(1.8) saturate(1.4)"
					></span>
				{/if}
				<span class="truncate">{map.title}</span>
			</h3>
			<p class="text-sm text-white/75 truncate drop-shadow">{map.artist}</p>
		</div>

		<!-- Play: always there; a ring shows how far the preview is -->
		<button
			aria-label={isPlaying ? `Pause preview of ${map.title}` : `Play preview of ${map.title}`}
			class="absolute bottom-2.5 right-2.5 size-11 grid place-items-center rounded-full cursor-pointer transition duration-200 hover:scale-110 {isCurrent
				? 'bg-primary-300 text-white shadow-lg shadow-black/40'
				: 'bg-black/40 backdrop-blur-md ring-1 ring-white/20 text-white group-hover:bg-primary-300 group-hover:ring-0 group-hover:shadow-lg group-hover:shadow-black/40'}"
			on:click={playPreview}
		>
			{#if isCurrent}
				<span
					class="absolute -inset-1 rounded-full"
					style="background: conic-gradient(white {progress *
						360}deg, rgb(255 255 255 / 0.15) 0); mask: radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 2.5px))"
				></span>
			{/if}
			<span
				class="{isPlaying ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
			></span>
		</button>
	</div>

	<!-- Who mapped it, how popular it is, its difficulties, the download -->
	<div
		class="relative px-3 py-2.5 flex items-center gap-3"
		style="background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 22%, transparent), transparent)"
	>
		<div class="min-w-0 flex-1 flex flex-col gap-1.5">
			<div class="flex items-center gap-2 min-w-0 text-xs text-secondary-600">
				{#if map.user_id && !avatarFailed}
					<img
						src="https://a.ppy.sh/{map.user_id}"
						alt=""
						loading="lazy"
						class="size-5 rounded-full shrink-0 bg-white/10"
						on:error={() => (avatarFailed = true)}
					/>
				{/if}
				<span class="truncate"
					>by <MapperLink name={map.creator} id={map.user_id ?? map.creatorId} /></span
				>
			</div>
			<div
				class="flex items-center gap-3 text-xs text-secondary-600 tabular-nums whitespace-nowrap"
			>
				{#if map.play_count != null}
					<span class="flex items-center gap-1" title="{map.play_count.toLocaleString()} plays">
						<span class="icon-[mingcute--play-circle-line] size-3.5"></span>
						{compact.format(map.play_count)}
					</span>
				{/if}
				{#if map.favourite_count != null}
					<span
						class="flex items-center gap-1"
						title="{map.favourite_count.toLocaleString()} favourites"
					>
						<span class="icon-[mingcute--heart-line] size-3.5"></span>
						{compact.format(map.favourite_count)}
					</span>
				{/if}
				{#if map.bpm}
					<span class="hidden @[24rem]:flex items-center gap-1" title="Tempo">
						<span class="icon-[mingcute--music-2-line] size-3.5"></span>
						{Math.round(map.bpm)} BPM
					</span>
				{/if}
				{#if sortedBeatmaps.length}
					<span
						class="flex items-center gap-1.5 h-5 pl-1.5 pr-2 rounded-full bg-black/30 ring-1 ring-white/5"
						title={sortedBeatmaps
							.map((b) => `${b.version} (${b.difficulty_rating?.toFixed(2)}★)`)
							.join('\n')}
					>
						<span class="flex items-center gap-0.5">
							{#each sortedBeatmaps.slice(0, 6) as beatmap (beatmap.id)}
								<span
									class="size-1.5 rounded-full"
									style="background-color: {beatmap.difficultyColor}"
								></span>
							{/each}
						</span>
						<span>
							{lowest.toFixed(1)}{highest - lowest >= 0.05 ? `–${highest.toFixed(1)}` : ''}★
						</span>
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
				class="size-9 shrink-0 grid place-items-center rounded-full bg-white/5 text-secondary-600 ring-1 ring-white/5 hover:text-white hover:bg-primary-300 hover:ring-0 cursor-pointer transition"
				on:click={async () => {
					// Errors are shown as a toast by downloadBeatmap
					await startDownload(map, map.beatmaps[0].id).catch(() => {});
				}}
			>
				<span class="icon-[mingcute--download-2-line] size-[18px]"></span>
			</button>
		{:else}
			<!-- How far the download is, as a ring -->
			<span
				class="relative size-9 shrink-0 grid place-items-center text-[10px] font-bold tabular-nums text-primary-500"
				title="Downloading"
			>
				<span
					class="absolute inset-0 rounded-full"
					style="background: conic-gradient(var(--color-primary-400) {(download.progress || 0) *
						3.6}deg, rgb(255 255 255 / 0.08) 0); mask: radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 2.5px))"
				></span>
				{Math.round(download.progress || 0)}
			</span>
		{/if}
	</div>
</article>
