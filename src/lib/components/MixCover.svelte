<script>
	import SongCover from './SongCover.svelte';

	/**
	 * The cover of a mix: the covers of its first four sets in a square (one, with fewer)
	 * @type {{ songs: import('#lib/types.ts').MapSet[], class?: string }}
	 */
	let { songs, class: className = '' } = $props();

	let covers = $derived.by(() => {
		const sets = new Map();
		for (const song of songs) {
			if (!sets.has(song.id)) sets.set(song.id, song);
			if (sets.size === 4) break;
		}
		const list = [...sets.values()];
		return list.length === 4 ? list : list.slice(0, 1);
	});
</script>

<div class="grid overflow-hidden bg-white/5 {covers.length === 4 ? 'grid-cols-2' : ''} {className}">
	{#each covers as song (song.id)}
		<SongCover
			setId={song.id}
			track={song.track}
			title={song.title}
			class="size-full aspect-square"
			lazy
		/>
	{/each}
</div>
