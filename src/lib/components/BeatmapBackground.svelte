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

	$effect(() => {
		const id = setId;
		// Reload when the original gets saved, e.g. after the download or the backfill
		void $mapDataStore[id]?.background;
		attempt = 0;
		if (id == null) {
			urls = [];
			return;
		}
		backgroundUrls(id).then((result) => {
			if (setId === id) urls = result;
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
