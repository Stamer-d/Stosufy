<script>
	import Widget from './MacWidget.svelte';
	import BeatmapBackground from '../BeatmapBackground.svelte';
	import { songQueue, upNext, skipForward } from '#lib/stores/audio.ts';

	let next = $derived(
		$upNext[0] ?? $songQueue.queue?.[($songQueue.currentIndex ?? -1) + 1] ?? null
	);
</script>

{#if next}
	<button
		class="text-start cursor-pointer transition hover:scale-[1.02]"
		aria-label="Play next song: {next.title}"
		onclick={skipForward}
	>
		<Widget size="small" class="!p-0">
			<BeatmapBackground setId={next.id} title={next.title} class="absolute inset-0" />
			<div
				class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"
			></div>
			<div class="relative mt-auto p-4">
				<p class="text-[11px] font-bold uppercase tracking-wide text-primary-500">Up next</p>
				<p class="font-bold leading-tight line-clamp-2">{next.title}</p>
				<p class="text-xs text-white/70 truncate">{next.artist}</p>
			</div>
		</Widget>
	</button>
{:else}
	<Widget size="small" label="Up next">
		<div class="flex-1 grid place-items-center text-center text-sm text-white/60">
			Nothing queued
		</div>
	</Widget>
{/if}
