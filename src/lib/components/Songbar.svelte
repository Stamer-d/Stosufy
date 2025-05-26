<script>
	// @ts-nocheck

	import { onMount, onDestroy } from 'svelte';
	import { settings } from '../stores/audio';
	import {
		togglePlayback,
		skipForward,
		songQueue,
		currentSong,
		skipBackward,
		stopPlayback
	} from '../stores/audio';
	import Button from './Button.svelte';
	import Range from './Range.svelte';
	import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
	import { handleImageError } from '$lib/stores/data';

	// Track audio time
	let currentTime = 0;
	let duration = 0;
	let progressPercent = 0;
	let updateInterval;

	// Volume control
	let volume = 1;
	let previousVolume = 1;
	// Format time as MM:SS
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

	// Update time displays when audio is playing
	async function updateTimeDisplay() {
		if (!$songQueue?.audio) return;
		if (!$currentSong.isPlaying) return;
		currentTime = $songQueue.audio.currentTime;
		duration = $songQueue.audio.duration || 0;
		progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
		if (progressPercent >= 100) {
			if ($songQueue.currentIndex == $songQueue.queue?.length - 1) {
				stopPlayback();
			} else {
				await skipForward();
			}
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
		$settings.volume = volume;
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
</script>

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
				<Button type="ghost" disabled>
					<span class="icon-[mingcute--shuffle-line] size-5" on:click={() => {}} />
				</Button>
				<Button type="ghost" on:click={async () => await skipBackward()}>
					<span class="icon-[fa6-solid--backward-step] size-5" />
				</Button>
				<Button type="ghost" on:click={() => togglePlayback()}>
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
				<Button type="ghost" on:click={async () => await skipForward()}>
					<span class="icon-[fa6-solid--forward-step] size-5" />
				</Button>
				<Button type="ghost" disabled>
					<span class="icon-[fa6-solid--repeat] size-4" />
				</Button>
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
			<!-- Volume control -->
			<div class="flex items-center justify-start gap-2 relative">
				<Button type="ghost" on:click={toggleMute}>
					<span class="{getVolumeIcon()} size-4" />
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
