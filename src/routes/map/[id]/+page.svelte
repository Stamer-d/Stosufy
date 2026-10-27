<script>
	// A beatmap set: play it, download (or delete) it, like it, put it in a playlist or the
	// queue, and its difficulties. Opened from the title in the songbar.
	import { page } from '$app/state';
	import { open as openUrl } from '@tauri-apps/plugin-shell';
	import {
		fetchBeatmapset,
		downloadBeatmap,
		deleteSong,
		downloads,
		mapDataStore,
		downloadedLibrary,
		colorFromImage,
		colorFromString
	} from '#lib/stores/data.ts';
	import {
		currentSong,
		songQueue,
		setSongQueue,
		togglePlayback,
		queueSong
	} from '#lib/stores/audio.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import { offline } from '#lib/stores/network.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { isFavourite, toggleFavourite } from '#lib/stores/favourites.ts';
	import { searchQuery } from '#lib/stores/search.ts';
	import { goto } from '$app/navigation';
	import { beatmapStatus, difficultyColor } from '#lib/beatmapStatus.ts';
	import { sameSong } from '#lib/tracks.ts';
	import SongCover from '#lib/components/SongCover.svelte';
	import PlayButton from '#lib/components/PlayButton.svelte';
	import MapperLink from '#lib/components/MapperLink.svelte';
	import Triangles from '#lib/components/Triangles.svelte';
	import SongToPlaylistModal from '#lib/components/SongToPlaylistModal.svelte';

	let id = $derived(page.params.id);

	// What's known right away: the playing song or the downloaded set; then osu!'s own data
	let local = $derived(
		($currentSong.song?.id == id ? $currentSong.song : null) ??
			$downloadedLibrary.find((song) => song.id == id) ??
			null
	);
	let fetched = $state(null);
	let failed = $state(false);
	$effect(() => {
		const setId = id;
		fetched = null;
		failed = false;
		if ($offline || !(Number(setId) > 0)) return;
		fetchBeatmapset(setId)
			.then((set) => {
				if (setId === id) fetched = set;
			})
			.catch((error) => {
				console.error('Could not load the beatmap set', setId, error);
				if (setId === id) failed = true;
			});
	});

	// osu!'s data, with the song's own title and artist (sets with several songs)
	let map = $derived(
		fetched
			? {
					...fetched,
					...(local?.track ? { title: local.title, artist: local.artist, track: local.track } : {})
				}
			: local
	);
	// (a downloaded set's `source` marks songs imported from osu!, its song's is `songSource`)
	let songSource = $derived(fetched ? fetched.source : local?.songSource);
	let downloaded = $derived(Object.prototype.hasOwnProperty.call($mapDataStore, String(id)));
	let download = $derived($downloads[id]);
	let status = $derived(map?.status ? beatmapStatus(map.status) : null);
	let difficulties = $derived(
		[...(map?.beatmaps ?? [])].sort((a, b) => a.difficulty_rating - b.difficulty_rating)
	);
	let length = $derived(Math.max(0, ...difficulties.map((beatmap) => beatmap.total_length || 0)));
	let playingThis = $derived(sameSong($currentSong.song, map) && $currentSong.isPlaying);
	let likeable = $derived(Number(map?.beatmaps?.[0]?.id) > 0);
	let liked = $derived(map && likeable ? $isFavourite(map) : false);

	let headerColor = $state(null);
	$effect(() => {
		const setId = id;
		headerColor = colorFromString(map?.title ?? '');
		colorFromImage(`https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg`)
			.then((color) => {
				if (color && setId === id) headerColor = color;
			})
			.catch(() => {});
	});

	let addToPlaylist = $state({ open: false, map: null });

	function play() {
		if (sameSong($currentSong.song, map)) togglePlayback();
		// Like in the search: the full song when it's downloaded or streamed, else the preview
		else setSongQueue(0, [map], 'preview');
	}

	async function startDownload() {
		if ($offline) {
			showToast(
				"You're offline: songs download once you're connected",
				'icon-[mingcute--wifi-off-line]'
			);
			return;
		}
		// Errors are shown as a toast by downloadBeatmap
		await downloadBeatmap(
			map,
			map.beatmaps[0].id,
			$keyStore.sessionKey,
			$keyStore.access_token
		).catch(() => {});
	}

	async function addToQueue() {
		await queueSong(map);
		showToast(`Added "${map.title}" to the queue`, 'icon-[mingcute--playlist-2-line]');
	}

	function searchArtist() {
		searchQuery.set(map.artist);
		goto('/search');
	}

	function formatLength(seconds) {
		return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
	}

	const ACTION =
		'size-10 grid place-items-center rounded-full cursor-pointer transition text-white/60 hover:text-white';
</script>

