<script>
	import { haptic } from './haptics';
	// The bar at the bottom, the song bar of the desktop app on a phone: the song playing
	// (tap it for the whole screen player, swipe it for the next one or the one before) and the
	// tabs
	import SongCover from '../lib/components/SongCover.svelte';
	import { queue, playing, time, previewOnly, toggle, playerOpen } from './player';
	import { isFavourite, toggleFavourite } from '../lib/stores/favourites';
	import SongSwipe from './SongSwipe.svelte';
	import { TABS, currentTab, openTab } from './navigation';

	let song = $derived($queue.songs[$queue.index] ?? null);
	let progress = $derived($time.duration ? Math.min(1, $time.current / $time.duration) : 0);
</script>

<div
	class="fixed inset-x-0 bottom-0 z-20 bg-app border-t border-white/[0.06] pb-[env(safe-area-inset-bottom)]"
>
	{#if song}
		<div class="relative">
			<div class="absolute inset-x-0 top-0 h-0.5 bg-white/10 overflow-hidden">
				<div class="h-full origin-left bg-primary-400" style="transform: scaleX({progress})"></div>
			</div>
			<div class="flex items-center gap-1 pl-3 pr-2 pt-2.5 pb-2">
				<SongSwipe class="min-w-0 flex-1">
					{#snippet item(shown)}
						<button
							class="w-full flex items-center gap-3 text-start"
							aria-label="Open the player"
							onclick={() => playerOpen.set(true)}
						>
							<SongCover
								setId={shown.id}
								track={shown.track}
								title={shown.title}
								class="size-11 rounded-md shadow-md shadow-black/30"
							/>
							<span class="min-w-0 flex-1 pr-2">
								<span class="block text-sm font-semibold truncate">{shown.title}</span>
								<span class="block text-xs text-secondary-600 truncate">
									{shown.artist}{$previewOnly && shown === song ? ' · preview' : ''}
								</span>
							</span>
						</button>
					{/snippet}
				</SongSwipe>
				<button
					aria-label={$isFavourite(song) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
					class="size-10 shrink-0 grid place-items-center"
					onclick={() => {
						haptic();
						toggleFavourite(song);
					}}
				>
					<span
						class="{$isFavourite(song)
							? 'icon-[mingcute--heart-fill] text-primary-500'
							: 'icon-[mingcute--heart-line] text-secondary-600'} size-[22px]"
					></span>
				</button>
				<button
					aria-label={$playing ? 'Pause' : 'Play'}
					class="size-10 shrink-0 grid place-items-center rounded-full bg-white text-black active:scale-95 transition"
					onclick={() => {
						haptic();
						toggle();
					}}
				>
					<span
						class="{$playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
					></span>
				</button>
			</div>
		</div>
	{/if}
	<nav class="flex px-2">
		{#each TABS as tab (tab.id)}
			{@const active = $currentTab === tab.id}
			<button
				class="relative flex-1 flex flex-col items-center gap-0.5 pt-1.5 pb-1 text-[10px] font-semibold transition-colors {active
					? 'text-white'
					: 'text-secondary-600'}"
				aria-current={active ? 'page' : undefined}
				onclick={() => openTab(tab.id)}
			>
				<span class="{active ? tab.activeIcon : tab.icon} size-6"></span>
				{tab.label}
			</button>
		{/each}
	</nav>
</div>
