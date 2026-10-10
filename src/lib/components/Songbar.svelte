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
	import Button from './Button.svelte';
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
		if (volume === 0.0) {
			return 'icon-[fa6-solid--volume-xmark]';
		} else if (volume < 0.03) {
			return 'icon-[fa6-solid--volume-off]';
		} else if (volume < 0.06) {
			return 'icon-[fa6-solid--volume-low]';
		} else {
			return 'icon-[fa6-solid--volume-high]';
		}
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

	const repeatTitles = {
		off: 'Enable repeat',
		all: 'Enable repeat one',
		one: 'Disable repeat'
	};
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $currentSong?.song?.id}
	<div class="grid grid-cols-3 gap-2 py-3 px-4 bg-secondary-50">
		<div class="gap-3 flex items-center">
			<img
				src="https://assets.ppy.sh/beatmaps/{$currentSong.song?.id}/covers/list.jpg"
				class="size-16 rounded"
				alt=""
				on:error={handleImageError}
			/>
			<div>
				<div class="font-medium">{$currentSong.song?.title}</div>
				<div class="text-sm text-secondary-600">{$currentSong.song?.artist}</div>
			</div>
		</div>
		<div class="w-full flex-col flex">
			<div class="flex justify-center items-center gap-6 -my-2">
				{#key shuffled}
					<Button
						type="ghost"
						disabled={$songQueue.type != 'playlist'}
						title={shuffled ? 'Disable shuffle' : 'Enable shuffle'}
						aria-pressed={shuffled}
						class={shuffled ? 'text-primary-200 hover:text-primary-300' : ''}
						on:click={async () => {
							shuffled = !shuffled;
							updateUserSettings({ shuffle: shuffled });
							await shuffleQueue();
						}}
					>
						<span class="icon-[mingcute--shuffle-line] size-5"></span>
					</Button>
				{/key}
				<Button type="ghost" title="Previous" on:click={async () => await skipBackward()}>
					<span class="icon-[fa6-solid--backward-step] size-5"></span>
				</Button>
				<Button
					type="ghost"
					title={$currentSong.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
					on:click={() => togglePlayback()}
				>
					{#key $currentSong}
						{#if $currentSong.isPlaying}
							<span class="icon-[fa6-solid--circle-pause] size-8 hover:scale-[1.05] text-white"
							></span>
						{:else}
							<span class="icon-[fa6-solid--circle-play] size-8 hover:scale-[1.05] text-white"
							></span>
						{/if}
					{/key}
				</Button>
				<Button
					type="ghost"
					title="Next"
					disabled={!canSkipForward}
					on:click={async () => await skipForward()}
				>
					<span class="icon-[fa6-solid--forward-step] size-5"></span>
				</Button>
				{#key repeat}
					<Button
						type="ghost"
						title={repeatTitles[repeat]}
						aria-label={repeatTitles[repeat]}
						class="relative {repeat !== 'off' ? 'text-primary-200 hover:text-primary-300' : ''}"
						on:click={cycleRepeatMode}
					>
						<span
							class="{repeat === 'one'
								? 'icon-[mingcute--repeat-one-line]'
								: 'icon-[mingcute--repeat-line]'} size-5"
						></span>
						{#if repeat !== 'off'}
							<span
								class="absolute bottom-0 left-1/2 -translate-x-1/2 size-1 rounded-full bg-primary-200"
							></span>
						{/if}
					</Button>
				{/key}
			</div>
			<div class="flex items-center gap-2 mt-3">
				<span class="text-sm text-secondary-500">{formatTime(currentTime)}</span>
				<!-- Clickable progress bar -->
				<Range
					bind:value={currentTime}
					min={0}
					max={duration || 1}
					step={0.1}
					on:change={handleProgressChange}
				/>
				<span class="text-sm text-secondary-500">{formatTime(duration)}</span>
			</div>
		</div>
		<div class="justify-end flex items-center gap-3">
			<Button
				type="ghost"
				title="Queue"
				aria-label="Queue"
				aria-pressed={$queuePanelOpen}
				class="relative {$queuePanelOpen ? 'text-primary-200 hover:text-primary-300' : ''}"
				on:click={() => queuePanelOpen.update((open) => !open)}
			>
				<span class="icon-[mingcute--playlist-2-line] size-5"></span>
				{#if $upNext.length}
					<span
						class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary-200 text-white text-[10px] leading-4 text-center"
					>
						{$upNext.length}
					</span>
				{/if}
			</Button>
			<!-- Volume control -->
			<div class="flex items-center justify-start gap-2 relative">
				<Button type="ghost" on:click={toggleMute}>
					<span class="{getVolumeIcon()} size-4"></span>
				</Button>

				<div class="w-24">
					<Range
						bind:value={volume}
						min={0}
						max={0.2}
						step={0.001}
						on:change={(e) => handleVolumeChange(e.detail)}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}
