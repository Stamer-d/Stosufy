<script>
	// The song playing, above the tabs: tap it for the whole screen player, swipe it for the
	// next or the one before; a thin line shows where the song is
	import {
		queue,
		playing,
		time,
		previewOnly,
		toggle,
		next,
		previous,
		coverUrl,
		playerOpen
	} from './player';
	import { isFavourite, toggleFavourite } from '../lib/stores/favourites';
	import { swipe } from './gestures';

	let song = $derived($queue.songs[$queue.index] ?? null);
	let progress = $derived($time.duration ? Math.min(1, $time.current / $time.duration) : 0);
</script>

{#if song}
	<div class="px-2 pt-2">
		<div class="relative overflow-hidden rounded-xl bg-secondary-300/90 shadow-lg">
			<div
				class="flex items-center gap-2 p-1.5 pr-1"
				use:swipe={{ axis: 'x', onswipe: (direction) => (direction < 0 ? next() : previous()) }}
			>
				<button
					class="min-w-0 flex-1 flex items-center gap-2.5 text-start"
					aria-label="Open the player"
					onclick={() => playerOpen.set(true)}
				>
					<img
						src={coverUrl(song)}
						alt=""
						class="size-10 shrink-0 rounded-md object-cover bg-secondary-400"
					/>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold truncate">{song.title}</span>
						<span class="block text-xs text-white/60 truncate">
							{song.artist}{$previewOnly ? ' · preview' : ''}
						</span>
					</span>
				</button>
				<button
					aria-label={$isFavourite(song) ? 'Unlike' : 'Like'}
					class="size-10 shrink-0 grid place-items-center"
					onclick={() => toggleFavourite(song)}
				>
					<span
						class="{$isFavourite(song)
							? 'icon-[mingcute--heart-fill] text-primary-400'
							: 'icon-[mingcute--heart-line] text-white/80'} size-6"
					></span>
				</button>
				<button
					aria-label={$playing ? 'Pause' : 'Play'}
					class="size-10 shrink-0 grid place-items-center"
					onclick={toggle}
				>
					<span
						class="{$playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-7"
					></span>
				</button>
			</div>
			<div class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-white/15">
				<div class="h-full rounded-full bg-white" style="width: {progress * 100}%"></div>
			</div>
		</div>
	</div>
{/if}
