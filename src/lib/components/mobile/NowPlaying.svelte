<script>
	// The full player on a phone: the cover, the song, the time and the controls
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import BeatmapBackground from '../BeatmapBackground.svelte';
	import ModSelect from '../ModSelect.svelte';
	import {
		currentSong,
		songQueue,
		togglePlayback,
		skipForward,
		skipBackward,
		shuffleQueue,
		cycleRepeatMode,
		hasNext,
		upNext,
		queuePanelOpen
	} from '#lib/stores/audio.ts';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { isFavourite, toggleFavourite } from '#lib/stores/favourites.ts';
	import { chosenMapId } from '#lib/gameplay/play.ts';

	/** @type {{ onclose: () => void }} */
	let { onclose } = $props();

	let song = $derived($currentSong.song);
	let time = $state(0);
	let duration = $state(0);
	let seeking = $state(null);
	$effect(() => {
		const timer = setInterval(() => {
			const audio = $songQueue.audio;
			time = audio?.currentTime ?? 0;
			duration = audio?.duration || 0;
		}, 250);
		return () => clearInterval(timer);
	});

	let shuffled = $derived($userSettings.settings?.shuffle ?? false);
	let repeat = $derived($userSettings.settings?.repeat ?? 'off');
	let canNext = $derived(hasNext($songQueue, $upNext, repeat));

	const clock = (seconds) =>
		`${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;

	function seek(value) {
		const audio = $songQueue.audio;
		if (audio) audio.currentTime = value;
		seeking = null;
	}

	// Swiping down closes it
	let startY = null;
	let pull = $state(0);
	const down = (e) => (startY = e.touches[0].clientY);
	const move = (e) => {
		if (startY !== null) pull = Math.max(0, e.touches[0].clientY - startY);
	};
	const up = () => {
		if (pull > 120) onclose();
		pull = 0;
		startY = null;
	};
</script>

<div
	role="dialog"
	aria-label="Player"
	tabindex="-1"
	class="fixed inset-0 z-50 flex flex-col bg-black text-white now-safe"
	style="transform: translateY({pull}px)"
	transition:fly={{ y: 80, duration: 250 }}
	ontouchstart={down}
	ontouchmove={move}
	ontouchend={up}
>
	<BeatmapBackground
		setId={song?.id ?? null}
		mapId={song ? chosenMapId(song) : null}
		title={song?.title}
		class="absolute inset-0 opacity-60 blur-2xl scale-110"
	/>
	<div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/60 to-black"></div>

	<div class="relative flex items-center justify-between px-3 h-14 shrink-0">
		<button
			class="size-10 grid place-items-center rounded-full active:bg-white/10"
			aria-label="Close the player"
			onclick={onclose}
		>
			<span class="icon-[mingcute--down-line] size-7"></span>
		</button>
		<span class="text-xs font-bold uppercase tracking-widest text-white/60">Now playing</span>
		<ModSelect />
	</div>

	<div class="relative flex-1 min-h-0 flex flex-col justify-end gap-6 px-6 pb-8">
		<div class="flex-1 min-h-0 grid place-items-center">
			<BeatmapBackground
				setId={song?.id ?? null}
				mapId={song ? chosenMapId(song) : null}
				title={song?.title}
				class="relative w-full max-w-sm aspect-square rounded-2xl shadow-2xl shadow-black/60"
			/>
		</div>

		<div class="flex items-center gap-3">
			<div class="min-w-0 flex-1">
				<h2 class="text-2xl font-extrabold truncate">{song?.title}</h2>
				<p class="text-white/60 truncate">{song?.artist}</p>
			</div>
			<button
				class="size-11 grid place-items-center rounded-full active:bg-white/10 {$isFavourite(song)
					? 'text-primary-400'
					: 'text-white/70'}"
				aria-label={$isFavourite(song) ? 'Unlike' : 'Like'}
				onclick={() => toggleFavourite(song)}
			>
				<span
					class="{$isFavourite(song)
						? 'icon-[mingcute--heart-fill]'
						: 'icon-[mingcute--heart-line]'} size-7"
				></span>
			</button>
		</div>

		<div>
			<input
				type="range"
				class="w-full accent-white"
				min="0"
				max={duration || 1}
				step="0.1"
				value={seeking ?? time}
				aria-label="Position"
				oninput={(e) => (seeking = Number(e.currentTarget.value))}
				onchange={(e) => seek(Number(e.currentTarget.value))}
			/>
			<div class="flex justify-between text-xs tabular-nums text-white/60">
				<span>{clock(seeking ?? time)}</span>
				<span>{clock(duration)}</span>
			</div>
		</div>

		<div class="flex items-center justify-between">
			<button
				class="size-12 grid place-items-center {shuffled ? 'text-primary-400' : 'text-white/70'}"
				aria-label="Shuffle"
				aria-pressed={shuffled}
				disabled={$songQueue.type != 'playlist'}
				onclick={async () => {
					updateUserSettings({ shuffle: !shuffled });
					await shuffleQueue();
				}}
			>
				<span class="icon-[mingcute--shuffle-line] size-6"></span>
			</button>
			<button
				class="size-14 grid place-items-center"
				aria-label="Previous"
				onclick={() => skipBackward()}
			>
				<span class="icon-[mingcute--skip-previous-fill] size-9"></span>
			</button>
			<button
				class="size-18 grid place-items-center rounded-full bg-white text-black active:scale-95 transition"
				aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
				onclick={() => togglePlayback()}
			>
				<span
					class="{$currentSong.isPlaying
						? 'icon-[mingcute--pause-fill]'
						: 'icon-[mingcute--play-fill]'} size-9"
				></span>
			</button>
			<button
				class="size-14 grid place-items-center disabled:opacity-30"
				aria-label="Next"
				disabled={!canNext}
				onclick={() => skipForward()}
			>
				<span class="icon-[mingcute--skip-forward-fill] size-9"></span>
			</button>
			<button
				class="size-12 grid place-items-center {repeat !== 'off'
					? 'text-primary-400'
					: 'text-white/70'}"
				aria-label="Repeat"
				onclick={() => cycleRepeatMode()}
			>
				<span
					class="{repeat === 'one'
						? 'icon-[mingcute--repeat-one-line]'
						: 'icon-[mingcute--repeat-line]'} size-6"
				></span>
			</button>
		</div>

		<div class="flex items-center justify-around text-white/70">
			<button
				class="flex flex-col items-center gap-1 text-xs"
				onclick={() => {
					onclose();
					goto('/lyrics');
				}}
			>
				<span class="icon-[mingcute--mic-line] size-6"></span>
				Lyrics
			</button>
			<button
				class="flex flex-col items-center gap-1 text-xs"
				onclick={() => queuePanelOpen.set(true)}
			>
				<span class="icon-[mingcute--playlist-2-line] size-6"></span>
				Queue
			</button>
		</div>
	</div>
</div>

<style>
	.now-safe {
		padding-top: env(safe-area-inset-top);
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>
