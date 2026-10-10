<script>
	import TerminalWindow from './TerminalWindow.svelte';
	import {
		currentSong,
		playbackTime,
		togglePlayback,
		skipForward,
		skipBackward,
		songQueue
	} from '#lib/stores/audio.ts';

	const WIDTH = 28;

	function formatTime(seconds) {
		if (!seconds) return '0:00';
		return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
			.toString()
			.padStart(2, '0')}`;
	}

	// An ASCII progress bar like ncmpcpp: [=========>----------]
	let bar = $derived.by(() => {
		const done = $playbackTime.duration
			? Math.round(($playbackTime.current / $playbackTime.duration) * WIDTH)
			: 0;
		return '='.repeat(Math.max(done - 1, 0)) + (done ? '>' : '') + '-'.repeat(WIDTH - done);
	});
</script>

<!-- A terminal music player status, like ncmpcpp / cmus -->
<TerminalWindow title="~ : stosufy-cli" class="w-[22rem]">
	{#if $currentSong.song}
		<p class="truncate">
			<span class="text-primary-500">[{$currentSong.isPlaying ? 'playing' : 'paused'}]</span>
			<span class="font-bold">{$currentSong.song.title}</span>
		</p>
		<p class="truncate text-white/60">{$currentSong.song.artist}</p>
		<p class="mt-1 whitespace-pre text-white/70">
			[<span class="text-primary-400"
				>{bar.slice(0, bar.indexOf('-') === -1 ? WIDTH : bar.indexOf('-'))}</span
			>{bar.slice(bar.indexOf('-') === -1 ? WIDTH : bar.indexOf('-'))}]
		</p>
		<div class="mt-1 flex items-center justify-between">
			<span class="tabular-nums text-white/60">
				{formatTime($playbackTime.current)}/{formatTime($playbackTime.duration)}
			</span>
			<span class="flex gap-2">
				<button class="hover:text-primary-400 cursor-pointer" onclick={skipBackward}
					>[&lt;&lt;]</button
				>
				<button class="hover:text-primary-400 cursor-pointer" onclick={togglePlayback}>
					[{$currentSong.isPlaying ? '||' : '>'}]
				</button>
				<button class="hover:text-primary-400 cursor-pointer" onclick={skipForward}
					>[&gt;&gt;]</button
				>
			</span>
		</div>
		<p class="mt-1 text-white/40">
			queue: {($songQueue.queue?.length ?? 0) - ($songQueue.currentIndex ?? 0) - 1} more
		</p>
	{:else}
		<p class="text-white/50"><span class="text-primary-500">$</span> stosufy status</p>
		<p>[stopped] nothing playing</p>
	{/if}
</TerminalWindow>
