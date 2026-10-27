<script>
	// A playlist's cover: its own picture, else four of its songs' covers (once its songs were
	// loaded), else a note; Liked Songs has its heart
	import { playlistSongsCache } from '../lib/stores/playlist';
	import { coverUrl } from './player';

	/** @type {{ playlist: { id: any, image_url?: string | null } | null, id?: any, class?: string, icon?: string }} */
	let {
		playlist,
		id = playlist?.id,
		class: className = 'size-14 rounded-md',
		icon = 'size-6'
	} = $props();

	let mosaic = $derived.by(() => {
		if (playlist?.image_url || id == -2) return [];
		const seen = new Set();
		const covers = [];
		for (const song of $playlistSongsCache[id]?.songs ?? []) {
			if (seen.has(song.id)) continue;
			seen.add(song.id);
			covers.push(coverUrl(song));
			if (covers.length === 4) break;
		}
		return covers.length === 4 ? covers : covers.slice(0, 1);
	});
</script>

{#if id == -2}
	<span
		class="{className} shrink-0 grid place-items-center bg-gradient-to-br from-primary-300 to-primary-700"
	>
		<span class="icon-[mingcute--heart-fill] {icon}"></span>
	</span>
{:else if playlist?.image_url}
	<img src={playlist.image_url} alt="" class="{className} shrink-0 object-cover bg-secondary-300" />
{:else if mosaic.length === 4}
	<span class="{className} shrink-0 grid grid-cols-2 overflow-hidden bg-secondary-300">
		{#each mosaic as src (src)}
			<img {src} alt="" loading="lazy" class="size-full object-cover" />
		{/each}
	</span>
{:else if mosaic.length}
	<img
		src={mosaic[0]}
		alt=""
		loading="lazy"
		class="{className} shrink-0 object-cover bg-secondary-300"
	/>
{:else}
	<span class="{className} shrink-0 grid place-items-center bg-secondary-300">
		<span class="icon-[mingcute--music-2-line] {icon} text-secondary-600"></span>
	</span>
{/if}
