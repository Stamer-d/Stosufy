<script>
	// The song's background, blurred, behind the app or the full player (as in the desktop
	// app). Cheap for a phone: a small cover, blurred at a quarter of the size and scaled up;
	// a new song's comes in only once it's loaded (no black in between).
	/** @type {{ song: import('../lib/types').MapSet | null, dim?: number }} */
	let { song, dim = 0.75 } = $props();

	/** The pictures shown: the one of now on top, the one before fading out under it */
	let layers = $state([]);
	let seen = 0;

	$effect(() => {
		const id = song?.id;
		if (!id) return;
		if (layers.at(-1)?.id === id) return;
		const url = `https://assets.ppy.sh/beatmaps/${id}/covers/list@2x.jpg`;
		const image = new Image();
		image.onload = () => {
			if (song?.id !== id) return;
			const key = ++seen;
			layers = [...layers.slice(-1), { id, url, key, shown: false }];
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
	<div class="absolute top-0 left-0 w-1/4 h-1/4 origin-top-left scale-400">
		{#each layers as layer (layer.key)}
			<img
				src={layer.url}
				alt=""
				class="absolute inset-0 size-full object-cover blur-[6px] scale-125 transition-opacity duration-700"
				style="opacity: {layer.shown ? 1 : 0}"
				ontransitionend={() => {
					if (layer.shown && layers.at(-1)?.key === layer.key && layers.length > 1)
						layers = layers.slice(-1);
				}}
			/>
		{/each}
	</div>
	<div class="absolute inset-0 bg-app" style="opacity: {dim}"></div>
</div>
