<script>
	import { fade } from 'svelte/transition';
	import BeatmapBackground from '../BeatmapBackground.svelte';
	import ClockWidget from './ClockWidget.svelte';
	import NowPlayingWidget from './NowPlayingWidget.svelte';
	import Titlebar from '../Titlebar.svelte';
	import { focusMode, currentSong } from '#lib/stores/audio.ts';
	import { wallpaper } from '#lib/stores/home.ts';

	// Prefer the song that is playing, so the wallpaper follows the music
	let song = $derived($currentSong.song ?? $wallpaper.song);

	function handleKeydown(event) {
		if (event.key === 'Escape') focusMode.set(false);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-40 flex flex-col bg-app" transition:fade={{ duration: 200 }}>
	<BeatmapBackground setId={song?.id ?? null} title={song?.title} class="absolute inset-0" />
	<div class="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70"></div>

	<div class="relative">
		<Titlebar />
	</div>

	<div class="relative flex-1 flex flex-col justify-between p-12">
		<ClockWidget size="lg" />
		<div class="flex items-end justify-between gap-6">
			<NowPlayingWidget class="w-full max-w-md" />
			<button
				class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold bg-black/45 backdrop-blur-md ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer transition"
				onclick={() => focusMode.set(false)}
			>
				<span class="icon-[mingcute--fullscreen-exit-line] size-[18px]"></span>
				Exit focus
				<kbd class="ml-1 px-1.5 rounded bg-white/10 text-xs font-sans">Esc</kbd>
			</button>
		</div>
	</div>
</div>
