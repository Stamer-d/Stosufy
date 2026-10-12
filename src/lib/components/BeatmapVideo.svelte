<script>
	import { onDestroy } from 'svelte';
	import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { songQueue, currentSong } from '#lib/stores/audio.ts';
	import { mapDataStore, ensureVideo } from '#lib/stores/data.ts';
	import { userSettings, DEFAULT_APPEARANCE } from '#lib/stores/user.ts';

	/**
	 * The video of the current song, kept in sync with its audio. Shows nothing when the set
	 * isn't the current song, has no video, videos are turned off or the video isn't running.
	 * @type {{ setId: number | string | null, class?: string }}
	 */
	let { setId, class: className = '' } = $props();

	// Re-seek when the video drifts further than this from the audio
	const MAX_DRIFT = 0.2;

	let enabled = $derived($userSettings.settings?.appearance?.video ?? DEFAULT_APPEARANCE.video);
	let isCurrent = $derived(setId != null && $currentSong.song?.id == setId);
	let stored = $derived(isCurrent ? $mapDataStore[setId] : null);
	let videoPath = $derived(enabled ? (stored?.video ?? null) : null);
	let offset = $derived((stored?.videoOffset ?? 0) / 1000);

	// Imported songs keep the video in the osu! folder; make it playable when it's needed
	$effect(() => {
		if (enabled && stored?.videoSource && !stored.video) ensureVideo(String(setId));
	});

	let url = $state(null);
	let video = $state(null);
	let running = $state(false);

	// The video streams from the disk (Tauri's asset protocol): it starts right away instead
	// of after reading the whole file. Reading it into memory is the fallback.
	/** The video that couldn't be streamed */
	let streamFailed = $state(null);
	$effect(() => {
		const path = videoPath;
		url = null;
		if (!path) return;
		if (streamFailed !== path) {
			url = convertFileSrc(path);
			return;
		}
		let objectUrl = null;
		let cancelled = false;
		readFile(path, { baseDir: BaseDirectory.Home })
			.then((data) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
				url = objectUrl;
			})
			.catch((error) => console.warn('Could not load the video', path, error));
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});
	function sync() {
		const audio = $songQueue.audio;
		if (!video || !audio || !video.duration) {
			running = false;
			return;
		}
		const time = audio.currentTime - offset;
		running = time >= 0 && time < video.duration;
		if (!running) {
			if (!video.paused) video.pause();
			return;
		}
		// Speed mods change the speed of the song, the video follows
		if (video.playbackRate !== audio.playbackRate) video.playbackRate = audio.playbackRate;
		if (Math.abs(video.currentTime - time) > MAX_DRIFT) video.currentTime = time;
		if (audio.paused && !video.paused) video.pause();
		else if (!audio.paused && video.paused) video.play().catch(() => {});
	}

	const interval = setInterval(sync, 250);
	onDestroy(() => clearInterval(interval));
</script>

{#if url}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		src={url}
		muted
		playsinline
		preload="auto"
		class="absolute inset-0 size-full object-cover transition-opacity duration-500 {running
			? 'opacity-100'
			: 'opacity-0'} {className}"
		onloadedmetadata={sync}
		onerror={() => {
			if (url?.startsWith('blob:')) return;
			console.warn('Could not stream the video, reading it instead', videoPath);
			streamFailed = videoPath;
		}}
	></video>
{/if}
