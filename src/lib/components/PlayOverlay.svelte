<script>
	// Playing a map yourself: the gameplay fills the window, like the focus mode
	import { fade } from 'svelte/transition';
	import BeatmapBackground from './BeatmapBackground.svelte';
	import Titlebar from './Titlebar.svelte';
	import Gameplay from './Gameplay.svelte';
	import { currentSong } from '#lib/stores/audio.ts';
	import { setGameplayMode, chosenMapId } from '#lib/gameplay/play.ts';

	let song = $derived($currentSong.song);
</script>

<div class="fixed inset-0 z-40 bg-black" transition:fade={{ duration: 200 }}>
	<BeatmapBackground
		setId={song?.id ?? null}
		mapId={song ? chosenMapId(song) : null}
		title={song?.title}
		class="absolute inset-0"
		video
	/>
	<!-- Dimmed like osu!'s background dim, so the circles stand out -->
	<div class="absolute inset-0 bg-black/70"></div>
	<Gameplay class="absolute inset-0" />
	<div class="relative z-10">
		<Titlebar />
	</div>
	<button
		class="absolute bottom-5 right-5 z-10 flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold bg-black/40 backdrop-blur-2xl ring-1 ring-white/10 text-white/70 hover:text-white cursor-pointer transition"
		onclick={() => setGameplayMode(song, { kind: 'auto' })}
	>
		<span class="icon-[mingcute--close-line] size-[18px]"></span>
		Stop playing (Esc)
	</button>
</div>
