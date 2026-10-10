<script>
	import Widget from './Widget.svelte';
	import {
		currentSong,
		songQueue,
		playbackTime,
		togglePlayback,
		skipForward,
		skipBackward
	} from '#lib/stores/audio.ts';
	import { handleImageError } from '#lib/stores/data.ts';

	/** @type {{ class?: string }} */
	let { class: className = '' } = $props();

	let progress = $derived(
		$playbackTime.duration ? ($playbackTime.current / $playbackTime.duration) * 100 : 0
	);

	function formatTime(seconds) {
		if (!seconds) return '0:00';
		return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
			.toString()
			.padStart(2, '0')}`;
	}

	function seek(event) {
		const audio = $songQueue.audio;
		if (!audio?.duration) return;
		const rect = event.currentTarget.getBoundingClientRect();
		audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
	}
</script>

<Widget class="p-4 {className}">
	{#if $currentSong.song}
		<div class="flex items-center gap-4">
			<img
				src="https://assets.ppy.sh/beatmaps/{$currentSong.song.id}/covers/list@2x.jpg"
				alt=""
				class="size-16 rounded-lg object-cover shrink-0"
				onerror={handleImageError}
			/>
			<div class="min-w-0 flex-1">
				<p class="text-xs font-bold uppercase tracking-wider text-primary-500">
					{$currentSong.isPlaying ? 'Now playing' : 'Paused'}
				</p>
				<p class="font-bold truncate">{$currentSong.song.title}</p>
				<p class="text-sm text-white/70 truncate">{$currentSong.song.artist}</p>
			</div>
		</div>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="mt-4 h-1.5 rounded-full bg-white/15 cursor-pointer group" onclick={seek}>
			<div
				class="h-full rounded-full bg-white group-hover:bg-primary-400 transition-[width] duration-500 ease-linear"
				style="width: {progress}%"
			></div>
		</div>
		<div class="mt-1.5 flex justify-between text-xs text-white/60 tabular-nums">
			<span>{formatTime($playbackTime.current)}</span>
			<span>{formatTime($playbackTime.duration)}</span>
		</div>
		<div class="mt-2 flex items-center justify-center gap-5">
			<button
				aria-label="Previous"
				class="size-9 grid place-items-center rounded-full text-white/70 hover:text-white cursor-pointer"
				onclick={skipBackward}
			>
				<span class="icon-[mingcute--skip-previous-fill] size-5"></span>
			</button>
			<button
				aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
				class="size-11 grid place-items-center rounded-full bg-white text-black cursor-pointer transition hover:scale-105"
				onclick={togglePlayback}
			>
				<span
					class="{$currentSong.isPlaying
						? 'icon-[mingcute--pause-fill]'
						: 'icon-[mingcute--play-fill]'} size-6"
				></span>
			</button>
			<button
				aria-label="Next"
				class="size-9 grid place-items-center rounded-full text-white/70 hover:text-white cursor-pointer"
				onclick={skipForward}
			>
				<span class="icon-[mingcute--skip-forward-fill] size-5"></span>
			</button>
		</div>
	{:else}
		<div class="flex items-center gap-3 text-white/70">
			<span class="icon-[mingcute--music-2-line] size-8 shrink-0"></span>
			<div>
				<p class="font-semibold text-white">Nothing playing</p>
				<p class="text-sm">Pick a song from your downloads or a playlist.</p>
			</div>
		</div>
	{/if}
</Widget>
