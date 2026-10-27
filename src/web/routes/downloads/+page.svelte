<script>
	// The songs kept on the phone: they play without a connection
	import { play } from '../../player';
	import { downloadedSongs, removeAllDownloads } from '../../downloads';
	import { songsLength } from '../../../lib/tracks';
	import SongRow from '../../SongRow.svelte';

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

<header class="px-5 pt-6 pb-3">
	<h1 class="text-3xl font-extrabold">Downloads</h1>
	<p class="text-sm text-secondary-600">
		{$downloadedSongs.length} songs{$downloadedSongs.length
			? ` · ${songsLength($downloadedSongs)}`
			: ''}{usage ? ` · ${usage}` : ''}
	</p>
	{#if $downloadedSongs.length}
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				class="h-10 px-5 rounded-full bg-primary-300 font-semibold flex items-center gap-2"
				onclick={() => play($downloadedSongs, 0)}
			>
				<span class="icon-[mingcute--play-fill] size-5"></span> Play
			</button>
			<button
				class="h-10 px-5 rounded-full bg-white/10 font-semibold flex items-center gap-2"
				onclick={() => play($downloadedSongs, 0, { shuffled: true })}
			>
				<span class="icon-[mingcute--shuffle-2-line] size-5"></span> Shuffle
			</button>
			<button
				class="ml-auto h-10 px-3 text-sm {confirmClear ? 'text-red-400' : 'text-secondary-600'}"
				onclick={clear}
				onblur={() => (confirmClear = false)}
			>
				{confirmClear ? 'Tap again to remove all' : 'Remove all'}
			</button>
		</div>
	{/if}
</header>

{#if !$downloadedSongs.length}
	<div class="px-8 py-12 flex flex-col items-center text-center gap-2 text-secondary-600">
		<span class="icon-[mingcute--download-2-line] size-10"></span>
		<p>Songs you download play here without a connection.</p>
		<p class="text-sm">In a playlist: ⋯ → Download, or Download all.</p>
	</div>
{/if}

<ul class="px-3">
	{#each $downloadedSongs as song, i (song.beatmaps?.[0]?.id ?? song.id)}
		<SongRow {song} onplay={() => play($downloadedSongs, i)} />
	{/each}
</ul>
