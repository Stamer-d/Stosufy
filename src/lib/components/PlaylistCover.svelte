<script>
	import { colorFromString, getImageUrl } from '#lib/stores/data.ts';

	/** @type {{ playlist: import('#lib/types.ts').Playlist, class?: string, iconClass?: string }} */
	let { playlist, class: className = 'size-12 rounded-md', iconClass = 'size-5' } = $props();

	let failed = $state(false);
</script>

{#if playlist.id == -1}
	<div class="{className} shrink-0 grid place-items-center bg-primary-300">
		<span class="icon-[mingcute--download-2-fill] {iconClass} text-white"></span>
	</div>
{:else if playlist.image_url && !failed}
	<img
		src={getImageUrl(playlist.image_url)}
		alt=""
		class="{className} shrink-0 object-cover"
		onerror={() => (failed = true)}
	/>
{:else}
	<div
		class="{className} shrink-0 grid place-items-center"
		style="background-color: {colorFromString(playlist.title)}"
	>
		<span class="icon-[mingcute--music-2-fill] {iconClass} text-white/80"></span>
	</div>
{/if}
