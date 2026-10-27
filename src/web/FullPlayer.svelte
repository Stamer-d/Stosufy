<script>
	// The player on the whole screen: the cover, where the song is, shuffle and repeat, and
	// what comes next (tap one to play it, ✕ takes it out)
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
		coverUrl
	} from './player';
	import { songMenu } from './library';
	import { isFavourite, toggleFavourite } from '../lib/stores/favourites';

	let song = $derived($queue.songs[$queue.index] ?? null);
	let upNext = $derived(
		$queue.songs.slice($queue.index + 1, $queue.index + 51).map((s, i) => ({
			song: s,
			at: $queue.index + 1 + i
		}))
	);
	let showQueue = $state(false);
	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
	const close = () => playerOpen.set(false);

	$effect(() => {
		if (!song) close();
	});
</script>

{#if $playerOpen && song}
	<div
		class="fixed inset-0 z-30 flex flex-col bg-app pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
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
				{showQueue ? 'Up next' : 'Playing'}
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
			{#if showQueue}
				<ol class="flex-1 overflow-y-auto -mx-3">
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
				<div class="flex-1 min-h-0 grid place-items-center">
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
				value={$time.current}
				oninput={(e) => seek(Number(e.currentTarget.value))}
				class="mt-4 w-full accent-white"
				aria-label="Position"
			/>
			<div class="flex justify-between text-xs text-white/60 tabular-nums">
				<span>{clock($time.current)}</span>
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

			<div class="mt-2 flex justify-end">
				<button
					aria-label="Up next"
					aria-pressed={showQueue}
					class="size-11 grid place-items-center {showQueue ? 'text-primary-400' : 'text-white/70'}"
					onclick={() => (showQueue = !showQueue)}
				>
					<span class="icon-[mingcute--playlist-line] size-6"></span>
				</button>
			</div>
		</div>
	</div>
{/if}
