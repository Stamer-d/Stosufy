<script>
	import Button from './Button.svelte';
	import { queueSong, startRadio } from '#lib/stores/audio.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { updateHomeSettings } from '#lib/stores/user.ts';
	import { isFavourite, toggleFavourite } from '#lib/stores/favourites.ts';

	/** @type {{ song: import('#lib/types.ts').MapSet }} */
	let { song } = $props();

	async function add(next) {
		await queueSong(song, next);
		showToast(next ? `"${song.title}" plays next` : `Added "${song.title}" to the queue`);
	}
</script>

<Button
	type="ghost"
	class="w-full rounded-md text-sm hover:bg-secondary-400"
	icon="icon-[mingcute--corner-down-right-line]"
	on:click={() => add(true)}
>
	Play next
</Button>
<Button
	type="ghost"
	class="w-full rounded-md text-sm hover:bg-secondary-400"
	icon="icon-[mingcute--playlist-2-line]"
	on:click={() => add(false)}
>
	Add to queue
</Button>
{#if Number(song?.beatmaps?.[0]?.id) > 0}
	<Button
		type="ghost"
		class="w-full rounded-md text-sm hover:bg-secondary-400"
		icon={$isFavourite(song) ? 'icon-[mingcute--heart-fill]' : 'icon-[mingcute--heart-line]'}
		on:click={() => toggleFavourite(song)}
	>
		{$isFavourite(song) ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
	</Button>
{/if}
<Button
	type="ghost"
	class="w-full rounded-md text-sm hover:bg-secondary-400"
	icon="icon-[mingcute--radio-line]"
	on:click={() => startRadio(song)}
>
	Start radio
</Button>
<Button
	type="ghost"
	class="w-full rounded-md text-sm hover:bg-secondary-400"
	icon="icon-[mingcute--pin-line]"
	on:click={() => {
		updateHomeSettings({ heroBackground: 'pinned', pinnedSetId: song.id });
		showToast(`Pinned "${song.title}" to the home page`);
	}}
>
	Pin to home
</Button>
