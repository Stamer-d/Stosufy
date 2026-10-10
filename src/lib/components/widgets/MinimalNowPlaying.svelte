<script>
	import { currentSong, playbackTime, togglePlayback } from '#lib/stores/audio.ts';

	let progress = $derived(
		$playbackTime.duration ? ($playbackTime.current / $playbackTime.duration) * 100 : 0
	);
</script>

<!-- Just text on the wallpaper -->
<div class="w-96 text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
	{#if $currentSong.song}
		<button
			class="text-start cursor-pointer"
			aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
			onclick={togglePlayback}
		>
			<p class="text-sm font-semibold text-white/70">
				{$currentSong.isPlaying ? '♪ Now playing' : 'Paused'}
			</p>
			<p class="text-3xl font-extrabold tracking-tight leading-tight line-clamp-2">
				{$currentSong.song.title}
			</p>
			<p class="text-lg text-white/80">{$currentSong.song.artist}</p>
		</button>
		<div class="mt-3 h-0.5 bg-white/25">
			<div
				class="h-full bg-white transition-[width] duration-500 ease-linear"
				style="width: {progress}%"
			></div>
		</div>
	{:else}
		<p class="text-lg font-semibold text-white/70">Nothing playing</p>
	{/if}
</div>
