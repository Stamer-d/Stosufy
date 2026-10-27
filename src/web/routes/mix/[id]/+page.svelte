<script>
	const base = __WEB_BASE__;
	// A mix of the day (made of your playlists' songs, as in the desktop app)
	import { page } from '$app/state';
	import { mixes } from '../../../listening';
	import { play } from '../../../player';
	import { downloadAll, bulk } from '../../../downloads';
	import { songsLength } from '../../../../lib/tracks';
	import SongRow from '../../../SongRow.svelte';
	import Mosaic from '../../../Mosaic.svelte';

	let mix = $derived($mixes.find((m) => m.id === page.params.id) ?? null);
</script>

<header class="relative overflow-hidden">
	<div
		class="absolute inset-0 bg-gradient-to-b from-primary-300/40 via-app/60 to-app pointer-events-none"
	></div>
	<div class="relative px-5 pt-3 pb-3">
		<a href="{base}/" aria-label="Back" class="-ml-2 size-10 grid place-items-center">
			<span class="icon-[mingcute--left-line] size-6"></span>
		</a>
		{#if mix}
			<div class="mt-1 flex justify-center">
				<Mosaic songs={mix.songs} class="size-44 rounded-lg shadow-2xl" />
			</div>
			<h1 class="mt-4 text-2xl font-extrabold leading-tight">{mix.title}</h1>
			<p class="mt-1 text-sm text-white/60">{mix.description}</p>
			<p class="text-sm text-white/60">{mix.songs.length} songs · {songsLength(mix.songs)}</p>
			<div class="mt-3 flex items-center gap-1">
				<button
					aria-label="Download all"
					class="-ml-2 size-10 grid place-items-center text-white/70"
					disabled={!!$bulk}
					onclick={() => downloadAll(mix.songs)}
				>
					<span
						class="{$bulk
							? 'icon-[svg-spinners--ring-resize]'
							: 'icon-[mingcute--arrow-down-circle-line]'} size-7"
					></span>
				</button>
				<button
					aria-label="Shuffle"
					class="ml-auto size-11 grid place-items-center text-white/80"
					onclick={() => play(mix.songs, 0, { shuffled: true })}
				>
					<span class="icon-[mingcute--shuffle-2-line] size-7"></span>
				</button>
				<button
					aria-label="Play"
					class="size-14 grid place-items-center rounded-full bg-primary-300 shadow-lg"
					onclick={() => play(mix.songs, 0)}
				>
					<span class="icon-[mingcute--play-fill] size-7"></span>
				</button>
			</div>
		{:else}
			<p class="mt-10 text-center text-white/60">This mix isn't there today</p>
		{/if}
	</div>
</header>

{#if mix}
	<ol class="px-3">
		{#each mix.songs as song, i (`${song.id}:${song.track ?? 0}`)}
			<SongRow {song} onplay={() => play(mix.songs, i)} />
		{/each}
	</ol>
{/if}
