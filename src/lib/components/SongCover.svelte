<script>
	import { thumbnailUrl, colorFromString, handleImageError } from '#lib/stores/data.ts';

	/**
	 * The small square cover of a beatmap set: the copy saved with the download, or online.
	 * The songs of a set with several (track) show their own background.
	 * `large`: a big cover (the web app loads a sharper image for it)
	 * @type {{ setId: number | string, track?: number, title?: string, class?: string, lazy?: boolean, large?: boolean }}
	 */
	let {
		setId,
		track = 0,
		title = '',
		class: className = '',
		lazy = false,
		large = false
	} = $props();

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
		const which = track ?? 0;
		thumbnailUrl(id, which, large).then((result) => {
			if (setId === id && (track ?? 0) === which) url = result;
		});
	});
</script>

{#if url}
	<img
		src={url}
		alt=""
		loading={lazy ? 'lazy' : 'eager'}
		decoding="async"
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
