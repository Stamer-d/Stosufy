<script module>
	const loadable = new Map();

	/**
	 * The first of the candidate images that loads, decoded and ready to show. Trying them
	 * out of sight avoids fading in an image that turns out to be missing (e.g. no raw.jpg).
	 */
	function firstLoadable(candidates) {
		const key = candidates.join(' ');
		if (!loadable.has(key)) {
			loadable.set(
				key,
				(async () => {
					for (const candidate of candidates) {
						const image = new Image();
						image.src = candidate;
						try {
							await image.decode();
							return candidate;
						} catch {
							// Missing or broken: try the next one
						}
					}
					// Nothing loaded (e.g. offline): try again next time
					loadable.delete(key);
					return null;
				})()
			);
		}
		return loadable.get(key);
	}
</script>

<script>
	import { fade } from 'svelte/transition';
	import BeatmapVideo from './BeatmapVideo.svelte';
	import { backgroundUrls, colorFromString, mapDataStore } from '#lib/stores/data.ts';
	import { currentSong } from '#lib/stores/audio.ts';

	/**
	 * Shows the background of a beatmap set, cross-fading when it changes. With `video`, the
	 * beatmap video plays on top of it while the set is the current song.
	 * @type {{ setId: number | string | null, title?: string, class?: string, imageClass?: string, video?: boolean, mapId?: number | string | null, beat?: boolean }}
	 */
	let {
		setId,
		mapId = null,
		title = '',
		class: className = '',
		imageClass = '',
		video = false,
		beat = false
	} = $props();

	// Beat effects only for the song that is playing
	let pulsing = $derived(beat && setId != null && $currentSong.song?.id == setId);

	let url = $state(null);
	// Only this set's saved background, so other changes to the song data don't reload it
	let localPath = $derived(
		setId != null
			? (mapId != null && $mapDataStore[setId]?.beatmaps?.[mapId]?.background) ||
					($mapDataStore[setId]?.background ?? null)
			: null
	);

	// The images shown, the newest on top; the older ones go once the newest has faded in
	let layers = $state([]);
	let layerId = 0;
	let cleanup;
	$effect(() => {
		const next = url;
		if (next === (layers.at(-1)?.url ?? null)) return;
		if (!next) {
			layers = [];
			return;
		}
		const id = ++layerId;
		layers = [...layers, { id, url: next }];
		clearTimeout(cleanup);
		cleanup = setTimeout(() => (layers = layers.filter((layer) => layer.id >= id)), 800);
	});

	$effect(() => {
		const id = setId;
		const map = mapId;
		void localPath;
		if (id == null) {
			url = null;
			return;
		}
		// The current image stays until the next one is loaded, so there is only one fade
		backgroundUrls(id, map)
			.then(firstLoadable)
			.then((result) => {
				if (setId === id && mapId === map && result !== url) url = result;
			});
	});
</script>

<div
	class="overflow-hidden transition-[background-color] duration-700 {className || 'relative'}"
	style="background-color: {colorFromString(title || String(setId ?? ''))}"
>
	<div class="absolute inset-0 {pulsing ? 'beat-bump' : ''}">
		<!-- The new image fades in over the old one, which goes once it's covered -->
		{#each layers as layer (layer.id)}
			<img
				src={layer.url}
				alt=""
				class="absolute inset-0 size-full object-cover {imageClass}"
				in:fade={{ duration: 700 }}
			/>
		{/each}
		{#if video}
			<BeatmapVideo {setId} class={imageClass} />
		{/if}
	</div>
	{#if pulsing}
		<!-- Lights up on the beat in kiai time -->
		<div
			class="kiai-glow absolute inset-0 pointer-events-none mix-blend-soft-light bg-[radial-gradient(circle_at_center,white,transparent_75%)]"
		></div>
	{/if}
</div>
