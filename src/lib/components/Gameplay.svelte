<script>
	// The gameplay of the song that plays, like osu!'s autoplay, with the hitsound skin
	import { onMount } from 'svelte';
	import { currentSong, songQueue } from '#lib/stores/audio.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { beatmapContent } from '#lib/hitsounds/player.ts';
	import { skinFolder, skinsChanged, BUILTIN } from '#lib/hitsounds/skins.ts';
	import { parseGameplay } from '#lib/gameplay/beatmap.ts';
	import { loadGameplaySkin, forgetGameplaySkins } from '#lib/gameplay/skin.ts';
	import { createGameplayRenderer } from '#lib/gameplay/render.ts';

	let { class: className = '' } = $props();

	let canvas = $state();
	let renderer = $state(null);
	let message = $state('');

	let song = $derived($currentSong.song);
	let key = $derived(song ? `${song.id}:${song.beatmaps?.[0]?.id}` : null);
	let skinSetting = $derived($userSettings.settings?.hitsoundSkin ?? null);

	$effect(() => {
		$skinsChanged;
		forgetGameplaySkins();
	});

	$effect(() => {
		const current = song;
		const target = canvas;
		const skin = skinSetting;
		void key;
		renderer = null;
		message = '';
		if (!current || !target) return;
		const stored = $mapDataStore[current.id];
		if ($songQueue.type === 'preview' && !current.queued && !stored) {
			message = 'Gameplay shows for downloaded songs';
			return;
		}
		let cancelled = false;
		(async () => {
			const content = await beatmapContent(current).catch(() => null);
			if (cancelled) return;
			const beatmap = content ? parseGameplay(content) : null;
			if (!beatmap) {
				message = content ? 'Gameplay is only for osu!standard maps' : "Couldn't load the beatmap";
				return;
			}
			const dir = skin === BUILTIN ? null : await skinFolder(skin);
			const gameplaySkin = await loadGameplaySkin(dir);
			if (cancelled) return;
			renderer = createGameplayRenderer(target, beatmap, gameplaySkin);
		})();
		return () => (cancelled = true);
	});

	onMount(() => {
		let frame;
		const loop = () => {
			const audio = $songQueue.audio;
			if (renderer && audio) renderer.draw(audio.currentTime * 1000);
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});
</script>

<div class="pointer-events-none {className}">
	<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
	{#if message}
		<p class="absolute bottom-16 left-1/2 -translate-x-1/2 text-sm text-white/70 drop-shadow">
			{message}
		</p>
	{/if}
</div>
