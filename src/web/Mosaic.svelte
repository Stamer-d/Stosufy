<script>
	// Four songs' covers as one (a mix's cover)
	import { coverUrl } from './player';

	/** @type {{ songs: import('../lib/types').MapSet[], class?: string }} */
	let { songs, class: className = 'size-32 rounded-lg' } = $props();

	let covers = $derived.by(() => {
		const seen = new Set();
		const found = [];
		for (const song of songs) {
			if (seen.has(song.id)) continue;
			seen.add(song.id);
			found.push(coverUrl(song));
			if (found.length === 4) break;
		}
		return found;
	});
</script>

{#if covers.length === 4}
	<span class="{className} shrink-0 grid grid-cols-2 overflow-hidden bg-secondary-300">
		{#each covers as src (src)}
			<img {src} alt="" loading="lazy" class="size-full object-cover" />
		{/each}
	</span>
{:else}
	<img
		src={covers[0] ?? ''}
		alt=""
		loading="lazy"
		class="{className} shrink-0 object-cover bg-secondary-300"
	/>
{/if}
