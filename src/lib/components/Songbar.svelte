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
	import ConnectDevices from './ConnectDevices.svelte';
	import { connect, remote, positionOf, DEVICE_ICONS } from '#lib/stores/connect.ts';

	// Another device plays (Stosufy Connect): the bar shows its song, and controls it
	// (one that plays nothing yet: the bar is this one's, playing here makes it the one)
	let away = $derived($connect.remote ? $connect.playback : null);
	let elsewhere = $derived(!!away);
	let song = $derived(elsewhere ? away.song : $currentSong.song);
	let isPlaying = $derived(elsewhere ? !!away?.playing : $currentSong.isPlaying);
	// (where the song there is, worked out twice a second)
	let tick = $state(0);
	$effect(() => {
		if (!elsewhere) return;
		const timer = setInterval(() => tick++, 500);
		return () => clearInterval(timer);
	});
	let awayTime = $derived.by(() => {
		void tick;
		return positionOf(away);
	});
	/** Dragging the position there: sent once the slider rests a moment */
	let seekTimer = null;
	function seekThere(value) {
		clearTimeout(seekTimer);
		seekTimer = setTimeout(() => remote.seek(value), 150);
	}
	let lastAwayVolume = 0.5;
	function muteThere() {
		if (away?.volume == null) return;
		if (away.volume > 0) {
			lastAwayVolume = away.volume;
			remote.setVolume(0);
		} else remote.setVolume(lastAwayVolume || 0.5);
	}

	// The position, from the player (twice a second; it also saves it for the next start)
	let currentTime = $derived(elsewhere ? awayTime : $playbackTime.current);
	let duration = $derived(elsewhere ? (away?.duration ?? 0) : $playbackTime.duration);
	// The volume lives in the settings (see mixer.ts); muted shows as 0
	let muted = $derived($userSettings.settings?.muted ?? false);
	let ownVolume = $derived(muted ? 0 : ($userSettings.settings?.volume ?? DEFAULT_VOLUME));
	// (the other device's 0–1; null if it can't be set from here)
	let volume = $derived(elsewhere ? (away?.volume ?? 0) * MAX_VOLUME : ownVolume);
	let volumeLocked = $derived(elsewhere && away?.volume == null);

	let hasVideo = $derived(
		!!($mapDataStore[song?.id]?.video || $mapDataStore[song?.id]?.videoSource)
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
		if (elsewhere) return seekThere(value);
		if (!$songQueue?.audio) return;
		$songQueue.audio.currentTime = value;
	}

	onDestroy(async () => {
		if ($currentSong.isPlaying) {
			stopPlayback();
		}
	});
	let shuffled = $derived(elsewhere ? !!away?.shuffle : $userSettings.settings?.shuffle || false);
	let repeat = $derived(
		elsewhere ? (away?.repeat ?? 'off') : ($userSettings.settings?.repeat ?? 'off')
	);
	let canSkipForward = $derived(elsewhere || hasNext($songQueue, $upNext, repeat));

	const ICON_BUTTON =
		'size-8 grid place-items-center rounded-full cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed';

	const repeatTitles = {
		off: 'Enable repeat',
		all: 'Enable repeat one',
		one: 'Disable repeat'
	};
</script>

{#if song?.id}
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
					setId={song.id}
					track={song.track}
					title={song.title}
					class="size-14 rounded-md"
				/>
			</button>
			<div class="min-w-0 flex flex-col items-start">
				<button
					title="Go to the beatmap"
					class="max-w-full text-sm font-semibold truncate text-start cursor-pointer hover:underline"
					onclick={() => goto(`/map/${song.id}`)}
				>
					{song?.title}
				</button>
				<button
					title="Search for {song?.artist}"
					class="max-w-full text-xs text-secondary-600 truncate text-start cursor-pointer hover:underline hover:text-white"
					onclick={() => searchArtist(song?.artist)}
				>
					{song?.artist}
				</button>
			</div>
			{#if Number(song.beatmaps?.[0]?.id) > 0}
				{@const liked = $isFavourite(song)}
				<button
					title={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					aria-pressed={liked}
					class="size-8 shrink-0 grid place-items-center rounded-full cursor-pointer transition {liked
						? 'text-primary-500 hover:text-primary-400'
						: 'text-secondary-600 hover:text-white'}"
					onclick={() => toggleFavourite(song)}
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
					disabled={!elsewhere && $songQueue.type != 'playlist'}
					title={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
					aria-label={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
					aria-pressed={shuffled}
					class="relative {ICON_BUTTON} {shuffled
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					onclick={async () => {
						if (elsewhere) return remote.setShuffle(!shuffled);
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
					onclick={async () => (elsewhere ? remote.previous() : await skipBackward())}
				>
					<span class="icon-[mingcute--skip-previous-fill] size-5"></span>
				</button>
				<button
					title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
					aria-label={isPlaying ? 'Pause' : 'Play'}
					class="size-9 grid place-items-center rounded-full bg-white text-black cursor-pointer transition hover:scale-105"
					onclick={() => (elsewhere ? remote.toggle() : togglePlayback())}
				>
					<span
						class="{isPlaying
							? 'icon-[mingcute--pause-fill]'
							: 'icon-[mingcute--play-fill]'} size-5"
					></span>
				</button>
				<button
					title="Next"
					aria-label="Next"
					disabled={!canSkipForward}
					class="{ICON_BUTTON} text-white/70 hover:text-white"
					onclick={async () => (elsewhere ? remote.next() : await skipForward())}
				>
					<span class="icon-[mingcute--skip-forward-fill] size-5"></span>
				</button>
				<button
					title={repeatTitles[repeat]}
					aria-label={repeatTitles[repeat]}
					class="relative {ICON_BUTTON} {repeat !== 'off'
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					onclick={() => (elsewhere ? remote.cycleRepeat() : cycleRepeatMode())}
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
					label="Where the song is"
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
			{#if !elsewhere}
				<SleepTimer />
				<ModSelect />
			{/if}
			{#if hasVideo && !elsewhere}
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
			{#if !elsewhere}
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
			{/if}
			<ConnectDevices />
			<!-- In narrow windows the volume opens above the button -->
			<div class="relative group/volume flex items-center gap-2">
				<button
					title={volume === 0 ? 'Unmute' : 'Mute'}
					aria-label={volume === 0 ? 'Unmute' : 'Mute'}
					aria-pressed={volume === 0}
					disabled={volumeLocked}
					class="{ICON_BUTTON} text-white/60 hover:text-white"
					onclick={() => (elsewhere ? muteThere() : toggleMute())}
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
						label="Volume"
						value={volume}
						min={0}
						max={MAX_VOLUME}
						step={0.001}
						disabled={volumeLocked}
						onchange={(value) =>
							elsewhere ? remote.setVolume(value / MAX_VOLUME) : setVolume(value)}
					/>
				</div>
			</div>
		</div>
	</footer>
	{#if elsewhere}
		<!-- As in Spotify: a strip saying where it plays -->
		<div
			class="h-6 shrink-0 -mt-1 px-4 flex items-center justify-end gap-1.5 bg-primary-500 text-[11px] font-semibold text-white"
		>
			<span class="{DEVICE_ICONS[$connect.remoteDevice?.kind] ?? DEVICE_ICONS.phone} size-3.5"
			></span>
			Playing on {$connect.remoteDevice?.name}
		</div>
	{/if}
{/if}
