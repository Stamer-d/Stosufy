<script>
	import SongCover from './SongCover.svelte';
	import { onDestroy } from 'svelte';
	import {
		togglePlayback,
		skipForward,
		songQueue,
		currentSong,
		skipBackward,
		stopPlayback,
		shuffleQueue,
		cycleRepeatMode,
		hasNext,
		upNext,
		queuePanelOpen,
		playbackTime,
		focusMode
	} from '#lib/stores/audio.ts';
	import Range from './Range.svelte';
	import { toggleLyrics } from '#lib/stores/keybinds.ts';
	import HitsoundMenu from './HitsoundMenu.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { searchQuery } from '#lib/stores/search.ts';
	import { updateUserSettings, userSettings, updateAppearance } from '#lib/stores/user.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { setVolume, toggleMute, DEFAULT_VOLUME, MAX_VOLUME } from '#lib/stores/mixer.ts';
	import ModSelect from './ModSelect.svelte';
	import SleepTimer from './SleepTimer.svelte';
	import { isFavourite, toggleFavourite } from '#lib/stores/favourites.ts';

	// The position, from the player (twice a second; it also saves it for the next start)
	let currentTime = $derived($playbackTime.current);
	let duration = $derived($playbackTime.duration);
	// The volume lives in the settings (see mixer.ts); muted shows as 0
	let muted = $derived($userSettings.settings?.muted ?? false);
	let volume = $derived(muted ? 0 : ($userSettings.settings?.volume ?? DEFAULT_VOLUME));

	let hasVideo = $derived(
		!!(
			$mapDataStore[$currentSong.song?.id]?.video ||
			$mapDataStore[$currentSong.song?.id]?.videoSource
		)
	);
	let videoOn = $derived($userSettings.settings?.appearance?.video ?? true);

	function openFocus() {
		focusMode.set(true);
	}

	/** Searches for the artist (the search page shows their beatmaps and downloaded songs) */
	function searchArtist(artist) {
		if (!artist) return;
		searchQuery.set(artist);
		goto('/search');
	}

	function formatTime(seconds) {
		if (!seconds) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function handleProgressChange(value) {
		if (!$songQueue?.audio) return;
		$songQueue.audio.currentTime = value;
	}

	onDestroy(async () => {
		if ($currentSong.isPlaying) {
			stopPlayback();
		}
	});
	let shuffled = $derived($userSettings.settings?.shuffle || false);
	let repeat = $derived($userSettings.settings?.repeat ?? 'off');
	let canSkipForward = $derived(hasNext($songQueue, $upNext, repeat));

	const ICON_BUTTON =
		'size-8 grid place-items-center rounded-full cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed';

	const repeatTitles = {
		off: 'Enable repeat',
		all: 'Enable repeat one',
		one: 'Disable repeat'
	};
</script>

{#if $currentSong?.song?.id}
	<!-- The song keeps room for its title in narrow windows: the buttons on the right take only
	     what they need until the window is wide enough for both sides alike -->
	<footer
		class="h-20 shrink-0 grid grid-cols-[minmax(13rem,1fr)_minmax(14rem,2fr)_auto] 2xl:grid-cols-[1fr_minmax(0,40rem)_1fr] items-center gap-4 px-4"
	>
		<div class="flex items-center gap-3 min-w-0">
			<button
				title="Open focus mode"
				aria-label="Open focus mode"
				class="shrink-0 rounded-md cursor-pointer transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
				onclick={openFocus}
			>
				<SongCover
					setId={$currentSong.song.id}
					track={$currentSong.song.track}
					title={$currentSong.song.title}
					class="size-14 rounded-md"
				/>
			</button>
			<div class="min-w-0 flex flex-col items-start">
				<button
					title="Go to the beatmap"
					class="max-w-full text-sm font-semibold truncate text-start cursor-pointer hover:underline"
					onclick={() => goto(`/map/${$currentSong.song.id}`)}
				>
					{$currentSong.song?.title}
				</button>
				<button
					title="Search for {$currentSong.song?.artist}"
					class="max-w-full text-xs text-secondary-600 truncate text-start cursor-pointer hover:underline hover:text-white"
					onclick={() => searchArtist($currentSong.song?.artist)}
				>
					{$currentSong.song?.artist}
				</button>
			</div>
			{#if Number($currentSong.song.beatmaps?.[0]?.id) > 0}
				{@const liked = $isFavourite($currentSong.song)}
				<button
					title={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					aria-pressed={liked}
					class="size-8 shrink-0 grid place-items-center rounded-full cursor-pointer transition {liked
						? 'text-primary-500 hover:text-primary-400'
						: 'text-secondary-600 hover:text-white'}"
					onclick={() => toggleFavourite($currentSong.song)}
				>
					<span
						class="{liked
							? 'icon-[mingcute--heart-fill]'
							: 'icon-[mingcute--heart-line]'} size-[18px]"
					></span>
				</button>
			{/if}
		</div>

		<div class="w-full max-w-[40rem] mx-auto flex flex-col items-center gap-1.5">
			<div class="flex items-center gap-4">
				<button
					disabled={$songQueue.type != 'playlist'}
					title={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
					aria-label={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
					aria-pressed={shuffled}
					class="relative {ICON_BUTTON} {shuffled
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					onclick={async () => {
						shuffled = !shuffled;
						updateUserSettings({ shuffle: shuffled });
						await shuffleQueue();
					}}
				>
					<span class="icon-[mingcute--shuffle-line] size-5"></span>
					{#if shuffled}
						<span class="absolute -bottom-0.5 size-1 rounded-full bg-primary-500"></span>
					{/if}
				</button>
				<button
					title="Previous"
					aria-label="Previous"
					class="{ICON_BUTTON} text-white/70 hover:text-white"
					onclick={async () => await skipBackward()}
				>
					<span class="icon-[mingcute--skip-previous-fill] size-5"></span>
				</button>
				<button
					title={$currentSong.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
					aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
					class="size-9 grid place-items-center rounded-full bg-white text-black cursor-pointer transition hover:scale-105"
					onclick={() => togglePlayback()}
				>
					<span
						class="{$currentSong.isPlaying
							? 'icon-[mingcute--pause-fill]'
							: 'icon-[mingcute--play-fill]'} size-5"
					></span>
				</button>
				<button
					title="Next"
					aria-label="Next"
					disabled={!canSkipForward}
					class="{ICON_BUTTON} text-white/70 hover:text-white"
					onclick={async () => await skipForward()}
				>
					<span class="icon-[mingcute--skip-forward-fill] size-5"></span>
				</button>
				<button
					title={repeatTitles[repeat]}
					aria-label={repeatTitles[repeat]}
					class="relative {ICON_BUTTON} {repeat !== 'off'
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					onclick={cycleRepeatMode}
				>
					<span
						class="{repeat === 'one'
							? 'icon-[mingcute--repeat-one-line]'
							: 'icon-[mingcute--repeat-line]'} size-5"
					></span>
					{#if repeat !== 'off'}
						<span class="absolute -bottom-0.5 size-1 rounded-full bg-primary-500"></span>
					{/if}
				</button>
			</div>
			<div class="w-full flex items-center gap-2">
				<span class="w-10 text-end text-xs text-secondary-600 tabular-nums">
					{formatTime(currentTime)}
				</span>
				<Range
					value={currentTime}
					min={0}
					max={duration || 1}
					step={0.1}
					onchange={handleProgressChange}
				/>
				<span class="w-10 text-xs text-secondary-600 tabular-nums">{formatTime(duration)}</span>
			</div>
		</div>

		<div class="flex items-center justify-end gap-1 xl:gap-2">
			<SleepTimer />
			<ModSelect />
			{#if hasVideo}
				<button
					title={videoOn ? 'Hide beatmap video' : 'Play beatmap video'}
					aria-label="Beatmap video"
					aria-pressed={videoOn}
					class="{ICON_BUTTON} {videoOn ? 'text-primary-500' : 'text-white/60 hover:text-white'}"
					onclick={() => updateAppearance({ video: !videoOn })}
				>
					<span class="icon-[mingcute--video-line] size-5"></span>
				</button>
			{/if}
			<HitsoundMenu />
			<button
				title="Lyrics"
				aria-label="Lyrics"
				aria-pressed={page.url.pathname === '/lyrics'}
				class="{ICON_BUTTON} {page.url.pathname === '/lyrics'
					? 'text-primary-500'
					: 'text-white/60 hover:text-white'}"
				onclick={toggleLyrics}
			>
				<span class="icon-[mingcute--mic-line] size-5"></span>
			</button>
			<button
				title="Queue"
				aria-label="Queue"
				aria-pressed={$queuePanelOpen}
				class="relative {ICON_BUTTON} {$queuePanelOpen
					? 'text-primary-500'
					: 'text-white/60 hover:text-white'}"
				onclick={() => queuePanelOpen.update((open) => !open)}
			>
				<span class="icon-[mingcute--playlist-2-line] size-5"></span>
				{#if $upNext.length}
					<span
						class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary-300 text-white text-[10px] font-bold leading-4 text-center"
					>
						{$upNext.length}
					</span>
				{/if}
			</button>
			<!-- In narrow windows the volume opens above the button -->
			<div class="relative group/volume flex items-center gap-2">
				<button
					title={volume === 0 ? 'Unmute' : 'Mute'}
					aria-label={volume === 0 ? 'Unmute' : 'Mute'}
					aria-pressed={volume === 0}
					class="{ICON_BUTTON} text-white/60 hover:text-white"
					onclick={toggleMute}
				>
					<span
						class="{volume === 0
							? 'icon-[mingcute--volume-mute-line]'
							: 'icon-[mingcute--volume-line]'} size-5"
					></span>
				</button>
				<div
					class="w-28 max-xl:absolute max-xl:bottom-full max-xl:right-0 max-xl:mb-1 max-xl:p-3 max-xl:rounded-lg max-xl:bg-secondary-200 max-xl:shadow-xl max-xl:ring-1 max-xl:ring-white/5 max-xl:invisible max-xl:opacity-0 max-xl:group-hover/volume:visible max-xl:group-hover/volume:opacity-100 max-xl:group-focus-within/volume:visible max-xl:group-focus-within/volume:opacity-100 transition-opacity"
				>
					<Range
						value={volume}
						min={0}
						max={MAX_VOLUME}
						step={0.001}
						onchange={(value) => setVolume(value)}
					/>
				</div>
			</div>
		</div>
	</footer>
{/if}
