<script>
	// The line being sung now and the next one
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';
	import { songQueue, currentSong } from '#lib/stores/audio.ts';
	import { lyrics, lyricsWanted, lyricsOffset, lineAt, shownLyrics } from '#lib/stores/lyrics.ts';

	let current = $state(-1);
	let lines = $derived($lyrics.status === 'found' ? $lyrics.lyrics?.lines : null);
	const text = (index) =>
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

<Widget size="medium" label="Lyrics" icon="icon-[mingcute--mic-fill]">
	<div class="flex-1 flex flex-col justify-center min-h-0" aria-live="polite">
		{#if !$currentSong.song}
			<p class="text-sm text-white/60">Play a song to see its lyrics.</p>
		{:else if lines}
			{#key current}
				<p
					class="text-xl font-extrabold leading-snug line-clamp-2 animate-[lyric-in_300ms_ease-out]"
				>
					{current >= 0 ? text(current) || '♪' : '♪'}
				</p>
				<p class="mt-1 text-sm font-semibold text-white/50 line-clamp-1">
					{text(current + 1) || ' '}
				</p>
			{/key}
		{:else if $lyrics.status === 'loading'}
			<p class="text-sm text-white/60">Looking for the lyrics…</p>
		{:else}
			<p class="text-sm text-white/60">No lyrics for this song.</p>
		{/if}
	</div>
</Widget>
