<script>
	import Button from './Button.svelte';
	import { queueSong } from '#lib/stores/audio.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { updateHomeSettings } from '#lib/stores/user.ts';

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
