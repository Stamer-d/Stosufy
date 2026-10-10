<script>
	import { fade } from 'svelte/transition';
	import BeatmapVideo from './BeatmapVideo.svelte';
	import { backgroundUrls, colorFromString, mapDataStore } from '#lib/stores/data.ts';

	/**
	 * Shows the background of a beatmap set, cross-fading when it changes. With `video`, the
	 * beatmap video plays on top of it while the set is the current song.
	 * @type {{ setId: number | string | null, title?: string, class?: string, imageClass?: string, video?: boolean }}
	 */
	let { setId, title = '', class: className = '', imageClass = '', video = false } = $props();

	let urls = $state([]);
	let attempt = $state(0);
	let url = $derived(urls[attempt] ?? null);
	// Only this set's saved background, so other changes to the song data don't reload it
	let localPath = $derived(setId != null ? ($mapDataStore[setId]?.background ?? null) : null);

	$effect(() => {
		const id = setId;
		void localPath;
		if (id == null) {
			urls = [];
			attempt = 0;
			return;
		}
		backgroundUrls(id).then((result) => {
			if (setId !== id) return;
			// Keep showing the current image when the candidates didn't change
			if (result.join() === urls.join()) return;
			urls = result;
			attempt = 0;
		});
	});
</script>

<div
	class="overflow-hidden {className || 'relative'}"
	style="background-color: {colorFromString(title || String(setId ?? ''))}"
>
	{#key url}
		{#if url}
			<img
				src={url}
				alt=""
				class="absolute inset-0 size-full object-cover {imageClass}"
				transition:fade={{ duration: 400 }}
				onerror={() => attempt++}
			/>
		{/if}
	{/key}
	{#if video}
		<BeatmapVideo {setId} class={imageClass} />
	{/if}
</div>
