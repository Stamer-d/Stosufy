<script>
	import { fade } from 'svelte/transition';
	import BeatmapBackground from '../BeatmapBackground.svelte';
	import DesktopCanvas from '../DesktopCanvas.svelte';
	import Titlebar from '../Titlebar.svelte';
	import { focusMode, currentSong } from '#lib/stores/audio.ts';
	import { wallpaper } from '#lib/stores/home.ts';
	import FocusLyrics from '../FocusLyrics.svelte';
	import { userSettings, updateAppearance, updateUserSettings } from '#lib/stores/user.ts';
	import Gameplay from '../Gameplay.svelte';
	import { playingLive } from '#lib/gameplay/play.ts';
	import ModSelect from '../ModSelect.svelte';
	import HitsoundMenu from '../HitsoundMenu.svelte';
	import GameplayControls from '../GameplayControls.svelte';

	let gameplayOn = $derived($userSettings.settings?.gameplay ?? false);
	let widgetsInGameplay = $derived($userSettings.settings?.widgetsInGameplay ?? true);
	let showLyrics = $derived($userSettings.settings?.appearance?.focusLyrics ?? true);

	// Prefer the song that is playing, so the wallpaper follows the music
	let song = $derived($currentSong.song ?? $wallpaper.song);

	function handleKeydown(event) {
		if (event.key === 'Escape') focusMode.set(false);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-40 flex flex-col bg-app" transition:fade={{ duration: 200 }}>
	<BeatmapBackground
		setId={song?.id ?? null}
		mapId={song?.beatmaps?.[0]?.id}
		title={song?.title}
		class="absolute inset-0"
		video
		beat
	/>
	<div class="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70"></div>
	{#if gameplayOn && $currentSong.song}
		<div class="absolute inset-0 bg-black/45"></div>
		<Gameplay class="absolute inset-0" />
	{/if}

	<div class="relative">
		<Titlebar />
	</div>

	<!-- Your widgets, as on the home screen (they make way when you play yourself) -->
	{#if !gameplayOn || !$currentSong.song || (widgetsInGameplay && !$playingLive)}
		<div class="absolute inset-x-0 top-12 bottom-20">
			<DesktopCanvas />
		</div>
	{/if}

	<div class="relative flex-1 flex flex-col justify-between px-12 pt-12 pb-5 pointer-events-none">
		<div></div>
		{#if showLyrics && $currentSong.song && !gameplayOn}
			<div class="flex-1 grid place-items-center px-8">
				<FocusLyrics />
			</div>
		{/if}
		<div class="flex items-end justify-end gap-6">
			<div class="flex items-center gap-2 pointer-events-auto">
				<div
					class="flex items-center gap-1 px-2 h-10 rounded-full bg-black/30 backdrop-blur-2xl ring-1 ring-white/10"
				>
					<ModSelect />
					<HitsoundMenu />
				</div>
				{#if gameplayOn && $currentSong.song}
					<!-- Difficulty, autoplay, playing it yourself and the replays -->
					<GameplayControls up />
				{/if}
				<button
					class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold bg-black/30 backdrop-blur-2xl ring-1 ring-white/10 cursor-pointer transition {gameplayOn
						? 'text-white'
						: 'text-white/60 hover:text-white'}"
					aria-pressed={gameplayOn}
					onclick={() => updateUserSettings({ gameplay: !gameplayOn })}
				>
					<span
						class="{gameplayOn
							? 'icon-[mingcute--target-fill]'
							: 'icon-[mingcute--target-line]'} size-[18px]"
					></span>
					Gameplay
				</button>
				<button
					class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold bg-black/30 backdrop-blur-2xl ring-1 ring-white/10 cursor-pointer transition {showLyrics
						? 'text-white'
						: 'text-white/60 hover:text-white'}"
					aria-pressed={showLyrics}
					onclick={() => updateAppearance({ focusLyrics: !showLyrics })}
				>
					<span class="icon-[mingcute--mic-line] size-[18px]"></span>
					Lyrics
				</button>
				<button
					class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold bg-black/30 backdrop-blur-2xl ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer transition"
					onclick={() => focusMode.set(false)}
				>
					<span class="icon-[mingcute--fullscreen-exit-line] size-[18px]"></span>
					Exit focus
					<kbd class="ml-1 px-1.5 rounded bg-white/10 text-xs font-sans">Esc</kbd>
				</button>
			</div>
		</div>
	</div>
</div>
