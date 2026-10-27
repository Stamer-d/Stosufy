<script>
	// The song playing, above the tabs: play and pause, back and next, where it is
	import {
		queue,
		playing,
		time,
		previewOnly,
		toggle,
		next,
		previous,
		seek,
		coverUrl
	} from './player';

	let song = $derived($queue.songs[$queue.index] ?? null);
	const clock = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
</script>

{#if song}
	<div class="px-3 pt-2">
		<div class="flex items-center gap-3">
			<img src={coverUrl(song)} alt="" class="size-11 rounded-md object-cover bg-secondary-300" />
			<div class="min-w-0 flex-1">
				<p class="text-sm font-semibold truncate">{song.title}</p>
				<p class="text-xs text-secondary-600 truncate">
					{song.artist}{$previewOnly ? ' · preview' : ''}
				</p>
			</div>
			<button aria-label="Back" class="size-10 grid place-items-center" onclick={previous}>
				<span class="icon-[mingcute--skip-previous-fill] size-6"></span>
			</button>
			<button
				aria-label={$playing ? 'Pause' : 'Play'}
				class="size-11 grid place-items-center rounded-full bg-white text-black"
				onclick={toggle}
			>
				<span
					class="{$playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-6"
				></span>
			</button>
			<button aria-label="Next" class="size-10 grid place-items-center" onclick={next}>
				<span class="icon-[mingcute--skip-forward-fill] size-6"></span>
			</button>
		</div>
		<div class="mt-1.5 flex items-center gap-2 text-[11px] text-secondary-600 tabular-nums">
			<span class="w-8">{clock($time.current)}</span>
			<input
				type="range"
				min="0"
				max={$time.duration || 0}
				step="1"
				value={$time.current}
				oninput={(e) => seek(Number(e.currentTarget.value))}
				class="flex-1 accent-primary-400 h-1"
				aria-label="Position"
			/>
			<span class="w-8 text-end">{clock($time.duration)}</span>
		</div>
	</div>
{/if}
