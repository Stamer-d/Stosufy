<script>
	// The song's background, blurred, behind the app or the full player (as in the desktop
	// app). Cheap for a phone: the cover drawn once into a tiny picture (24×24) that's shown
	// stretched, which blurs it: no blur filter the graphics chip would work out again on
	// every frame something moves over it. A new song's comes in only once it's loaded.
	import { untrack } from 'svelte';

	/** @type {{ song: import('../lib/types').MapSet | null, dim?: number }} */
	let { song, dim = 0.75 } = $props();

	/** The pictures shown: the one of now on top, the one before fading out under it */
	let layers = $state([]);
	let seen = 0;
	const SIZE = 24;

	/** Draws the cover small into the canvas (only shown: it's never read back) */
	function paint(canvas, image) {
		const context = canvas.getContext('2d');
		if (!context) return;
		// The middle of the cover, filling the square
		const side = Math.min(image.naturalWidth, image.naturalHeight);
		context.drawImage(
			image,
			(image.naturalWidth - side) / 2,
			(image.naturalHeight - side) / 2,
			side,
			side,
			0,
			0,
			SIZE,
			SIZE
		);
	}

	$effect(() => {
		const id = song?.id;
		if (!id) return;
		if (untrack(() => layers.at(-1)?.id) === id) return;
		const url = `https://assets.ppy.sh/beatmaps/${id}/covers/list@2x.jpg`;
		const image = new Image();
		image.onload = () => {
			if (song?.id !== id) return;
			const key = ++seen;
			layers = [...layers.slice(-1), { id, image, key, shown: false }];
			// (shown the frame after it's there, so it fades in)
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					layers = layers.map((layer) => (layer.key === key ? { ...layer, shown: true } : layer));
				})
			);
		};
		image.src = url;
	});
</script>

<div class="absolute inset-0 overflow-hidden bg-app pointer-events-none" aria-hidden="true">
	{#each layers as layer (layer.key)}
		<canvas
			width={SIZE}
			height={SIZE}
			use:paint={layer.image}
			class="absolute -inset-[10%] size-[120%] transition-opacity duration-700"
			style="opacity: {layer.shown ? 1 : 0}"
			ontransitionend={() => {
				if (layer.shown && layers.at(-1)?.key === layer.key && layers.length > 1)
					layers = layers.slice(-1);
			}}
		></canvas>
	{/each}
	<div class="absolute inset-0 bg-app" style="opacity: {dim}"></div>
</div>
