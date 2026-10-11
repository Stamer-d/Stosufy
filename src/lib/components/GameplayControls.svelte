<script>
	// What the gameplay view shows: the difficulty, autoplay, playing it yourself or a
	// replay of one of the top 50 scores
	import { fly } from 'svelte/transition';
	import { currentSong, songQueue } from '#lib/stores/audio.ts';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import {
		gameplayMode,
		chosenMapId,
		chooseDifficulty,
		difficulties,
		leaderboard,
		downloadReplay,
		setGameplayMode,
		playKey
	} from '#lib/gameplay/play.ts';

	let open = $state(false);
	let root = $state(null);
	let song = $derived($currentSong.song);
	let mapId = $derived(song && ($userSettings.settings?.gameplayDifficulty, chosenMapId(song)));
	let key = $derived(song ? `${song.id}:${mapId}` : null);
	/** @type {import('#lib/gameplay/play.ts').GameplayMode} */
	const AUTO = { kind: 'auto' };
	let mode = $derived($gameplayMode.key === key ? $gameplayMode.mode : AUTO);

	let diffs = $state([]);
	let scores = $state(null);
	let scoresError = $state('');
	let loadingScore = $state(null);
	let replayError = $state('');
	let recording = $state(null);

	$effect(() => {
		const current = song;
		diffs = [];
		if (!current || !open) return;
		difficulties(current).then((list) => {
			if (current === song) diffs = list;
		});
	});

	$effect(() => {
		const id = mapId;
		scores = null;
		scoresError = '';
		replayError = '';
		if (!open || !id) return;
		leaderboard(id)
			.then((list) => id === mapId && (scores = list))
			.catch((error) => id === mapId && (scoresError = error.message ?? String(error)));
	});

	function restartSong() {
		const audio = $songQueue.audio;
		if (!audio) return;
		audio.currentTime = 0;
		audio.play().catch(() => {});
	}

	function playYourself() {
		setGameplayMode(song, { kind: 'live' });
		open = false;
		restartSong();
	}

	async function watch(score) {
		if (!score.hasReplay || loadingScore) return;
		loadingScore = score.id;
		replayError = '';
		try {
			const replay = await downloadReplay(score);
			if (playKey(song) !== key) return;
			// It plays from where the song is
			setGameplayMode(song, { kind: 'replay', score, replay });
			open = false;
		} catch (error) {
			replayError = error.message ?? String(error);
		} finally {
			loadingScore = null;
		}
	}

	let gameKeys = $derived($userSettings.settings?.gameplayKeys ?? ['KeyZ', 'KeyX']);
	const keyLabel = (code) => code.replace(/^Key|^Digit/, '');

	function recordKey(event) {
		if (recording === null) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key !== 'Escape') {
			/** @type {[string, string]} */
			const next = [gameKeys[0], gameKeys[1]];
			next[recording] = event.code;
			updateUserSettings({ gameplayKeys: next });
		}
		recording = null;
	}

	const label = $derived(
		mode.kind === 'live'
			? 'Playing'
			: mode.kind === 'replay'
				? `Replay: ${mode.replay.player}`
				: 'Autoplay'
	);
	const stars = (value) => (value == null ? '' : `${value.toFixed(2)}★`);
	const date = (text) => (text ? new Date(text).toLocaleDateString() : '');
</script>

<svelte:window
	onclick={(e) => open && !root?.contains(e.target) && (open = false)}
	onkeydowncapture={recordKey}
	onkeydown={(e) => e.key === 'Escape' && recording === null && (open = false)}
/>

