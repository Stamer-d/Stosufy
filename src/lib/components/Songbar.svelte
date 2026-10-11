<script>
	import SongCover from './SongCover.svelte';
	import { onMount, onDestroy } from 'svelte';
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
		queuePanelOpen
	} from '#lib/stores/audio.ts';
	import Range from './Range.svelte';
	import { handleKeybind, toggleLyrics } from '#lib/stores/keybinds.ts';
	import { page } from '$app/state';
	import {
		updateUserSettings,
		userSettings,
		updateCurrentQueue,
		updateAppearance
	} from '#lib/stores/user.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { setVolume } from '#lib/stores/mixer.ts';
	import ModSelect from './ModSelect.svelte';
	import SleepTimer from './SleepTimer.svelte';

	let currentTime = 0;
	let duration = 0;
	let updateInterval;
	let lastUpdateTime = 0;
	let volume = $userSettings.settings?.volume || 0.05;
	let previousVolume = 1;
	let shuffled = false;

	$: hasVideo = !!(
		$mapDataStore[$currentSong.song?.id]?.video || $mapDataStore[$currentSong.song?.id]?.videoSource
	);
	$: videoOn = $userSettings.settings?.appearance?.video ?? true;

	function formatTime(seconds) {
		if (!seconds) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function handleProgressChange(event) {
		if (!$songQueue?.audio) return;
		$songQueue.audio.currentTime = event.detail;
	}

	async function updateTimeDisplay() {
		if (!$songQueue?.audio) return;
		currentTime = $songQueue.audio.currentTime;
		duration = $songQueue.audio.duration || 0;
		const timeDifference = Math.abs(currentTime - lastUpdateTime);

		if (timeDifference >= 5 && $songQueue.type === 'playlist') {
			lastUpdateTime = currentTime;
			updateCurrentQueue({
				currentSeconds: currentTime || 0.001,
				playlistId: $songQueue.playlistId
			});
		}
	}

	// Set up interval for time updates
	async function setupTimeTracking() {
		clearInterval(updateInterval);

		if ($songQueue?.audio) {
			// Regular updates
			updateInterval = setInterval(async () => {
				updateTimeDisplay();
			}, 500);
			// The audio's own volume includes normalization and fades, so use the setting
			volume = $userSettings.settings?.volume ?? volume;
		}
	}

	// Handle volume change from slider
	function handleVolumeChange(newVolume) {
		if (!$songQueue?.audio) return;

		volume = newVolume; // e.detail is already the volume value
		setVolume(volume);
		updateUserSettings({ volume: volume });
		// If we adjust volume to above 0, make sure it's not muted
		if (volume > 0 && $songQueue.audio.muted) {
			$songQueue.audio.muted = false;
		}
		if (volume === 0) {
			toggleMute();
		}
	}

	// Toggle mute/unmute
	function toggleMute() {
		if (!$songQueue?.audio) return;
		if ($songQueue.audio.muted) {
			$songQueue.audio.muted = false;
			volume = previousVolume > 0 ? previousVolume : 0.05;
			setVolume(volume);
		} else {
			previousVolume = volume;
			volume = 0.0;
			setVolume(volume);
			$songQueue.audio.muted = true;
		}
	}

	// Get appropriate volume icon based on current volume
	function getVolumeIcon() {
		return volume === 0 ? 'icon-[mingcute--volume-mute-line]' : 'icon-[mingcute--volume-line]';
	}

	// Track changes to currentlyPlaying and set up time tracking
	$: if ($songQueue?.audio) {
		setupTimeTracking();
	}

	// The song bar owns the volume, so it does the volume shortcuts (see keybinds.ts)
	const VOLUME_STEP = 0.01;
	const MAX_VOLUME = 0.2;
	const stopHandling = [
		handleKeybind('volumeUp', () => handleVolumeChange(Math.min(MAX_VOLUME, volume + VOLUME_STEP))),
		handleKeybind('volumeDown', () => handleVolumeChange(Math.max(0.001, volume - VOLUME_STEP))),
		handleKeybind('mute', toggleMute)
	];
	onDestroy(async () => {
		clearInterval(updateInterval);
		if ($currentSong.isPlaying) {
			stopPlayback();
		}
		stopHandling.forEach((stop) => stop());
	});
	$: shuffled = $userSettings.settings?.shuffle || false;
	$: repeat = $userSettings.settings?.repeat ?? 'off';
	$: canSkipForward = hasNext($songQueue, $upNext, repeat);

	const ICON_BUTTON =
		'size-8 grid place-items-center rounded-full cursor-pointer transition disabled:opacity-30 disabled:cursor-not-allowed';

	const repeatTitles = {
		off: 'Enable repeat',
		all: 'Enable repeat one',
		one: 'Disable repeat'
	};
</script>

{#if $currentSong?.song?.id}
	<footer class="h-20 shrink-0 grid grid-cols-[1fr_minmax(0,40rem)_1fr] items-center gap-4 px-4">
		<div class="flex items-center gap-3 min-w-0">
			<SongCover
				setId={$currentSong.song.id}
				title={$currentSong.song.title}
				class="size-14 rounded-md"
			/>
			<div class="min-w-0">
				<div class="text-sm font-semibold truncate">{$currentSong.song?.title}</div>
				<div class="text-xs text-secondary-600 truncate">{$currentSong.song?.artist}</div>
			</div>
		</div>

		<div class="flex flex-col items-center gap-1.5">
			<div class="flex items-center gap-4">
				<button
					disabled={$songQueue.type != 'playlist'}
					title={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
					aria-label={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
					aria-pressed={shuffled}
					class="relative {ICON_BUTTON} {shuffled
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					on:click={async () => {
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
					on:click={async () => await skipBackward()}
				>
					<span class="icon-[mingcute--skip-previous-fill] size-5"></span>
				</button>
				<button
					title={$currentSong.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
					aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
					class="size-9 grid place-items-center rounded-full bg-white text-black cursor-pointer transition hover:scale-105"
					on:click={() => togglePlayback()}
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
					on:click={async () => await skipForward()}
				>
					<span class="icon-[mingcute--skip-forward-fill] size-5"></span>
				</button>
				<button
					title={repeatTitles[repeat]}
					aria-label={repeatTitles[repeat]}
					class="relative {ICON_BUTTON} {repeat !== 'off'
						? 'text-primary-500'
						: 'text-white/60 hover:text-white'}"
					on:click={cycleRepeatMode}
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
					bind:value={currentTime}
					min={0}
					max={duration || 1}
					step={0.1}
					on:change={handleProgressChange}
				/>
				<span class="w-10 text-xs text-secondary-600 tabular-nums">{formatTime(duration)}</span>
			</div>
		</div>

		<div class="flex items-center justify-end gap-2">
			<SleepTimer />
			<ModSelect />
			{#if hasVideo}
				<button
					title={videoOn ? 'Hide beatmap video' : 'Play beatmap video'}
					aria-label="Beatmap video"
					aria-pressed={videoOn}
					class="{ICON_BUTTON} {videoOn ? 'text-primary-500' : 'text-white/60 hover:text-white'}"
					on:click={() => updateAppearance({ video: !videoOn })}
				>
					<span class="icon-[mingcute--video-line] size-5"></span>
				</button>
			{/if}
			<button
				title="Lyrics"
				aria-label="Lyrics"
				aria-pressed={page.url.pathname === '/lyrics'}
				class="{ICON_BUTTON} {page.url.pathname === '/lyrics'
					? 'text-primary-500'
					: 'text-white/60 hover:text-white'}"
				on:click={toggleLyrics}
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
				on:click={() => queuePanelOpen.update((open) => !open)}
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
			<button
				title={volume === 0 ? 'Unmute' : 'Mute'}
				aria-label={volume === 0 ? 'Unmute' : 'Mute'}
				class="{ICON_BUTTON} text-white/60 hover:text-white"
				on:click={toggleMute}
			>
				<span class="{getVolumeIcon()} size-5"></span>
			</button>
			<div class="w-28">
				<Range
					bind:value={volume}
					min={0}
					max={0.2}
					step={0.001}
					on:change={(e) => handleVolumeChange(e.detail)}
				/>
			</div>
		</div>
	</footer>
{/if}
