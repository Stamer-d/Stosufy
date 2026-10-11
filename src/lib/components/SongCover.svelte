<script>
	import { thumbnailUrl, colorFromString, handleImageError } from '#lib/stores/data.ts';

	/**
	 * The small square cover of a beatmap set: the copy saved with the download, or online.
	 * @type {{ setId: number | string, title?: string, class?: string, lazy?: boolean }}
	 */
	let { setId, title = '', class: className = '', lazy = false } = $props();

	let url = $state(null);
	// Lazy covers load once they come near the screen: reading hundreds of files at once
	// (e.g. opening a big playlist) would freeze the app for a moment
	let nearScreen = $state(false);
	let visible = $derived(!lazy || nearScreen);
	let placeholder = $state();

	$effect(() => {
		if (visible || !placeholder) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					nearScreen = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '400px' }
		);
		observer.observe(placeholder);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!visible) return;
		const id = setId;
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
		bind:this={placeholder}
		class="shrink-0 {className}"
		style="background-color: {colorFromString(title || String(setId))}"
	></div>
{/if}
