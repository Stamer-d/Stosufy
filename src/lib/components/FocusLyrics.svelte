<script>
	// The line being sung and the next one, big, for the focus view
	import { onMount } from 'svelte';
	import { songQueue } from '#lib/stores/audio.ts';
	import { lyrics, lyricsWanted, lyricsOffset, lineAt, shownLyrics } from '#lib/stores/lyrics.ts';

	let current = $state(-1);
	let lines = $derived($lyrics.status === 'found' ? $lyrics.lyrics?.lines : null);
	/** A line's text as shown (romaji when turned on) */
	let text = (index) =>
		($shownLyrics.key === $lyrics.key && $shownLyrics.lines?.[index]) || lines?.[index]?.text;

	onMount(() => {
		lyricsWanted.update((n) => n + 1);
		let frame;
		const tick = () => {
			const audio = $songQueue.audio;
			if (audio && lines) current = lineAt(lines, audio.currentTime + $lyricsOffset);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			lyricsWanted.update((n) => n - 1);
		};
	});
</script>

{#if lines}
	<div class="text-center select-none" aria-live="polite">
		{#key current}
			<p
				class="text-5xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.6)] animate-[lyric-in_300ms_ease-out]"
			>
				{current >= 0 ? text(current) || '♪' : ' '}
			</p>
			<p class="mt-3 text-2xl font-bold text-white/50 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
				{text(current + 1) || ' '}
			</p>
		{/key}
	</div>
{/if}

<style>
	@keyframes -global-lyric-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
