<script>
	// The player on the whole screen: the cover (or the lyrics, or what comes next), where
	// the song is, shuffle and repeat, the sleep timer. Swipe it down to close it, swipe the
	// cover for the next song or the one before.
	import {
		queue,
		playing,
		time,
		previewOnly,
		shuffle,
		repeat,
		playerOpen,
		toggle,
		next,
		previous,
		seek,
		jumpTo,
		removeFromQueue,
		toggleShuffle,
		cycleRepeat,
		bigCoverUrl,
		coverUrl,
		sleepTimer,
		autoplay,
		toggleAutoplay
	} from './player';
	import Lyrics from './Lyrics.svelte';
	import { songMenu } from './library';
	import { swipe } from './gestures';
	import { fly } from 'svelte/transition';
	import { isFavourite, toggleFavourite } from '../lib/stores/favourites';

	let song = $derived($queue.songs[$queue.index] ?? null);
	let upNext = $derived(
		$queue.songs.slice($queue.index + 1, $queue.index + 51).map((s, i) => ({
			song: s,
			at: $queue.index + 1 + i
		}))
	);
	/** What's in the middle: the cover, the lyrics or what comes next */
	let view = $state('cover');
	const toggleView = (which) => (view = view === which ? 'cover' : which);
	/** Where the finger has the position slider (it seeks once let go) */
	let dragging = $state(null);

	// The sleep timer: what's left of it, looked at every 15 s
	let choosingSleep = $state(false);
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(timer);
	});
	let sleepLabel = $derived(
		!$sleepTimer
			? ''
			: 'endOfSong' in $sleepTimer
				? 'End of song'
				: `${Math.max(1, Math.ceil(($sleepTimer.at - now) / 60_000))} min`
	);
	const SLEEP_MINUTES = [15, 30, 45, 60, 90];
	function setSleep(minutes) {
		choosingSleep = false;
		now = Date.now();
		sleepTimer.set(
			minutes === 'song'
				? { endOfSong: true }
				: minutes
					? { at: Date.now() + minutes * 60_000 }
					: null
		);
	}
	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
	const close = () => playerOpen.set(false);

	$effect(() => {
		if (!song) close();
	});
</script>

