<script>
	const base = __WEB_BASE__;
	// A mix of the day (made of your playlists' songs, as in the desktop app)
	import { page } from '$app/state';
	import { mixes } from '../../../listening';
	import { play, playing, queue, toggle } from '../../../player';
	import { downloadAll, bulk } from '../../../downloads';
	import { songsLength, sameSong } from '../../../../lib/tracks';
	import SongRow from '../../../SongRow.svelte';
	import PageHeader from '../../../PageHeader.svelte';
	import MixCover from '../../../../lib/components/MixCover.svelte';
	import PlayButton from '../../../../lib/components/PlayButton.svelte';
	import { colorFromString } from '../../../shims/data';

	let mix = $derived($mixes.find((m) => m.id === page.params.id) ?? null);
	let playingThis = $derived(
		$playing && !!mix?.songs.some((song) => sameSong(song, $queue.songs[$queue.index]))
	);
</script>

{#if mix}
	<PageHeader
		color={colorFromString(mix.title)}
		seed={mix.id.length * 7}
		label="Made for you"
		title={mix.title}
		back="{base}/"
		onplay={() => play(mix.songs, 0)}
	>
		{#snippet cover()}
			<MixCover songs={mix.songs} class="size-48 rounded-md shadow-2xl shadow-black/50" />
		{/snippet}
		<p class="mt-2 text-sm text-white/70 line-clamp-2">{mix.description}</p>
		<p class="mt-2 text-sm text-white/70">{mix.songs.length} songs · {songsLength(mix.songs)}</p>
		{#snippet actions()}
			<PlayButton
				playing={playingThis}
				onclick={() => (playingThis ? toggle() : play(mix.songs, 0))}
			/>
			<button
				aria-label="Shuffle"
				class="size-11 grid place-items-center text-white/60"
				onclick={() => play(mix.songs, 0, { shuffled: true })}
			>
				<span class="icon-[mingcute--shuffle-line] size-7"></span>
			</button>
			<button
				aria-label="Download all"
				class="size-11 grid place-items-center text-white/60"
				disabled={!!$bulk}
				onclick={() => downloadAll(mix.songs)}
			>
				<span
					class="{$bulk
						? 'icon-[svg-spinners--ring-resize]'
						: 'icon-[mingcute--download-2-line]'} size-7"
				></span>
			</button>
		{/snippet}
	</PageHeader>
	<ol class="px-2 pb-4">
		{#each mix.songs as song, i (`${song.id}:${song.track ?? 0}`)}
			<SongRow {song} index={i} onplay={() => play(mix.songs, i)} />
		{/each}
	</ol>
{:else}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--magic-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">This mix isn't here today</p>
		<a href="{base}/" class="mt-2 text-sm font-semibold">Go home</a>
	</div>
{/if}
