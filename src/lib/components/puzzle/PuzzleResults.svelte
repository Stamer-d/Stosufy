<script>
	import { fly, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';
	import Triangles from '#lib/components/Triangles.svelte';
	import {
		DIFFICULTIES,
		GRADE_COLORS,
		JUDGEMENT_COLORS,
		MODES,
		formatTime
	} from '#lib/puzzle/puzzle.ts';

	/**
	 * The ranking screen after a solved puzzle, like osu!'s: the grade, the score and the hits.
	 * @type {{ result: { record: import('#lib/puzzle/puzzle.ts').PuzzleRecord, counts: Record<string, number>, best: import('#lib/puzzle/puzzle.ts').PuzzleRecord | null, isBest: boolean, daily: import('#lib/puzzle/puzzle.ts').DailyState | null }, onretry: () => void, onnext: () => void, onmenu: () => void, on3d: () => void }}
	 */
	let { result, onretry, onnext, onmenu, on3d } = $props();

	let record = $derived(result.record);
	let mode = $derived(MODES.find((m) => m.id === record.mode));
	let difficulty = $derived(DIFFICULTIES[record.difficulty]);
	const grade = (g) => g.replace('H', '');
</script>

<div class="relative size-full overflow-y-auto">
	<BeatmapBackground
		setId={record.setId}
		mapId={record.mapId}
		title={record.title}
		class="absolute inset-0"
	/>
	<div class="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/30"></div>
	<Triangles count={20} seed={record.score % 97} />

	<div class="relative min-h-full flex flex-wrap items-center justify-center gap-x-14 gap-y-8 p-10">
		<!-- The grade -->
		<div class="flex flex-col items-center gap-3">
			<p
				class="text-[11rem] leading-none font-black italic tracking-tighter drop-shadow-[0_0_40px_currentColor]"
				style="color: {GRADE_COLORS[record.grade]}"
				in:scale={{ start: 2.2, duration: 650, easing: backOut }}
			>
				{grade(record.grade)}
			</p>
			{#if result.isBest}
				<span
					class="px-3 py-1 rounded-full bg-primary-300 text-sm font-extrabold uppercase tracking-wide"
					in:fly={{ y: 12, delay: 600 }}>New best!</span
				>
			{:else if result.best}
				<span class="text-sm text-white/60">Best: {result.best.score.toLocaleString()}</span>
			{/if}
		</div>

		<div class="w-full max-w-md flex flex-col gap-5" in:fly={{ x: 30, duration: 400 }}>
			<div>
				<p class="text-xs font-bold uppercase tracking-wide text-primary-400">Puzzle solved</p>
				<p class="text-2xl font-extrabold leading-tight truncate">{record.title}</p>
				<p class="text-white/70 truncate">{record.artist}</p>
				<div class="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
					<span class="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10">
						<span class="{mode?.icon} size-3.5"></span>{mode?.label}
					</span>
					<span
						class="px-2 py-1 rounded-full text-black"
						style="background-color: {difficulty.color}">{difficulty.label}</span
					>
					{#each record.mods as mod (mod)}
						<span class="px-2 py-1 rounded-full bg-white/90 text-black">{mod}</span>
					{/each}
				</div>
			</div>

			<p class="text-6xl font-extrabold tabular-nums tracking-tight">
				{record.score.toLocaleString()}
			</p>

			<div class="grid grid-cols-4 gap-2">
				{#each [300, 100, 50, 0] as judgement (judgement)}
					<div class="rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2">
						<p class="text-xs font-extrabold" style="color: {JUDGEMENT_COLORS[judgement]}">
							{judgement || 'MISS'}
						</p>
						<p class="text-xl font-bold tabular-nums">{result.counts[judgement]}</p>
					</div>
				{/each}
			</div>

			<div class="grid grid-cols-4 gap-2">
				{#each [['Accuracy', `${(record.accuracy * 100).toFixed(2)}%`], ['Max combo', `${record.maxCombo}x`], ['Time', formatTime(record.time)], ['Moves', record.moves]] as [label, value] (label)}
					<div>
						<p class="text-xs text-white/60">{label}</p>
						<p class="text-lg font-bold tabular-nums">{value}</p>
					</div>
				{/each}
			</div>

			{#if result.daily}
				<div
					class="flex items-center gap-3 rounded-lg bg-orange-400/15 ring-1 ring-orange-300/25 px-4 py-3"
				>
					<span class="icon-[mingcute--fire-line] size-7 text-orange-300"></span>
					<div>
						<p class="font-bold">
							{result.daily.streak}
							{result.daily.streak === 1 ? 'day' : 'days'} in a row
						</p>
						<p class="text-sm text-white/60">Come back tomorrow for the next daily puzzle.</p>
					</div>
				</div>
			{/if}

			{#if result.counts.free}
				<p class="text-sm text-white/60">
					{result.counts.free}
					{result.counts.free === 1 ? 'move was' : 'moves were'} made without music and not judged.
				</p>
			{/if}

			<div class="flex flex-wrap gap-2">
				<button
					class="flex items-center gap-2 px-5 h-11 rounded-full bg-primary-300 hover:bg-primary-400 font-semibold cursor-pointer transition"
					onclick={on3d}
				>
					<span class="icon-[mingcute--cube-3d-line] size-5"></span>
					View in 3D
				</button>
				<button
					class="flex items-center gap-2 px-5 h-11 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
					onclick={onnext}
				>
					<span class="icon-[mingcute--shuffle-2-line] size-5"></span>
					Next song
				</button>
				<button
					class="flex items-center gap-2 px-5 h-11 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
					onclick={onretry}
				>
					<span class="icon-[mingcute--refresh-2-line] size-5"></span>
					Retry
				</button>
				<button
					class="flex items-center gap-2 px-5 h-11 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
					onclick={onmenu}
				>
					<span class="icon-[mingcute--arrow-left-line] size-5"></span>
					Back
				</button>
			</div>
		</div>
	</div>
</div>