<div class="relative" bind:this={root}>
	{#if mode.kind === 'live'}
		<button
			class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold bg-red-500/80 backdrop-blur-2xl ring-1 ring-white/10 text-white hover:bg-red-500 cursor-pointer transition"
			onclick={() => setGameplayMode(song, { kind: 'auto' })}
		>
			<span class="icon-[mingcute--stop-circle-line] size-[18px]"></span>
			Stop playing
		</button>
	{:else}
		<button
			class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold bg-black/30 backdrop-blur-2xl ring-1 ring-white/10 text-white/80 hover:text-white cursor-pointer transition max-w-56"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<span class="icon-[mingcute--game-2-line] size-[18px] shrink-0"></span>
			<span class="truncate">{label}</span>
			<span class="icon-[mingcute--down-line] size-4 shrink-0"></span>
		</button>
	{/if}

	{#if open}
		<div
			class="absolute right-0 top-11 z-40 w-[22rem] max-h-[70vh] overflow-y-auto rounded-2xl bg-secondary-200/95 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl p-2 text-white"
			transition:fly={{ y: -6, duration: 150 }}
		>
			{#if diffs.length > 1}
				<p class="px-2.5 pt-1.5 pb-1 text-xs font-bold uppercase tracking-wide text-white/50">
					Difficulty
				</p>
				<div class="flex flex-col">
					{#each diffs as diff (diff.id)}
						<button
							class="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-sm text-left cursor-pointer hover:bg-white/5 {diff.id ===
							mapId
								? 'text-white font-semibold bg-white/10'
								: 'text-white/80'}"
							onclick={() => chooseDifficulty(song, diff.id)}
						>
							<span class="truncate">{diff.version}</span>
							<span class="shrink-0 text-xs text-white/50">{stars(diff.stars)}</span>
						</button>
					{/each}
				</div>
				<div class="my-2 h-px bg-white/10"></div>
			{/if}

			<button
				class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-left cursor-pointer hover:bg-white/5 {mode.kind ===
				'auto'
					? 'text-white font-semibold bg-white/10'
					: ''}"
				onclick={() => {
					setGameplayMode(song, { kind: 'auto' });
					open = false;
				}}
			>
				<span class="icon-[mingcute--magic-2-line] size-5"></span>
				Autoplay
			</button>
			<button
				class="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-left cursor-pointer hover:bg-white/5"
				onclick={playYourself}
			>
				<span class="icon-[mingcute--cursor-3-line] size-5"></span>
				<span class="flex-1">
					Play it yourself
					<span class="block text-xs text-white/50">
						Aim with the mouse, click with the keys or mouse buttons. Starts the song over.
					</span>
				</span>
			</button>
			<div class="flex items-center gap-2 px-2.5 pb-2 text-xs text-white/60">
				Keys
				{#each [0, 1] as index (index)}
					<button
						class="min-w-8 h-7 px-2 rounded-md ring-1 font-semibold cursor-pointer {recording ===
						index
							? 'ring-primary-300 text-primary-100'
							: 'ring-white/15 text-white hover:bg-white/5'}"
						onclick={() => (recording = recording === index ? null : index)}
					>
						{recording === index ? 'Press a key' : keyLabel(gameKeys[index])}
					</button>
				{/each}
			</div>

			<div class="my-2 h-px bg-white/10"></div>
			<p class="px-2.5 pt-1 pb-1 text-xs font-bold uppercase tracking-wide text-white/50">
				Top 50 replays
			</p>
			{#if replayError}
				<p class="px-2.5 py-1.5 text-xs text-red-300">{replayError}</p>
			{/if}
			{#if scoresError}
				<p class="px-2.5 py-2 text-sm text-white/60">{scoresError}</p>
			{:else if !scores}
				<p class="px-2.5 py-2 text-sm text-white/60">Loading the leaderboard…</p>
			{:else if !scores.length}
				<p class="px-2.5 py-2 text-sm text-white/60">No scores on this difficulty yet.</p>
			{:else}
				<div class="flex flex-col">
					{#each scores as score (score.id)}
						<button
							class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left cursor-pointer hover:bg-white/5 disabled:cursor-default disabled:opacity-40 {mode.kind ===
								'replay' && mode.score.id === score.id
								? 'bg-white/10'
								: ''}"
							disabled={!score.hasReplay}
							title={score.hasReplay ? `Watch ${score.player}'s replay` : 'No replay saved'}
							onclick={() => watch(score)}
						>
							<span class="w-6 shrink-0 text-xs font-bold text-white/50 text-right"
								>#{score.position}</span
							>
							{#if score.avatar}
								<img src={score.avatar} alt="" class="size-7 rounded-md shrink-0" />
							{/if}
							<span class="flex-1 min-w-0">
								<span class="flex items-center gap-1.5 text-sm font-semibold">
									<span class="truncate">{score.player}</span>
									{#each score.mods as mod (mod)}
										<span class="px-1 rounded bg-white/10 text-[10px] font-bold text-white/80"
											>{mod}</span
										>
									{/each}
								</span>
								<span class="block text-xs text-white/50">
									{(score.accuracy * 100).toFixed(2)}% · {score.maxCombo}x{score.misses
										? ` · ${score.misses} miss`
										: ''}{score.pp ? ` · ${Math.round(score.pp)}pp` : ''} · {date(score.date)}
								</span>
							</span>
							{#if loadingScore === score.id}
								<span class="icon-[mingcute--loading-line] size-4 animate-spin shrink-0"></span>
							{:else if score.hasReplay}
								<span class="icon-[mingcute--play-fill] size-4 shrink-0 text-white/60"></span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
