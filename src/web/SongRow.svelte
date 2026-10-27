<script>
	// A song of a list, as in the desktop app: its cover, title and artist, and whether it's
	// on the phone or streams. Tap it to play, hold it or ⋯ for what else can be done with it.
	import SongCover from '../lib/components/SongCover.svelte';
	import { queue, playing } from './player';
	import { downloaded, downloading, isDownloaded } from './downloads';
	import { songMenu } from './library';
	import { sameSong } from '../lib/tracks';
	import { offline } from '../lib/stores/network';
	import { showToast } from '../lib/stores/toast';

	/** @type {{ song: import('../lib/types').MapSet, playlistId?: string | number, onplay: () => void, index?: number, extra?: import('svelte').Snippet }} */
	let { song, playlistId, onplay, index, extra } = $props();

	let current = $derived(sameSong($queue.songs[$queue.index], song));
	let kept = $derived(isDownloaded($downloaded, song));
	let busy = $derived($downloading.has(String(song.beatmaps?.[0]?.id)));
	/** Offline, only the downloaded songs play */
	let unavailable = $derived($offline && !kept);

	// Held down: the menu (as ⋯)
	let pressTimer = null;
	let longPressed = false;
	let pressedAt = { x: 0, y: 0 };
	function pressStart(event) {
		longPressed = false;
		pressedAt = { x: event.clientX, y: event.clientY };
		pressTimer = setTimeout(() => {
			longPressed = true;
			songMenu.set({ song, playlistId });
		}, 500);
	}
	function pressEnd() {
		clearTimeout(pressTimer);
	}

	function tap() {
		if (longPressed) {
			longPressed = false;
			return;
		}
		if (unavailable)
			showToast('Offline: only downloaded songs play', 'icon-[mingcute--wifi-off-line]');
		else onplay();
	}
	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
</script>

<li
	class="flex items-center rounded-md {current ? 'bg-white/[0.08]' : ''} {unavailable
		? 'opacity-40'
		: ''}"
>
	<button
		class="min-w-0 flex-1 flex items-center gap-3 pl-2 py-2 text-start active:opacity-70 transition-opacity"
		onclick={tap}
		onpointerdown={pressStart}
		onpointerup={pressEnd}
		onpointercancel={pressEnd}
		onpointerleave={pressEnd}
		onpointermove={(e) =>
			(Math.abs(e.clientY - pressedAt.y) > 8 || Math.abs(e.clientX - pressedAt.x) > 8) &&
			pressEnd()}
		oncontextmenu={(e) => e.preventDefault()}
	>
		{#if index != null}
			<span
				class="relative w-5 shrink-0 text-end text-sm tabular-nums {current
					? 'text-primary-500'
					: 'text-secondary-600'}"
			>
				{#if current && $playing}
					<span class="icon-[svg-spinners--bars-scale-middle] size-4 text-primary-500"></span>
				{:else}
					{index + 1}
				{/if}
			</span>
		{/if}
		<span class="relative shrink-0">
			<SongCover
				setId={song.id}
				track={song.track}
				title={song.title}
				class="size-11 rounded"
				lazy
			/>
			{#if index == null && current && $playing}
				<span class="absolute inset-0 grid place-items-center rounded bg-black/50">
					<span class="icon-[svg-spinners--bars-scale-middle] size-5 text-primary-500"></span>
				</span>
			{/if}
		</span>
		<span class="min-w-0 flex-1">
			<span class="block font-semibold truncate {current ? 'text-primary-500' : ''}"
				>{song.title}</span
			>
			<span class="flex items-center gap-1.5 text-sm text-secondary-600">
				{#if busy}
					<span class="icon-[svg-spinners--ring-resize] size-3.5 shrink-0 text-primary-500"></span>
				{:else if kept}
					<span
						class="icon-[mingcute--arrow-down-circle-fill] size-3.5 shrink-0 text-primary-500"
						title="On the phone"
					></span>
				{/if}
				<span class="truncate">{song.artist}</span>
			</span>
		</span>
		<span class="text-xs text-secondary-600 tabular-nums"
			>{clock(Number(song.beatmaps?.[0]?.total_length))}</span
		>
	</button>
	{@render extra?.()}
	<button
		aria-label="More for {song.title}"
		class="size-10 shrink-0 grid place-items-center text-secondary-600"
		onclick={() => songMenu.set({ song, playlistId })}
	>
		<span class="icon-[mingcute--more-2-fill] size-5"></span>
	</button>
</li>
