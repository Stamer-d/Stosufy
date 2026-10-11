<script>
	import { onDestroy } from 'svelte';
	import { readFile, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import * as path from '@tauri-apps/api/path';
	import { songQueue, currentSong } from '#lib/stores/audio.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { userSettings, DEFAULT_APPEARANCE } from '#lib/stores/user.ts';
	import { parseStoryboard } from '#lib/storyboard/parse.ts';
	import { createRenderer } from '#lib/storyboard/render.ts';

	/**
	 * The storyboard of the current song, drawn in sync with its audio. Shows nothing when
	 * the set isn't the current song, has no storyboard or storyboards are turned off.
	 * @type {{ setId: number | string | null, mapId?: number | string | null, class?: string }}
	 */
	let { setId, mapId = null, class: className = '' } = $props();

	let enabled = $derived(
		$userSettings.settings?.appearance?.storyboard ?? DEFAULT_APPEARANCE.storyboard
	);
	let isCurrent = $derived(setId != null && $currentSong.song?.id == setId);
	let info = $derived(isCurrent && enabled ? ($mapDataStore[setId]?.storyboard ?? null) : null);
	let osuFile = $derived(
		info && mapId != null ? ($mapDataStore[setId]?.beatmaps?.[mapId]?.osuFile ?? null) : null
	);

	let canvas = $state(null);
	let visible = $state(false);
	let frame = 0;
	onDestroy(() => cancelAnimationFrame(frame));

	const read = (file) =>
		file ? readTextFile(file, { baseDir: BaseDirectory.Home }).catch(() => '') : '';

	$effect(() => {
		const storyboardInfo = info;
		const diffFile = osuFile;
		const target = canvas;
		visible = false;
		if (!storyboardInfo || !target) return;
		let renderer = null;
		let stopped = false;

		(async () => {
			const [osb, osu] = await Promise.all([read(storyboardInfo.osb), read(diffFile)]);
			const storyboard = parseStoryboard(osb, osu);
			if (stopped || !storyboard.sprites.length) return;
			renderer = createRenderer(target, storyboard, async (image) => {
				try {
					const file = await path.join(storyboardInfo.dir, ...image.split('/'));
					const data = await readFile(file, { baseDir: BaseDirectory.Home });
					return await createImageBitmap(new Blob([data]));
				} catch {
					return null;
				}
			});
			if (!renderer) return;
			visible = true;
			const draw = () => {
				const audio = $songQueue.audio;
				if (audio) renderer.draw(audio.currentTime * 1000);
				frame = requestAnimationFrame(draw);
			};
			draw();
		})();

		return () => {
			stopped = true;
			cancelAnimationFrame(frame);
			renderer?.destroy();
		};
	});
</script>

{#if info}
	<canvas
		bind:this={canvas}
		class="absolute inset-0 size-full pointer-events-none transition-opacity duration-500 {visible
			? 'opacity-100'
			: 'opacity-0'} {className}"
	></canvas>
{/if}