{#if $playerOpen && song}
	<!-- (swiped down, it closes) -->
	<div
		class="fixed inset-0 z-30 flex flex-col bg-app pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
		transition:fly={{ y: 900, duration: 280, opacity: 1 }}
		use:swipe={{ axis: 'y', only: 1, onswipe: close }}
	>
		<img
			src={bigCoverUrl(song)}
			alt=""
			class="absolute inset-0 size-full object-cover opacity-25 blur-3xl scale-110 pointer-events-none"
		/>
		<div class="relative flex items-center justify-between px-3 py-2">
			<button aria-label="Close" class="size-11 grid place-items-center" onclick={close}>
				<span class="icon-[mingcute--down-line] size-7"></span>
			</button>
			<p class="text-xs font-bold uppercase tracking-wide text-white/70">
				{view === 'queue' ? 'Up next' : view === 'lyrics' ? 'Lyrics' : 'Playing'}
			</p>
			<button
				aria-label="More"
				class="size-11 grid place-items-center"
				onclick={() => songMenu.set({ song })}
			>
				<span class="icon-[mingcute--more-2-fill] size-6"></span>
			</button>
		</div>

		<div class="relative flex-1 min-h-0 px-6 flex flex-col">
			{#if view === 'lyrics'}
				<Lyrics />
			{:else if view === 'queue'}
				<button
					class="-mx-1 mb-1 px-1 py-2 flex items-center justify-between text-start"
					role="switch"
					aria-checked={$autoplay}
					onclick={toggleAutoplay}
				>
					<span>
						<span class="block text-sm font-semibold">Autoplay</span>
						<span class="block text-xs text-white/60">Songs like these play on at the end</span>
					</span>
					<span
						class="relative w-11 h-6 shrink-0 rounded-full transition {$autoplay
							? 'bg-primary-400'
							: 'bg-white/20'}"
					>
						<span
							class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {$autoplay
								? 'translate-x-5'
								: ''}"
						></span>
					</span>
				</button>
				<ol class="flex-1 overflow-y-auto overscroll-contain -mx-3" data-no-swipe>
					{#each upNext as { song: upcoming, at } (at)}
						<li class="flex items-center">
							<button
								class="min-w-0 flex-1 flex items-center gap-3 p-2 text-start rounded-lg active:bg-white/5"
								onclick={() => jumpTo(at)}
							>
								<img
									src={coverUrl(upcoming)}
									alt=""
									loading="lazy"
									class="size-10 rounded object-cover bg-secondary-300"
								/>
								<span class="min-w-0">
									<span class="block truncate font-semibold">{upcoming.title}</span>
									<span class="block truncate text-sm text-white/60">{upcoming.artist}</span>
								</span>
							</button>
							<button
								aria-label="Take {upcoming.title} out of the queue"
								class="size-10 grid place-items-center text-white/60"
								onclick={() => removeFromQueue(at)}
							>
								<span class="icon-[mingcute--close-line] size-5"></span>
							</button>
						</li>
					{:else}
						<li class="p-4 text-sm text-white/60">Nothing after this song</li>
					{/each}
				</ol>
			{:else}
				<div
					class="flex-1 min-h-0 grid place-items-center"
					use:swipe={{ axis: 'x', onswipe: (direction) => (direction < 0 ? next() : previous()) }}
				>
					<img
						src={bigCoverUrl(song)}
						alt=""
						class="w-full max-h-full aspect-square object-cover rounded-xl shadow-2xl bg-secondary-300"
					/>
				</div>
			{/if}

			<div class="mt-6 flex items-center gap-3">
				<div class="min-w-0 flex-1">
					<p class="text-xl font-bold truncate">{song.title}</p>
					<p class="text-white/60 truncate">
						{song.artist}{$previewOnly ? ' · preview' : ''}
					</p>
				</div>
				<button
					aria-label={$isFavourite(song) ? 'Unlike' : 'Like'}
					class="size-11 grid place-items-center"
					onclick={() => toggleFavourite(song)}
				>
					<span
						class="{$isFavourite(song)
							? 'icon-[mingcute--heart-fill] text-primary-400'
							: 'icon-[mingcute--heart-line]'} size-7"
					></span>
				</button>
			</div>

			<input
				type="range"
				min="0"
				max={$time.duration || 0}
				step="1"
				value={dragging ?? $time.current}
				oninput={(e) => (dragging = Number(e.currentTarget.value))}
				onchange={(e) => {
					seek(Number(e.currentTarget.value));
					dragging = null;
				}}
				class="mt-4 w-full accent-white"
				aria-label="Position"
			/>
			<div class="flex justify-between text-xs text-white/60 tabular-nums">
				<span>{clock(dragging ?? $time.current)}</span>
				<span>{clock($time.duration)}</span>
			</div>

			<div class="mt-3 flex items-center justify-between">
				<button
					aria-label="Shuffle"
					aria-pressed={$shuffle}
					class="size-12 grid place-items-center {$shuffle ? 'text-primary-400' : 'text-white/70'}"
					onclick={toggleShuffle}
				>
					<span class="icon-[mingcute--shuffle-2-line] size-6"></span>
				</button>
				<button aria-label="Back" class="size-14 grid place-items-center" onclick={previous}>
					<span class="icon-[mingcute--skip-previous-fill] size-9"></span>
				</button>
				<button
					aria-label={$playing ? 'Pause' : 'Play'}
					class="size-18 grid place-items-center rounded-full bg-white text-black"
					onclick={toggle}
				>
					<span
						class="{$playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-9"
					></span>
				</button>
				<button aria-label="Next" class="size-14 grid place-items-center" onclick={() => next()}>
					<span class="icon-[mingcute--skip-forward-fill] size-9"></span>
				</button>
				<button
					aria-label="Repeat: {$repeat}"
					class="size-12 grid place-items-center {$repeat !== 'off'
						? 'text-primary-400'
						: 'text-white/70'}"
					onclick={cycleRepeat}
				>
					<span
						class="{$repeat === 'one'
							? 'icon-[mingcute--repeat-one-line]'
							: 'icon-[mingcute--repeat-line]'} size-6"
					></span>
				</button>
			</div>

			<div class="relative mt-2 flex justify-between">
				<button
					aria-label="Sleep timer"
					class="h-11 px-2 flex items-center gap-1.5 text-sm {$sleepTimer
						? 'text-primary-400'
						: 'text-white/70'}"
					onclick={() => (choosingSleep = !choosingSleep)}
				>
					<span class="icon-[mingcute--moon-line] size-6"></span>
					{sleepLabel}
				</button>
				{#if choosingSleep}
					<div
						class="absolute bottom-12 left-0 z-10 w-48 py-1 rounded-xl bg-secondary-300 shadow-2xl ring-1 ring-white/10"
					>
						{#each SLEEP_MINUTES as minutes (minutes)}
							<button
								class="w-full px-4 py-2.5 text-start active:bg-white/5"
								onclick={() => setSleep(minutes)}
							>
								In {minutes} minutes
							</button>
						{/each}
						<button
							class="w-full px-4 py-2.5 text-start active:bg-white/5"
							onclick={() => setSleep('song')}
						>
							At the end of the song
						</button>
						{#if $sleepTimer}
							<button
								class="w-full px-4 py-2.5 text-start text-red-400 active:bg-white/5"
								onclick={() => setSleep(null)}
							>
								Turn off
							</button>
						{/if}
					</div>
				{/if}
				<div class="flex">
					<button
						aria-label="Lyrics"
						aria-pressed={view === 'lyrics'}
						class="size-11 grid place-items-center {view === 'lyrics'
							? 'text-primary-400'
							: 'text-white/70'}"
						onclick={() => toggleView('lyrics')}
					>
						<span class="icon-[mingcute--mic-line] size-6"></span>
					</button>
					<button
						aria-label="Up next"
						aria-pressed={view === 'queue'}
						class="size-11 grid place-items-center {view === 'queue'
							? 'text-primary-400'
							: 'text-white/70'}"
						onclick={() => toggleView('queue')}
					>
						<span class="icon-[mingcute--playlist-line] size-6"></span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
