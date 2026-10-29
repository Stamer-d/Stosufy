<script>
	// The song's own hitsound offset, set while it plays (songOffset.ts): earlier or later in
	// steps of 5 ms; the number puts it back to 0.
	import { songOffsets, nudgeSongOffset } from './songOffset';
	import { haptic } from './haptics';

	let { song, disabled = false } = $props();
	let value = $derived($songOffsets[String(song.id)] ?? 0);

	function nudge(by) {
		haptic();
		nudgeSongOffset(song, by);
	}
</script>

<div
	class="px-5 pt-4 flex items-center justify-between gap-3 {disabled
		? 'opacity-40 pointer-events-none'
		: ''}"
>
	<span class="min-w-0">
		<span class="block font-semibold">Offset for this song</span>
		<span class="block text-sm text-white/60">Its hitsounds earlier (−) or later (+)</span>
	</span>
	<span class="flex shrink-0 items-center gap-1">
		<button
			aria-label="Hitsounds of this song earlier"
			class="size-10 grid place-items-center rounded-full bg-white/[0.08] active:bg-white/15"
			onclick={() => nudge(-5)}
		>
			<span class="icon-[mingcute--subtract-line] size-5"></span>
		</button>
		<button
			aria-label="This song's offset: {value} ms (tap for 0)"
			class="w-16 h-10 text-center text-sm font-semibold tabular-nums {value
				? 'text-primary-400'
				: 'text-white/70'}"
			onclick={() => nudge(0)}
		>
			{value > 0 ? '+' : ''}{value} ms
		</button>
		<button
			aria-label="Hitsounds of this song later"
			class="size-10 grid place-items-center rounded-full bg-white/[0.08] active:bg-white/15"
			onclick={() => nudge(5)}
		>
			<span class="icon-[mingcute--add-line] size-5"></span>
		</button>
	</span>
</div>
