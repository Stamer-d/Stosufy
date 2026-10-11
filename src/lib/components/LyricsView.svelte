<script>
	import { onMount } from 'svelte';
	import { currentSong, songQueue } from '#lib/stores/audio.ts';
	import {
		lyrics,
		lyricsWanted,
		lyricsOffset,
		nudgeLyrics,
		lineAt,
		loadLyrics
	} from '#lib/stores/lyrics.ts';

	let current = $state(-1);
	let container = $state();
	let lines = $derived($lyrics.status === 'found' ? $lyrics.lyrics?.lines : null);
	/** The user scrolled themselves: don't scroll along for a moment */
	let userScrolledAt = 0;

	onMount(() => {
		lyricsWanted.update((n) => n + 1);
		let frame;
		const tick = () => {
			const audio = $songQueue.audio;
			if (audio && lines) {
				const index = lineAt(lines, audio.currentTime + $lyricsOffset);
				if (index !== current) current = index;
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			lyricsWanted.update((n) => n - 1);
		};
	});

	// Keep the sung line in view
	$effect(() => {
		if (current < 0 || !container || Date.now() - userScrolledAt < 3000) return;
		const line = container.querySelector(`[data-line="${current}"]`);
		line?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});

	function seek(line) {
		const audio = $songQueue.audio;
		if (!audio) return;
		audio.currentTime = Math.max(0, line.time - $lyricsOffset);
		userScrolledAt = 0;
		if (audio.paused) audio.play();
	}
</script>

<svelte:window
	onwheel={() => (userScrolledAt = Date.now())}
	ontouchmove={() => (userScrolledAt = Date.now())}
/>

<div class="min-h-full flex flex-col px-10 pb-[40vh]">
	<header class="py-5 flex items-center justify-between gap-4">
		<div class="min-w-0">
			<h1 class="font-bold truncate">{$currentSong.song?.title ?? 'Lyrics'}</h1>
			<p class="text-sm text-secondary-600 truncate">{$currentSong.song?.artist ?? ''}</p>
		</div>
		{#if lines}
			<div
				class="flex items-center gap-1 shrink-0"
				title="Move the lyrics if they're early or late"
			>
				<button
					aria-label="Lyrics earlier"
					class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer"
					onclick={() => nudgeLyrics(-0.5)}
				>
					<span class="icon-[mingcute--minimize-line] size-4"></span>
				</button>
				<span class="w-16 text-center text-xs tabular-nums text-secondary-600">
					{$lyricsOffset
						? `${$lyricsOffset > 0 ? '−' : '+'}${Math.abs($lyricsOffset)} s`
						: 'In sync'}
				</span>
				<button
					aria-label="Lyrics later"
					class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer"
					onclick={() => nudgeLyrics(0.5)}
				>
					<span class="icon-[mingcute--add-line] size-4"></span>
				</button>
			</div>
		{/if}
	</header>

	{#if !$currentSong.song}
		{@render message('icon-[mingcute--mic-line]', 'Play a song to see its lyrics.')}
	{:else if $lyrics.status === 'loading' || $lyrics.status === 'idle'}
		<div class="flex-1 grid place-items-center pt-24">
			<span class="icon-[mingcute--loading-line] size-8 animate-spin text-primary-500"></span>
		</div>
	{:else if $lyrics.status === 'error'}
		{@render message('icon-[mingcute--wifi-off-line]', "Couldn't load the lyrics.", true)}
	{:else if $lyrics.status === 'none' || (!lines && !$lyrics.lyrics?.plain)}
		{@render message(
			'icon-[mingcute--music-2-line]',
			$lyrics.lyrics?.instrumental ? 'This song is instrumental.' : 'No lyrics found for this song.'
		)}
	{:else}
		{#if $lyrics.lyrics.otherVersion}
			<p class="mt-2 text-xs text-secondary-600">
				Synced to another version of the song. If the lines are off, move them with − and +.
			</p>
		{:else if !lines}
			<p class="mt-2 text-xs text-secondary-600">These lyrics aren't synced.</p>
		{/if}

		{#if lines}
			<ol bind:this={container} class="mt-4 flex flex-col gap-1">
				{#each lines as line, index (index)}
					<li data-line={index}>
						<button
							class="py-1.5 text-left text-3xl font-extrabold leading-tight tracking-tight cursor-pointer transition-[color,opacity] duration-300 {index ===
							current
								? 'text-white'
								: index < current
									? 'text-white/50 hover:text-white/80'
									: 'text-white/25 hover:text-white/80'}"
							onclick={() => seek(line)}
						>
							{line.text || '♪'}
						</button>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="mt-8 whitespace-pre-line text-2xl font-bold leading-relaxed text-white/85">
				{$lyrics.lyrics.plain}
			</p>
		{/if}
		<p class="mt-12 text-xs text-secondary-600">
			Lyrics from LRCLIB · {$lyrics.lyrics.source.artist} – {$lyrics.lyrics.source.track}
		</p>
	{/if}
</div>

{#snippet message(icon, text, retry = false)}
	<div class="flex-1 flex flex-col items-center justify-center gap-3 pt-24 text-center">
		<span class="{icon} size-12 text-secondary-600"></span>
		<p class="text-secondary-600">{text}</p>
		{#if retry}
			<button
				class="h-8 px-4 rounded-full bg-white/10 hover:bg-white/15 text-sm font-semibold cursor-pointer"
				onclick={loadLyrics}>Try again</button
			>
		{/if}
	</div>
{/snippet}
