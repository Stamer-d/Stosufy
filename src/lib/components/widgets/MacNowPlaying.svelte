<script>
	import Widget from './MacWidget.svelte';
	import {
		currentSong,
		songQueue,
		playbackTime,
		togglePlayback,
		skipForward,
		skipBackward
	} from '#lib/stores/audio.ts';
	import BeatmapBackground from '../BeatmapBackground.svelte';

	/** @type {{ class?: string }} */
	let { class: className = '' } = $props();

	let progress = $derived(
		$playbackTime.duration ? ($playbackTime.current / $playbackTime.duration) * 100 : 0
	);

	function seek(event) {
		const audio = $songQueue.audio;
		if (!audio?.duration) return;
		const rect = event.currentTarget.getBoundingClientRect();
		audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
	}
</script>

<Widget size="medium" class={className}>
	{#if $currentSong.song}
		<div class="flex gap-4 h-full">
			<BeatmapBackground
				setId={$currentSong.song.id}
				mapId={$currentSong.song?.beatmaps?.[0]?.id}
				title={$currentSong.song.title}
				class="relative size-32 shrink-0 rounded-2xl shadow-lg shadow-black/30"
			/>
			<div class="min-w-0 flex-1 flex flex-col">
				<p class="text-[11px] font-bold uppercase tracking-wide text-primary-500">
					{$currentSong.isPlaying ? 'Now playing' : 'Paused'}
				</p>
				<p class="mt-0.5 font-bold leading-tight line-clamp-2">{$currentSong.song.title}</p>
				<p class="text-sm text-white/65 truncate">{$currentSong.song.artist}</p>
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="mt-auto h-1 rounded-full bg-white/20 cursor-pointer" onclick={seek}>
					<div
						class="h-full rounded-full bg-white transition-[width] duration-500 ease-linear"
						style="width: {progress}%"
					></div>
				</div>
				<div class="mt-2 flex items-center justify-between">
					<button
						aria-label="Previous"
						class="size-8 grid place-items-center text-white/80 hover:text-white cursor-pointer"
						onclick={skipBackward}
					>
						<span class="icon-[mingcute--skip-previous-fill] size-5"></span>
					</button>
					<button
						aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
						class="size-9 grid place-items-center text-white hover:scale-105 transition cursor-pointer"
						onclick={togglePlayback}
					>
						<span
							class="{$currentSong.isPlaying
								? 'icon-[mingcute--pause-fill]'
								: 'icon-[mingcute--play-fill]'} size-7"
						></span>
					</button>
					<button
						aria-label="Next"
						class="size-8 grid place-items-center text-white/80 hover:text-white cursor-pointer"
						onclick={skipForward}
					>
						<span class="icon-[mingcute--skip-forward-fill] size-5"></span>
					</button>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex gap-4 h-full items-center">
			<div class="size-32 shrink-0 rounded-2xl bg-white/10 grid place-items-center">
				<span class="icon-[mingcute--music-2-fill] size-10 text-white/40"></span>
			</div>
			<div>
				<p class="text-[11px] font-bold uppercase tracking-wide text-primary-500">Not playing</p>
				<p class="mt-0.5 font-bold">Nothing playing</p>
				<p class="text-sm text-white/65">Pick a song from your downloads.</p>
			</div>
		</div>
	{/if}
</Widget>