{#if map}
	<div
		class="transition-colors duration-500"
		style="background: linear-gradient(to bottom, {headerColor ??
			'transparent'} 0, transparent 26rem)"
	>
		<header class="relative flex items-end gap-6 px-6 pt-14 pb-6 overflow-hidden">
			<Triangles count={16} seed={Number(id) || 7} />
			<SongCover
				setId={map.id}
				track={map.track}
				title={map.title}
				class="relative size-44 xl:size-52 rounded-md shadow-2xl shadow-black/50"
			/>
			<div class="relative min-w-0 pb-1">
				<p class="flex items-center gap-2 text-sm font-semibold">
					Beatmap
					{#if status}
						<span class="px-1.5 py-0.5 rounded text-[11px] font-bold leading-none {status.badge}">
							{status.label}
						</span>
					{/if}
				</p>
				<h1
					class="mt-1 text-4xl xl:text-6xl font-extrabold tracking-tight leading-[1.05] line-clamp-2 break-words"
				>
					{map.title}
				</h1>
				<p class="mt-3 text-sm">
					<button class="font-bold hover:underline cursor-pointer" onclick={searchArtist}>
						{map.artist}
					</button>
					<span class="text-white/70">
						· mapped by <MapperLink
							name={map.creator}
							id={map.user_id ?? map.creatorId}
							class="font-semibold text-white"
						/>
						{#if length}· {formatLength(length)}{/if}
						{#if map.bpm}· {Math.round(map.bpm)} BPM{/if}
						{#if difficulties.length}
							· {difficulties.length}
							{difficulties.length === 1 ? 'difficulty' : 'difficulties'}
						{/if}
					</span>
				</p>
				{#if songSource}
					<p class="mt-1 text-sm text-white/70 truncate">From {songSource}</p>
				{/if}
			</div>
		</header>

		<div class="flex items-center gap-5 px-6 py-4 bg-black/10">
			<PlayButton playing={playingThis} onclick={play} />

			{#if likeable}
				<button
					title={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					aria-pressed={liked}
					class="{ACTION} {liked ? 'text-primary-500! hover:text-primary-400!' : ''}"
					onclick={() => toggleFavourite(map)}
				>
					<span
						class="{liked ? 'icon-[mingcute--heart-fill]' : 'icon-[mingcute--heart-line]'} size-7"
					></span>
				</button>
			{/if}

			{#if download?.isDownloading}
				<div class="relative size-10" title="Downloading {Math.round(download.progress || 0)}%">
					<svg class="size-10 -rotate-90" viewBox="0 0 36 36">
						<circle cx="18" cy="18" r="15.9" fill="none" stroke-width="3" class="stroke-white/15" />
						<circle
							cx="18"
							cy="18"
							r="15.9"
							fill="none"
							stroke-width="3"
							stroke-linecap="round"
							stroke-dasharray="{download.progress || 0}, 100"
							class="stroke-primary-400 transition-all duration-300 ease-out"
						/>
					</svg>
				</div>
			{:else if downloaded}
				<span class="size-10 grid place-items-center text-primary-500" title="Downloaded">
					<span class="icon-[mingcute--check-circle-fill] size-7"></span>
				</span>
				<button
					title="Delete download"
					aria-label="Delete download"
					class="{ACTION} hover:text-red-400!"
					onclick={() => deleteSong(id).catch((error) => console.error(error))}
				>
					<span class="icon-[mingcute--delete-2-line] size-6"></span>
				</button>
			{:else if map.beatmaps?.length}
				<button title="Download" aria-label="Download" class={ACTION} onclick={startDownload}>
					<span class="icon-[mingcute--download-2-line] size-7"></span>
				</button>
			{/if}

			<button
				title="Add to playlist"
				aria-label="Add to playlist"
				class={ACTION}
				onclick={() => (addToPlaylist = { open: true, map })}
			>
				<span class="icon-[mingcute--add-circle-line] size-7"></span>
			</button>
			<button title="Add to queue" aria-label="Add to queue" class={ACTION} onclick={addToQueue}>
				<span class="icon-[mingcute--playlist-2-line] size-7"></span>
			</button>
			{#if Number(id) > 0}
				<button
					title="Open on osu!"
					aria-label="Open on osu!"
					class={ACTION}
					onclick={() => openUrl(`https://osu.ppy.sh/beatmapsets/${id}`)}
				>
					<span class="icon-[mingcute--external-link-line] size-6"></span>
				</button>
			{/if}
		</div>
	</div>

	<div class="px-6 pb-10">
		{#if difficulties.length}
			<h2 class="mt-2 mb-2 text-sm font-semibold text-secondary-600">Difficulties</h2>
			<ul class="flex flex-col">
				{#each difficulties as beatmap (beatmap.id)}
					<li class="flex items-center gap-3 px-4 h-11 rounded-md hover:bg-white/[0.06]">
						<span
							class="size-3 shrink-0 rounded-full ring-1 ring-black/30"
							style="background-color: {difficultyColor(beatmap.difficulty_rating)}"
						></span>
						<span class="flex-1 min-w-0 truncate font-semibold">{beatmap.version}</span>
						{#if beatmap.mode && beatmap.mode !== 'osu'}
							<span class="text-xs text-secondary-600">{beatmap.mode}</span>
						{/if}
						<span class="w-16 text-end text-sm text-secondary-600 tabular-nums">
							{beatmap.difficulty_rating?.toFixed(2)}★
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else if failed || $offline}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--music-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">
			{$offline ? "You're offline" : "This beatmap couldn't be loaded"}
		</p>
		<p class="text-secondary-600 max-w-md">
			{$offline
				? "Beatmaps that aren't downloaded show up again once you're connected."
				: "It may have been deleted from osu!, or osu! didn't answer. Try again in a moment."}
		</p>
	</div>
{:else}
	<div class="w-full mt-16 text-center">
		<span class="size-16 icon-[svg-spinners--ring-resize] text-primary-300"></span>
	</div>
{/if}

<SongToPlaylistModal bind:open={addToPlaylist.open} bind:map={addToPlaylist.map} />
