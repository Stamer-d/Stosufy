<script>
	import { fade } from 'svelte/transition';
	import { backgroundUrl, colorFromString } from '#lib/stores/data.ts';

	/**
	 * Shows the background of a beatmap set, cross-fading when it changes.
	 * @type {{ setId: number | string | null, title?: string, class?: string, imageClass?: string }}
	 */
	let { setId, title = '', class: className = '', imageClass = '' } = $props();

	let url = $state(null);
	let failed = $state(false);

	$effect(() => {
		const id = setId;
		failed = false;
		if (id == null) {
			url = null;
			return;
		}
		backgroundUrl(id).then((result) => {
			if (setId === id) url = result;
		});
	});
</script>

<div
	class="overflow-hidden {className || 'relative'}"
	style="background-color: {colorFromString(title || String(setId ?? ''))}"
>
	{#key url}
		{#if url && !failed}
			<img
				src={url}
				alt=""
				class="absolute inset-0 size-full object-cover {imageClass}"
				transition:fade={{ duration: 400 }}
				onerror={() => (failed = true)}
			/>
		{/if}
	{/key}
</div>
