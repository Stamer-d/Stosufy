<script>
	// A song of a list: tap it to play, ⋯ for what else can be done with it
	import { queue, playing, coverUrl } from './player';
	import { downloaded, downloading, isDownloaded } from './downloads';
	import { songMenu } from './library';
	import { sameSong } from '../lib/tracks';

	/** @type {{ song: import('../lib/types').MapSet, playlistId?: string | number, onplay: () => void }} */
	let { song, playlistId, onplay } = $props();

	let current = $derived(sameSong($queue.songs[$queue.index], song));
	let kept = $derived(isDownloaded($downloaded, song));
	let busy = $derived($downloading.has(String(song.beatmaps?.[0]?.id)));
	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
</script>

<li class="flex items-center">
	<button
		class="min-w-0 flex-1 flex items-center gap-3 p-2 rounded-lg text-start active:bg-white/5"
		onclick={onplay}
	>
		<span class="relative size-11 shrink-0">
			<img
				src={coverUrl(song)}
				alt=""
				loading="lazy"
				class="size-11 rounded object-cover bg-secondary-300"
			/>
			{#if current && $playing}
				<span class="absolute inset-0 grid place-items-center rounded bg-black/50">
					<span class="icon-[svg-spinners--bars-scale-middle] size-5 text-primary-400"></span>
				</span>
			{/if}
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate font-semibold {current ? 'text-primary-400' : ''}"
				>{song.title}</span
			>
			<span class="flex items-center gap-1 text-sm text-secondary-600">
				{#if busy}
					<span class="icon-[svg-spinners--ring-resize] size-3.5 shrink-0"></span>
				{:else if kept}
					<span
						class="icon-[mingcute--arrow-down-circle-fill] size-3.5 shrink-0 text-primary-400"
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
	<button
		aria-label="More for {song.title}"
		class="size-10 shrink-0 grid place-items-center text-secondary-600"
		onclick={() => songMenu.set({ song, playlistId })}
	>
		<span class="icon-[mingcute--more-2-fill] size-5"></span>
	</button>
</li>
