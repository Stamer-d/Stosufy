<script>
	import { fly, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';
	import Triangles from '#lib/components/Triangles.svelte';
	import PuzzleLeaderboard from '#lib/components/puzzle/PuzzleLeaderboard.svelte';
	import {
		DIFFICULTIES,
		MODES,
		PEEK_PENALTY,
		formatTime,
		scoreMultiplier
	} from '#lib/puzzle/puzzle.ts';

	/**
	 * The screen after a solved puzzle: the points and the time, the user's best before it and
	 * where it puts them on the leaderboard (`ranking`: sending, done with the board, or why it isn't ranked).
	 * @type {{ result: { record: import('#lib/puzzle/puzzle.ts').PuzzleRecord, best: import('#lib/puzzle/puzzle.ts').PuzzleRecord | null, isBest: boolean, daily: import('#lib/puzzle/puzzle.ts').DailyState | null }, ranking: { status: 'sending' | 'done' | 'unranked', message?: string, score?: number, best?: boolean, previous?: number | null, ranked?: boolean, board?: any, streak?: number | null } | null, onretry: () => void, onnext: () => void, onmenu: () => void, on3d: () => void }}
	 */
	let { result, ranking, onretry, onnext, onmenu, on3d } = $props();

	let record = $derived(result.record);
	let mode = $derived(MODES.find((m) => m.id === record.mode));
	let difficulty = $derived(DIFFICULTIES[record.difficulty]);
	let done = $derived(ranking?.status === 'done' ? ranking : null);
	/** The best score before this one: the server's (from any device), else this device's */
	let previous = $derived(done ? done.previous : (result.best?.score ?? null));
	let score = $derived(done?.score ?? record.score ?? 0);
	let multiplier = $derived(scoreMultiplier(record.mods));
	let isBest = $derived(done ? done.best : result.isBest);
	let place = $derived(done?.ranked ? done.board?.mine : null);
	let streak = $derived(done?.streak ?? result.daily?.streak ?? 0);
</script>

<div class="relative size-full overflow-y-auto">
	<BeatmapBackground
		setId={record.setId}
		mapId={record.mapId}
		title={record.title}
		class="absolute inset-0"
	/>
	<div class="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/30"></div>
	<Triangles count={20} seed={score % 97} />

	<div class="relative min-h-full flex flex-wrap items-center justify-center gap-x-14 gap-y-8 p-10">
		<div class="w-full max-w-md flex flex-col gap-5" in:fly={{ x: -30, duration: 400 }}>
			<div>
				<p class="text-xs font-bold uppercase tracking-wide text-primary-400">
					{record.daily ? 'Daily puzzle solved' : 'Puzzle solved'}
				</p>
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

			<!-- The points, and the time they came from -->
			<div>
				<p
					class="text-8xl font-black tabular-nums tracking-tighter leading-none drop-shadow-[0_0_30px_rgba(102,204,255,0.35)]"
					in:scale={{ start: 1.8, duration: 600, easing: backOut }}
				>
					{score.toLocaleString()}
				</p>
				<p class="mt-2 text-xl font-bold tabular-nums text-white/80">
					<span class="icon-[mingcute--time-line] size-5 align-[-3px]"></span>
					{formatTime(record.time, true)}
					{#if multiplier !== 1}
						<span class="text-primary-400">· mods ×{multiplier.toFixed(2)}</span>
					{/if}
				</p>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					{#if isBest && !(record.daily && done && !done.ranked)}
						<span
							class="px-3 py-1 rounded-full bg-primary-300 text-sm font-extrabold uppercase tracking-wide"
							in:fly={{ y: 12, delay: 500 }}>{previous == null ? 'First solve!' : 'New best!'}</span
						>
					{/if}
					{#if previous != null}
						<span class="text-sm text-white/60">
							{isBest ? 'Before' : 'Best'}: {previous.toLocaleString()}
							{#if isBest}
								<span class="text-primary-400 font-semibold"
									>(+{(score - previous).toLocaleString()})</span
								>
							{/if}
						</span>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-3 gap-2">
				{#each [['Moves', record.moves], ['Wrong', record.mistakes ?? 0], ['Peeks', record.peeks ? `${record.peeks} (+${(record.peeks * PEEK_PENALTY) / 1000}s)` : 0]] as [label, value] (label)}
					<div class="rounded-lg bg-black/40 ring-1 ring-white/10 px-3 py-2">
						<p class="text-xs text-white/60">{label}</p>
						<p class="text-lg font-bold tabular-nums">{value}</p>
					</div>
				{/each}
			</div>

			{#if record.daily}
				<div
					class="flex items-center gap-3 rounded-lg bg-orange-400/15 ring-1 ring-orange-300/25 px-4 py-3"
				>
					<span class="icon-[mingcute--fire-line] size-7 text-orange-300"></span>
					<div>
						<p class="font-bold">
							{streak}
							{streak === 1 ? 'day' : 'days'} in a row
						</p>
						<p class="text-sm text-white/60">Come back tomorrow for the next daily puzzle.</p>
					</div>
				</div>
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
					{record.daily ? 'Practice' : 'Retry'}
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

		<!-- Where it puts the user on the leaderboard -->
		<div
			class="w-full max-w-sm flex flex-col gap-3 rounded-xl bg-black/45 backdrop-blur ring-1 ring-white/10 p-4"
			in:fly={{ x: 30, duration: 400, delay: 150 }}
		>
			<div class="flex items-center justify-between gap-3 px-1">
				<p class="flex items-center gap-2 font-bold">
					<span class="icon-[mingcute--trophy-line] size-5 text-amber-300"></span>
					{record.daily ? "Today's leaderboard" : 'Leaderboard'}
				</p>
				{#if place}
					<span class="text-2xl font-black text-primary-400" in:scale={{ start: 1.6, delay: 300 }}
						>#{place.rank}</span
					>
				{/if}
			</div>
			{#if done && record.daily && !done.ranked}
				<p class="px-1 text-sm text-white/60">
					Practice: only your first try counts on today's board. Your score still counts for this
					song's puzzle and your ranking.
				</p>
			{/if}
			{#if ranking?.status === 'unranked'}
				<p class="px-1 py-4 text-sm text-white/60">{ranking.message}</p>
			{:else}
				<PuzzleLeaderboard board={done?.board ?? null} />
			{/if}
		</div>
	</div>
</div>
