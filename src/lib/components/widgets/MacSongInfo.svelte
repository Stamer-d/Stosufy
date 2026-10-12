<script>
	// What the playing song is: its BPM (with a dot on the beat), length, difficulty,
	// mapper, genre and language
	import Widget from './MacWidget.svelte';
	import { currentSong, songQueue } from '#lib/stores/audio.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { chosenMapId } from '#lib/gameplay/play.ts';

	let song = $derived($currentSong.song);
	let stored = $derived(song ? $mapDataStore[song.id] : null);
	let mapId = $derived(song ? chosenMapId(song) : null);
	let map = $derived(
		(mapId && stored?.beatmaps?.[mapId]) ||
			song?.beatmaps?.find((m) => String(m.id) === String(mapId)) ||
			song?.beatmaps?.[0] ||
			null
	);

	/** The tempo of the longest section (the song's main BPM), at the playback speed */
	let bpm = $derived.by(() => {
		const timing = (map?.timing ?? stored?.timing ?? []).filter((t) => t.beatLength > 0);
		/** @type {{ time: number, beatLength: number } | null} */
		let main = null;
		let longest = -1;
		timing.forEach((point, i) => {
			const length = (timing[i + 1]?.time ?? point.time + 600000) - point.time;
			if (length > longest) {
				longest = length;
				main = point;
			}
		});
		const base = main ? 60000 / main.beatLength : Number(stored?.bpm || song?.bpm || 0);
		return Math.round(base * ($songQueue.audio?.playbackRate || 1));
	});

	const length = (seconds) =>
		seconds
			? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
			: '–';
	let stars = $derived(
		map?.difficulty_rating ? `${Number(map.difficulty_rating).toFixed(2)}★` : null
	);
	let facts = $derived(
		[
			stored?.creator || song?.creator ? `mapped by ${stored?.creator || song?.creator}` : null,
			stored?.genre ?? null,
			stored?.language ?? null
		].filter(Boolean)
	);
</script>

<Widget size="medium" label="Song info" icon="icon-[mingcute--information-fill]">
	{#if song}
		<div class="flex items-end gap-4">
			<div class="flex items-center gap-2">
				<!-- Pulses on every beat (--beat comes from the beat effects) -->
				<span
					class="size-3 rounded-full bg-primary-500 shadow-[0_0_12px] shadow-primary-500"
					style="transform: scale(calc(0.7 + var(--beat, 0) * 0.8)); opacity: calc(0.5 + var(--beat, 0) * 0.5)"
				></span>
				<span class="text-4xl font-extrabold tabular-nums leading-none">{bpm || '–'}</span>
				<span class="text-sm font-semibold text-white/60 self-end">BPM</span>
			</div>
			<div class="ml-auto text-right text-sm">
				<p class="font-semibold tabular-nums">{length(map?.total_length)}</p>
				{#if stars}<p class="text-white/60">{stars}</p>{/if}
			</div>
		</div>
		<div class="mt-auto min-w-0">
			<p class="truncate font-semibold">{song.title}</p>
			<p class="truncate text-xs text-white/60">
				{[map?.version, ...facts].filter(Boolean).join(' · ')}
			</p>
		</div>
	{:else}
		<p class="mt-auto text-sm text-white/60">Nothing playing.</p>
	{/if}
</Widget>
