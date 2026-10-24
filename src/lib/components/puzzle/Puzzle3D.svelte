<script>
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { fetch as httpFetch } from '@tauri-apps/plugin-http';
	import { landSound, sparkleSound, whooshSound } from '#lib/puzzle/sounds.ts';

	/**
	 * The finished puzzle in 3D, over the whole window: the pieces fly in and land, and it can be
	 * turned, zoomed and taken apart. Esc or the cross closes it.
	 * @type {{ puzzle: import('#lib/puzzle/scene3d.ts').Puzzle3D & { title?: string }, onclose: () => void }}
	 */
	let { puzzle, onclose } = $props();

	let canvas = $state();
	let width = $state(0);
	let height = $state(0);
	let scene = $state(null);
	let failed = $state(false);
	let apart = $state(false);
	let spinning = $state(true);
	let assembled = $state(false);

	/**
	 * The picture as the page's own (WebGL can't use other sites' images): online ones are
	 * fetched through the app, which other sites don't block
	 */
	async function ownUrl(url) {
		if (!/^https?:/.test(url)) return { url, own: false };
		const response = await httpFetch(url).catch(() => window.fetch(url));
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return { url: URL.createObjectURL(await response.blob()), own: true };
	}

	let lastKnock = 0;
	onMount(() => {
		let disposed = false;
		let made = null;
		let local = null;
		(async () => {
			try {
				local = await ownUrl(puzzle.url);
				const { createPuzzleScene } = await import('#lib/puzzle/scene3d.ts');
				if (disposed) return;
				made = await createPuzzleScene(
					canvas,
					{ ...puzzle, url: local.url },
					{
						onland: () => {
							// Many landing at once would be a rattle: a knock now and then
							const now = performance.now();
							if (now - lastKnock < 45) return;
							lastKnock = now;
							landSound(0.85 + Math.random() * 0.4);
						},
						onassembled: () => {
							assembled = true;
							sparkleSound();
						},
						onhop: () => whooshSound(true),
						onwhoosh: (out) => whooshSound(out)
					}
				);
				if (disposed) {
					made.dispose();
					return;
				}
				scene = made;
				scene.resize(width, height);
			} catch (error) {
				console.error('Could not show the puzzle in 3D:', error);
				failed = true;
			}
		})();
		const onKey = (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				onclose();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => {
			disposed = true;
			window.removeEventListener('keydown', onKey, true);
			made?.dispose();
			if (local?.own) URL.revokeObjectURL(local.url);
		};
	});

	$effect(() => {
		scene?.resize(width, height);
	});
</script>

<div
	class="fixed inset-0 z-[100020] bg-[#0d0b12]"
	transition:fade={{ duration: 250 }}
	bind:clientWidth={width}
	bind:clientHeight={height}
>
	<canvas bind:this={canvas} class="absolute inset-0 size-full cursor-grab active:cursor-grabbing"
	></canvas>

	{#if !scene && !failed}
		<div class="absolute inset-0 grid place-items-center pointer-events-none">
			<span class="icon-[line-md--loading-loop] size-10 text-white/60"></span>
		</div>
	{/if}
	{#if failed}
		<div class="absolute inset-0 grid place-items-center">
			<p class="text-white/70">Couldn't show this puzzle in 3D.</p>
		</div>
	{/if}

	<div class="absolute top-0 inset-x-0 flex items-center gap-3 px-6 py-4 pointer-events-none">
		<span class="icon-[ri--puzzle-2-line] size-6 text-primary-400"></span>
		<div class="min-w-0">
			<p class="font-bold truncate">{puzzle.title ?? 'Your puzzle'}</p>
			<p class="text-xs text-white/55">
				Drag to turn · scroll to zoom · right drag to move · click a piece
			</p>
		</div>
		<button
			class="ml-auto pointer-events-auto size-10 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 cursor-pointer transition"
			aria-label="Close the 3D view (Esc)"
			title="Close (Esc)"
			onclick={onclose}
		>
			<span class="icon-[mingcute--close-line] size-5"></span>
		</button>
	</div>

	{#if scene && assembled}
		<div
			class="absolute bottom-6 inset-x-0 flex justify-center pointer-events-none"
			in:fly={{ y: 16, duration: 300 }}
		>
			<div
				class="pointer-events-auto flex gap-1 p-1.5 rounded-full bg-black/50 backdrop-blur ring-1 ring-white/10"
			>
				<button
					class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold cursor-pointer transition {apart
						? 'bg-white text-black'
						: 'hover:bg-white/15'}"
					onclick={() => {
						apart = !apart;
						scene.explode(apart);
					}}
				>
					<span class="icon-[mingcute--classify-2-line] size-5"></span>
					{apart ? 'Put together' : 'Take apart'}
				</button>
				<button
					class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold cursor-pointer transition {spinning
						? 'bg-white text-black'
						: 'hover:bg-white/15'}"
					onclick={() => {
						spinning = !spinning;
						scene.setAutoRotate(spinning);
					}}
				>
					<span class="icon-[mingcute--refresh-2-line] size-5"></span>
					Turn by itself
				</button>
				<button
					class="flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold cursor-pointer transition hover:bg-white/15"
					onclick={() => {
						apart = false;
						scene.resetView();
					}}
				>
					<span class="icon-[mingcute--target-line] size-5"></span>
					Back to the start
				</button>
			</div>
		</div>
	{/if}
</div>
