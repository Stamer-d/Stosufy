<script>
	// The song's lyrics (LRCLIB, as in the desktop app): synced ones follow the song, the line
	// being sung in the middle; tap a line to go there
	import { onMount, tick } from 'svelte';
	import {
		lyrics,
		lyricsWanted,
		shownLyrics,
		lineAt,
		lyricsOffset,
		loadLyrics,
		setLyricsRomaji
	} from '../lib/stores/lyrics';
	import { userSettings } from '../lib/stores/user';
	import { time, seek } from './player';

	onMount(() => {
		lyricsWanted.update((n) => n + 1);
		return () => lyricsWanted.update((n) => n - 1);
	});

	let found = $derived($lyrics.status === 'found' ? $lyrics.lyrics : null);
	let lines = $derived(found?.lines ?? null);
	let current = $derived(lines ? lineAt(lines, $time.current + $lyricsOffset) : -1);
	let list = $state();
	/** The user scrolled: the lines don't follow for a moment */
	let scrolledAt = 0;

	$effect(() => {
		const index = current;
		if (index < 0 || !list || Date.now() - scrolledAt < 4000) return;
		tick().then(() =>
			list
				?.querySelector(`[data-line="${index}"]`)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' })
		);
	});
	const romaji = $derived(!!$userSettings.settings?.lyricsRomaji);
</script>

<div class="flex-1 min-h-0 flex flex-col -mx-2">
	{#if $lyrics.status === 'loading' || $lyrics.status === 'idle'}
		<div class="flex-1 grid place-items-center">
			<span class="icon-[svg-spinners--ring-resize] size-8 text-white/60"></span>
		</div>
	{:else if $lyrics.status === 'error'}
		<div class="flex-1 flex flex-col items-center justify-center gap-3 text-white/60">
			<p>Couldn't load the lyrics</p>
			<button class="h-10 px-4 rounded-full bg-white/10 font-semibold" onclick={loadLyrics}>
				Try again
			</button>
		</div>
	{:else if !found || (found.instrumental && !lines && !found.plain)}
		<div class="flex-1 grid place-items-center text-white/60">
			{found?.instrumental ? 'Instrumental' : 'No lyrics found for this song'}
		</div>
	{:else}
		<div
			bind:this={list}
			class="flex-1 overflow-y-auto overscroll-contain px-2 py-[30%] [mask-image:linear-gradient(transparent,black_15%,black_85%,transparent)]"
			data-no-swipe
			role="region"
			aria-label="Lyrics"
			ontouchmove={() => (scrolledAt = Date.now())}
			onwheel={() => (scrolledAt = Date.now())}
		>
			{#if lines}
				{#each lines as line, i (i)}
					<button
						data-line={i}
						class="block w-full py-1.5 text-start text-2xl font-bold leading-snug transition-colors duration-300 {i ===
						current
							? 'text-white'
							: i < current
								? 'text-white/35'
								: 'text-white/50'}"
						onclick={() => {
							scrolledAt = 0;
							seek(Math.max(0, line.time - $lyricsOffset));
						}}
					>
						{$shownLyrics.lines?.[i] ?? line.text}{#if !line.text}♪{/if}
					</button>
				{/each}
			{:else}
				<p
					class="whitespace-pre-line text-xl font-semibold leading-relaxed text-white/80 select-text"
				>
					{$shownLyrics.plain ?? found.plain}
				</p>
			{/if}
		</div>
		<div class="flex items-center justify-between px-2 pt-2 text-xs text-white/50">
			<span class="truncate">
				{romaji && $shownLyrics.error
					? "Romaji didn't work, try again later · "
					: ''}{found.otherVersion ? 'Lyrics of another version · ' : ''}LRCLIB
			</span>
			{#if $shownLyrics.japanese}
				<button
					class="h-8 px-3 rounded-full {romaji ? 'bg-white text-black' : 'bg-white/10 text-white'}"
					onclick={() => setLyricsRomaji(!romaji)}
				>
					{$shownLyrics.converting ? '…' : 'Romaji'}
				</button>
			{/if}
		</div>
	{/if}
</div>
