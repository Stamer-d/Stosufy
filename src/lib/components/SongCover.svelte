<script>
	import { thumbnailUrl, colorFromString, handleImageError } from '#lib/stores/data.ts';

	/**
	 * The small square cover of a beatmap set: the copy saved with the download, or online.
	 * @type {{ setId: number | string, title?: string, class?: string, lazy?: boolean }}
	 */
	let { setId, title = '', class: className = '', lazy = false } = $props();

	let url = $state(null);

	$effect(() => {
		const id = setId;
		url = null;
		thumbnailUrl(id).then((result) => {
			if (setId === id) url = result;
		});
	});
</script>

{#if url}
	<img
		src={url}
		alt=""
		loading={lazy ? 'lazy' : 'eager'}
		class="object-cover shrink-0 {className}"
		onerror={handleImageError}
	/>
{:else}
	<div
		class="shrink-0 {className}"
		style="background-color: {colorFromString(title || String(setId))}"
	></div>
{/if}
