<script>
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
	import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
	import { handleImageError } from '#lib/stores/data.ts';
	import { updateUserSettings, userSettings, updateCurrentQueue } from '#lib/stores/user.ts';

	let currentTime = 0;
	let duration = 0;
	let updateInterval;
	let lastUpdateTime = 0;
	let volume = $userSettings.settings?.volume || 0.05;
	let previousVolume = 1;
	let shuffled = false;

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
			// Initialize volume from audio element
			volume = $songQueue.audio.volume;
		}
	}

	// Handle volume change from slider
	function handleVolumeChange(newVolume) {
		if (!$songQueue?.audio) return;

		volume = newVolume; // e.detail is already the volume value
		$songQueue.audio.volume = volume;
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
			$songQueue.audio.volume = volume;
		} else {
			previousVolume = volume;
			volume = 0.0;
			$songQueue.audio.volume = volume;
			$songQueue.audio.muted = true;
		}
	}

	// Get appropriate volume icon based on current volume
	function getVolumeIcon() {
		return volume === 0 ? 'icon-[mingcute--volume-mute-line]' : 'icon-[mingcute--volume-line]';
	}

	// Space toggles playback, unless the user is typing
	function handleKeydown(event) {
		if (event.code !== 'Space' || event.repeat || !$songQueue?.audio) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) {
			return;
		}
		event.preventDefault();
		togglePlayback();
	}

	// Track changes to currentlyPlaying and set up time tracking
	$: if ($songQueue?.audio) {
		setupTimeTracking();
	}

	onMount(async () => {
		await register('MEDIAPLAYPAUSE', (e) => {
			if (e.state == 'Pressed') {
				togglePlayback();
			}
		});
		await register('MEDIATRACKNEXT', async (e) => {
			if (e.state == 'Pressed') await skipForward();
		});
		await register('MEDIATRACKPREV', async (e) => {
			if (e.state == 'Pressed') await skipBackward();
		});
		await register('F14', (e) => {
			if (e.state == 'Released') return;
			if (volume + 0.01 >= 0.2) {
				handleVolumeChange(0.2);
				return;
			}
			handleVolumeChange(volume + 0.01);
		});
		await register('F13', (e) => {
			if (e.state == 'Released') return;
			if (volume - 0.01 <= 0) {
				handleVolumeChange(0.001);
				return;
			}
			handleVolumeChange(volume - 0.01);
		});
	});
	onDestroy(async () => {
		clearInterval(updateInterval);
		if ($currentSong.isPlaying) {
			stopPlayback();
		}
		await unregister('MEDIAPLAYPAUSE');
		await unregister('MEDIATRACKNEXT');
		await unregister('MEDIATRACKPREV');
		await unregister('F14');
		await unregister('F13');
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

<svelte:window on:keydown={handleKeydown} />

{#if $currentSong?.song?.id}
	<footer class="h-20 shrink-0 grid grid-cols-[1fr_minmax(0,40rem)_1fr] items-center gap-4 px-4">
		<div class="flex items-center gap-3 min-w-0">
			<img
				src="https://assets.ppy.sh/beatmaps/{$currentSong.song?.id}/covers/list.jpg"
				class="size-14 rounded-md object-cover shrink-0"
				alt=""
				on:error={handleImageError}
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
