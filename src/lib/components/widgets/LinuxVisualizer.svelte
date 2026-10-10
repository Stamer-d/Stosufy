<script>
	import { onMount } from 'svelte';
	import TerminalWindow from './TerminalWindow.svelte';
	import { songQueue, currentSong } from '#lib/stores/audio.ts';
	import { getAnalyser } from '#lib/stores/visualizer.ts';

	const BARS = 24;
	let levels = $state(Array(BARS).fill(0));
	let analyser = null;

	// Attach to the current song's audio when it changes
	$effect(() => {
		const audio = $songQueue.audio;
		const playing = $currentSong.isPlaying;
		analyser = null;
		if (audio && playing) {
			getAnalyser(audio).then((result) => {
				if ($songQueue.audio === audio) analyser = result;
			});
		}
	});

	onMount(() => {
		let frame;
		const data = new Uint8Array(64);
		const tick = () => {
			if (analyser && $currentSong.isPlaying) {
				analyser.getByteFrequencyData(data);
				// Skip the highest frequencies, they are mostly empty
				levels = Array.from({ length: BARS }, (_, i) => data[Math.floor((i * 44) / BARS)] / 255);
			} else {
				levels = levels.map((level) => level * 0.85);
			}
			frame = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(frame);
	});
</script>

<!-- Audio bars like cava -->
<TerminalWindow title="~ : cava" class="w-[22rem]">
	<div class="flex items-end gap-[3px] h-24">
		{#each levels as level, i (i)}
			<div
				class="flex-1 rounded-[1px] bg-gradient-to-t from-primary-300 to-primary-500"
				style="height: {Math.max(level * 100, 3)}%"
			></div>
		{/each}
	</div>
</TerminalWindow>
