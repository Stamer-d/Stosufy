<script>
	// The songs kept on the phone: they play without a connection
	import { play } from '../../player';
	import { downloadedSongs, removeAllDownloads } from '../../downloads';
	import { songsLength } from '../../../lib/tracks';
	import SongRow from '../../SongRow.svelte';
	import PageHeader from '../../PageHeader.svelte';
	import PlaylistCover from '../../../lib/components/PlaylistCover.svelte';
	import PlayButton from '../../../lib/components/PlayButton.svelte';
	import { nearView } from '../../visible';

	let limit = $state(100);

	let usage = $state('');
	let confirmClear = $state(false);

	$effect(() => {
		void $downloadedSongs;
		navigator.storage
			?.estimate?.()
			.then(({ usage: used = 0, quota = 0 }) => {
				usage = `${(used / 1e9).toFixed(2)} GB of ${(quota / 1e9).toFixed(1)} GB used`;
			})
			.catch(() => {});
	});

	async function clear() {
		if (!confirmClear) {
			confirmClear = true;
			return;
		}
		confirmClear = false;
		await removeAllDownloads();
	}
</script>

<PageHeader
	color="oklch(0.42 0.17 300)"
	seed={3}
	label="On this phone"
	title="Downloaded Songs"
	onplay={$downloadedSongs.length ? () => play($downloadedSongs, 0) : undefined}
>
	{#snippet cover()}
		<PlaylistCover
			playlist={{ id: -1, title: 'Downloaded Songs', song_amount: 0 }}
			class="size-48 rounded-md shadow-2xl shadow-black/50"
			iconClass="size-16"
		/>
	{/snippet}
	<p class="mt-2 text-sm text-white/70">Your songs that play without a connection</p>
	<p class="mt-2 text-sm text-white/70">
		{$downloadedSongs.length} songs{$downloadedSongs.length
			? ` · ${songsLength($downloadedSongs)}`
			: ''}{usage ? ` · ${usage}` : ''}
	</p>
	{#snippet actions()}
		<PlayButton disabled={!$downloadedSongs.length} onclick={() => play($downloadedSongs, 0)} />
		<button
			aria-label="Shuffle"
			class="size-10 grid place-items-center text-white/60"
			disabled={!$downloadedSongs.length}
			onclick={() => play($downloadedSongs, 0, { shuffled: true })}
		>
			<span class="icon-[mingcute--shuffle-line] size-7"></span>
		</button>
		{#if $downloadedSongs.length}
			<button
				class="ml-auto h-9 px-3 rounded-full text-sm {confirmClear
					? 'bg-red-500/20 text-red-300'
					: 'bg-white/[0.06] text-secondary-600'}"
				onclick={clear}
				onblur={() => (confirmClear = false)}
			>
				{confirmClear ? 'Tap again to remove all' : 'Remove all'}
			</button>
		{/if}
	{/snippet}
</PageHeader>

{#if !$downloadedSongs.length}
	<div class="px-8 py-12 flex flex-col items-center text-center gap-2 text-secondary-600">
		<span class="icon-[mingcute--download-2-line] size-10"></span>
		<p>Songs you download play here without a connection.</p>
		<p class="text-sm">In a playlist: the ⤓ next to Play, or ⋯ → Download on a song.</p>
	</div>
{/if}

<ol class="px-2 pb-4">
	{#each $downloadedSongs.slice(0, limit) as song, i (song.beatmaps?.[0]?.id ?? song.id)}
		<SongRow {song} index={i} onplay={() => play($downloadedSongs, i)} />
	{/each}
</ol>
{#if $downloadedSongs.length > limit}
	<!-- (made again each time: it calls back once it comes near) -->
	{#key limit}
		<div use:nearView={() => (limit += 100)} class="h-20"></div>
	{/key}
{/if}
