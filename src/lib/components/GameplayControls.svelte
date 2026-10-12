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
		playKey,
		startPlaying,
		togglePlayMod,
		PLAY_MODS
	} from '#lib/gameplay/play.ts';

	/** @type {{ up?: boolean }} up: the panel opens above the button (at the bottom of a view) */
	let { up = false } = $props();

	let open = $state(false);
	// Widgets stay on the desktop during autoplay and replays (never while playing yourself)
	let widgetsShown = $derived($userSettings.settings?.widgetsInGameplay ?? true);
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

	/** @type {import('#lib/gameplay/play.ts').PlayModName[]} */
	let playMods = $derived($userSettings.settings?.gameplayMods ?? []);

	function playYourself() {
		startPlaying(song, playMods);
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

	/** Which part of the panel is shown: watching autoplay, playing, or the replays */
	let tab = $state('watch');
	$effect(() => {
		if (open) tab = mode.kind === 'replay' ? 'replays' : mode.kind === 'live' ? 'play' : tab;
	});
	const TABS = [
		{ id: 'watch', label: 'Watch', icon: 'icon-[mingcute--magic-2-line]' },
		{ id: 'play', label: 'Play', icon: 'icon-[mingcute--cursor-3-line]' },
		{ id: 'replays', label: 'Replays', icon: 'icon-[mingcute--trophy-line]' }
	];

	const MOD_NAMES = {
		EZ: 'Easy',
		HD: 'Hidden',
		HR: 'Hard Rock',
		HT: 'Half Time',
		DT: 'Double Time',
		NC: 'Nightcore',
		RX: 'Relax'
	};
	const MOD_COLOURS = {
		EZ: 'bg-lime-400 text-lime-950',
		HT: 'bg-lime-400 text-lime-950',
		HD: 'bg-rose-400 text-rose-950',
		HR: 'bg-rose-400 text-rose-950',
		DT: 'bg-rose-400 text-rose-950',
		NC: 'bg-rose-400 text-rose-950',
		RX: 'bg-sky-400 text-sky-950'
	};

	const MOD_TITLES = {
		EZ: 'Easy: bigger circles, slower approach, more lenient',
		HD: 'Hidden: no approach circles, circles fade out',
		HR: 'Hard Rock: smaller circles, faster, flipped',
		HT: 'Half Time: 0.75× speed',
		DT: 'Double Time: 1.5× speed',
		NC: 'Nightcore: 1.5× speed and pitch',
		RX: 'Relax: no clicking, just aim'
	};

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
			class="absolute right-0 {up
				? 'bottom-12'
				: 'top-11'} z-40 w-[24rem] max-h-[75vh] flex flex-col rounded-2xl bg-secondary-200/95 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl text-white overflow-hidden"
			transition:fly={{ y: up ? 6 : -6, duration: 150 }}
		>
			<div class="p-3 pb-2 flex flex-col gap-3 border-b border-white/5">
				{#if diffs.length > 1}
					<div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
						{#each diffs as diff (diff.id)}
							<button
								class="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold cursor-pointer transition {diff.id ===
								mapId
									? 'bg-white text-black'
									: 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'}"
								title={diff.version}
								onclick={() => chooseDifficulty(song, diff.id)}
							>
								<span class="max-w-32 truncate">{diff.version}</span>
								{#if diff.stars != null}
									<span class="opacity-60">{stars(diff.stars)}</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
				<div class="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/25">
					{#each TABS as t (t.id)}
						<button
							class="flex items-center justify-center gap-1.5 h-8 rounded-lg text-sm font-semibold cursor-pointer transition {tab ===
							t.id
								? 'bg-white/15 text-white'
								: 'text-white/55 hover:text-white'}"
							aria-pressed={tab === t.id}
							onclick={() => (tab = t.id)}
						>
							<span class="{t.icon} size-4"></span>
							{t.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="overflow-y-auto p-3">
				{#if tab === 'watch'}
					<div class="flex flex-col items-center text-center gap-3 py-3">
						<span
							class="grid place-items-center size-14 rounded-2xl bg-primary-500/20 text-primary-200"
						>
							<span class="icon-[mingcute--magic-2-line] size-7"></span>
						</span>
						<div>
							<p class="font-semibold">Autoplay</p>
							<p class="text-sm text-white/55">The map played perfectly along with the song.</p>
						</div>
						<button
							class="h-9 px-5 rounded-full text-sm font-semibold cursor-pointer transition {mode.kind ===
							'auto'
								? 'bg-white/10 text-white/60'
								: 'bg-white text-black hover:scale-[1.03]'}"
							disabled={mode.kind === 'auto'}
							onclick={() => {
								setGameplayMode(song, { kind: 'auto' });
								open = false;
							}}
						>
							{mode.kind === 'auto' ? 'Watching' : 'Watch autoplay'}
						</button>
					</div>
				{:else if tab === 'play'}
					<p class="mb-2 text-xs font-bold uppercase tracking-wide text-white/45">Mods</p>
					<div class="grid grid-cols-4 gap-1.5">
						{#each PLAY_MODS as mod (mod)}
							{@const on = playMods.includes(mod)}
							<button
								aria-pressed={on}
								title={MOD_TITLES[mod]}
								class="flex flex-col items-center gap-1 py-2 rounded-xl ring-1 cursor-pointer transition {on
									? 'ring-white/40 bg-white/10'
									: 'ring-white/5 bg-white/[0.03] hover:bg-white/[0.07]'}"
								onclick={() => updateUserSettings({ gameplayMods: togglePlayMod(playMods, mod) })}
							>
								<span
									class="px-1.5 rounded text-[11px] font-black transition {on
										? MOD_COLOURS[mod]
										: 'bg-white/10 text-white/60'}">{mod}</span
								>
								<span class="text-[11px] {on ? 'text-white' : 'text-white/50'}"
									>{MOD_NAMES[mod]}</span
								>
							</button>
						{/each}
					</div>

					<p class="mt-4 mb-2 text-xs font-bold uppercase tracking-wide text-white/45">Keys</p>
					<div class="flex items-center gap-2">
						{#each [0, 1] as index (index)}
							<button
								class="min-w-10 h-9 px-3 rounded-lg ring-1 text-sm font-bold cursor-pointer transition {recording ===
								index
									? 'ring-primary-300 text-primary-100 bg-primary-500/15'
									: 'ring-white/15 bg-white/5 hover:bg-white/10'}"
								title="Change this key"
								onclick={() => (recording = recording === index ? null : index)}
							>
								{recording === index ? 'Press a key…' : keyLabel(gameKeys[index])}
							</button>
						{/each}
						<span class="text-xs text-white/45">or the mouse buttons</span>
					</div>

					<button
						class="mt-4 w-full h-11 rounded-full bg-white text-black font-semibold hover:scale-[1.02] flex items-center justify-center gap-2 cursor-pointer transition"
						onclick={playYourself}
					>
						<span class="icon-[mingcute--play-fill] size-5"></span>
						Play it yourself
					</button>
					<p class="mt-1.5 text-center text-xs text-white/40">The song starts over</p>
				{:else}
					{#if replayError}
						<p class="mb-2 px-2 py-1.5 rounded-lg bg-red-500/10 text-xs text-red-300">
							{replayError}
						</p>
					{/if}
					{#if scoresError}
						<p class="py-6 text-center text-sm text-white/55">{scoresError}</p>
					{:else if !scores}
						<p class="py-6 flex items-center justify-center gap-2 text-sm text-white/55">
							<span class="icon-[mingcute--loading-line] size-4 animate-spin"></span>
							Loading the top 50…
						</p>
					{:else if !scores.length}
						<p class="py-6 text-center text-sm text-white/55">No scores on this difficulty yet.</p>
					{:else}
						<div class="flex flex-col gap-0.5">
							{#each scores as score (score.id)}
								<button
									class="flex items-center gap-3 px-2 py-2 rounded-xl text-left cursor-pointer hover:bg-white/5 disabled:cursor-default disabled:opacity-40 {mode.kind ===
										'replay' && mode.score.id === score.id
										? 'bg-white/10'
										: ''}"
									disabled={!score.hasReplay}
									title={score.hasReplay ? `Watch ${score.player}'s replay` : 'No replay saved'}
									onclick={() => watch(score)}
								>
									<span
										class="w-7 shrink-0 text-sm font-bold text-right {score.position <= 3
											? 'text-amber-300'
											: 'text-white/40'}">#{score.position}</span
									>
									{#if score.avatar}
										<img src={score.avatar} alt="" class="size-8 rounded-lg shrink-0" />
									{:else}
										<span class="size-8 rounded-lg shrink-0 bg-white/10"></span>
									{/if}
									<span class="flex-1 min-w-0">
										<span class="flex items-center gap-1.5 text-sm font-semibold">
											<span class="truncate">{score.player}</span>
											{#each score.mods as mod (mod)}
												<span
													class="px-1 rounded text-[10px] font-black {MOD_COLOURS[mod] ??
														'bg-white/10 text-white/80'}">{mod}</span
												>
											{/each}
										</span>
										<span class="block text-xs text-white/45 truncate">
											{(score.accuracy * 100).toFixed(2)}% · {score.maxCombo}x{score.misses
												? ` · ${score.misses} miss`
												: ''} · {date(score.date)}
										</span>
									</span>
									{#if score.pp}
										<span class="shrink-0 text-sm font-semibold text-white/80"
											>{Math.round(score.pp)}pp</span
										>
									{/if}
									{#if loadingScore === score.id}
										<span class="icon-[mingcute--loading-line] size-4 animate-spin shrink-0"></span>
									{:else if score.hasReplay}
										<span class="icon-[mingcute--play-fill] size-4 shrink-0 text-white/50"></span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
			<button
				class="flex items-center gap-3 px-4 h-11 shrink-0 border-t border-white/5 text-sm text-white/80 hover:bg-white/5 cursor-pointer transition"
				role="switch"
				aria-checked={widgetsShown}
				onclick={() => updateUserSettings({ widgetsInGameplay: !widgetsShown })}
			>
				<span class="icon-[mingcute--layout-4-line] size-4 shrink-0"></span>
				<span class="flex-1 text-start"
					>Show widgets <span class="text-white/45">(not while you play)</span></span
				>
				<span
					class="relative w-9 h-5 rounded-full transition {widgetsShown
						? 'bg-primary-400'
						: 'bg-white/15'}"
				>
					<span
						class="absolute top-0.5 size-4 rounded-full bg-white transition-all {widgetsShown
							? 'left-[18px]'
							: 'left-0.5'}"
					></span>
				</span>
			</button>
		</div>
	{/if}
</div>
