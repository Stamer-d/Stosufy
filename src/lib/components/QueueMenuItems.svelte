<script>
	import Button from './Button.svelte';
	import { queueSong } from '#lib/stores/audio.ts';
	import { showToast } from '#lib/stores/toast.ts';

	/** @type {{ song: import('#lib/types.ts').MapSet }} */
	let { song } = $props();

	async function add(next) {
		await queueSong(song, next);
		showToast(next ? `"${song.title}" plays next` : `Added "${song.title}" to the queue`);
	}
</script>

<Button
	type="ghost"
	class="w-full py-3 rounded-sm hover:bg-secondary-400"
	icon="icon-[fa6-solid--arrow-turn-down]"
	on:click={() => add(true)}
>
	Play next
</Button>
<Button
	type="ghost"
	class="w-full py-3 rounded-sm hover:bg-secondary-400"
	icon="icon-[mingcute--playlist-2-line]"
	on:click={() => add(false)}
>
	Add to queue
</Button>
