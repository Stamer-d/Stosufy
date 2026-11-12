<script>
	// The songs heard last, to play again with a click (from there on, as a queue of them)
	import Widget from './MacWidget.svelte';
	import SongCover from '../SongCover.svelte';
	import { recentlyPlayed } from '#lib/stores/mixes.ts';
	import { setSongQueue } from '#lib/stores/audio.ts';

	let songs = $derived($recentlyPlayed.slice(0, 4));
</script>

<Widget size="medium" label="Recently played" icon="icon-[mingcute--history-line]">
	{#if songs.length}
		<div class="grid grid-cols-4 gap-2.5">
			{#each songs as song, index (`${song.id}-${song.track ?? 0}`)}
				<button
					class="min-w-0 text-start cursor-pointer group"
					aria-label="Play {song.title}"
					title="{song.title} · {song.artist}"
					onclick={() => setSongQueue(index, $recentlyPlayed, 'playlist', 'mix:recent')}
				>
					<SongCover
						setId={song.id}
						track={song.track}
						title={song.title}
						class="w-full aspect-square rounded-xl transition group-hover:scale-105"
					/>
					<p class="mt-1.5 text-xs font-semibold truncate">{song.title}</p>
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex-1 grid place-items-center text-center text-sm text-white/65">
			The songs you play show up here
		</div>
	{/if}
</Widget>
