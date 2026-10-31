<script>
	// The Dash mode: the song that plays as a one-button rhythm level, made from its beatmap.
	// Space, ↑, W, the gameplay keys or the mouse to jump; Esc pauses.
	import { onMount } from 'svelte';
	import { fade, fly, scale as zoom } from 'svelte/transition';
	import { get } from 'svelte/store';
	import Titlebar from '../Titlebar.svelte';
	import { currentSong, songQueue, setPlaybackLock } from '#lib/stores/audio.ts';
	import { heardTime } from '#lib/stores/equalizer.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { isPreviewing } from '#lib/stores/stream.ts';
	import { beatmapContent } from '#lib/hitsounds/player.ts';
	import { chosenMapId, standardPicks } from '#lib/gameplay/play.ts';
	import { dashOpen } from '#lib/dash/store.ts';
	import { makeLevel } from '#lib/dash/level.ts';
	import { DIFFICULTIES } from '#lib/dash/generate.ts';
	import { DashGame, RESPAWN, bestKey, bestOf, saveBest } from '#lib/dash/game.ts';
	import { createDashRenderer, ICONS } from '#lib/dash/render.ts';
	import { playDashSound } from '#lib/dash/sound.ts';

	const DIFFICULTY_INFO = {
		easy: { label: 'Easy', color: 'bg-sky-400 text-sky-950' },
		normal: { label: 'Normal', color: 'bg-lime-400 text-lime-950' },
		hard: { label: 'Hard', color: 'bg-amber-400 text-amber-950' },
		insane: { label: 'Insane', color: 'bg-rose-400 text-rose-950' },
		extreme: { label: 'Extreme', color: 'bg-fuchsia-500 text-white' }
	};

	const stored = (key, fallback) => {
		try {
			return localStorage.getItem(key) ?? fallback;
		} catch {
			return fallback;
		}
	};
	const store = (key, value) => {
		try {
			localStorage.setItem(key, String(value));
		} catch {
			// Only for now then
		}
	};

	let difficulty = $state(stored('stosufy-dash-difficulty', 'normal'));
	let iconIndex = $state(Number(stored('stosufy-dash-icon', '0')) || 0);
	let practice = $state(stored('stosufy-dash-practice', '0') === '1');
	$effect(() => store('stosufy-dash-difficulty', difficulty));
	$effect(() => store('stosufy-dash-icon', iconIndex));
	$effect(() => store('stosufy-dash-practice', practice ? '1' : '0'));

	let canvas = $state();
	let renderer = null;
	/** @type {DashGame | null} */
	let game = $state(null);
	/** 'loading' | 'error' | 'ready' | 'playing' | 'paused' | 'complete' */
	let screen = $state('loading');
	let message = $state('');
	let best = $state({ normal: 0, practice: 0, attempts: 0 });
	let results = $state(null);
	let progressShown = $state(0);

	let song = $derived($currentSong.song);
	let mapId = $derived(
		song && ($userSettings.settings?.gameplayDifficulty, $standardPicks, chosenMapId(song))
	);
	let levelKey = $derived(song ? `${song.id}:${mapId}` : null);

	// --- Making the level -------------------------------------------------------------------

	$effect(() => {
		const current = song;
		const id = mapId;
		const chosen = difficulty;
		results = null;
		game = null;
		if (!current) {
			screen = 'error';
			message = 'Play a song to make a level of it.';
			return;
		}
		if (isPreviewing(current)) {
			screen = 'error';
			message = 'Levels are made for downloaded and streamed songs, not previews.';
			return;
		}
		screen = 'loading';
		let cancelled = false;
		(async () => {
			const content = await beatmapContent(current, id).catch(() => null);
			if (cancelled) return;
			if (!content) {
				screen = 'error';
				message = "Couldn't load the beatmap of this song.";
				return;
			}
			const audio = get(songQueue).audio;
			let duration = (audio?.duration ?? 0) * 1000;
			if (!isFinite(duration)) duration = 0;
			try {
				const level = await makeLevel(content, {
					difficulty: chosen,
					seed: `${current.id}:${id}`,
					duration
				});
				if (cancelled) return;
				const made = new DashGame(level);
				made.practice = practice;
				game = made;
				best = bestOf(bestKey(`${current.id}:${id}`, chosen));
				screen = 'ready';
			} catch (error) {
				if (cancelled) return;
				screen = 'error';
				message = error?.message ?? String(error);
			}
		})();
		return () => (cancelled = true);
	});

	// --- The song's time, smooth between the audio element's updates --------------------

	let lastRaw = -1;
	let lastPerf = 0;
	function songTime() {
		const audio = $songQueue.audio;
		if (!audio) return 0;
		const raw = heardTime(audio);
		const now = performance.now();
		if (audio.paused || raw !== lastRaw) {
			lastRaw = raw;
			lastPerf = now;
			return raw;
		}
		return raw + Math.min(120, (now - lastPerf) * (audio.playbackRate || 1));
	}

	function seekAndPlay(ms) {
		const audio = $songQueue.audio;
		if (!audio) return;
		audio.currentTime = Math.max(0, ms / 1000);
		lastRaw = -1;
		audio.play().catch(() => {});
	}

	// --- Playing ------------------------------------------------------------------------------

	let respawnTimer = null;

	function start(auto = false) {
		if (!game) return;
		clearTimeout(respawnTimer);
		results = null;
		game.auto = auto;
		game.practice = practice && !auto;
		game.attempt = 1;
		game.jumps = 0;
		renderer?.reset(game.state);
		seekAndPlay(game.begin(false));
		renderer?.reset(game.state);
		screen = 'playing';
		held.clear();
	}

	function respawn() {
		if (!game || screen !== 'playing') return;
		game.attempt++;
		const from = game.begin(game.practice);
		renderer?.reset(game.state);
		seekAndPlay(from);
	}

	function pause() {
		if (screen !== 'playing' || !game || game.status === 'dead') return;
		$songQueue.audio?.pause();
		screen = 'paused';
		release();
	}

	function resume() {
		if (screen !== 'paused') return;
		screen = 'playing';
		$songQueue.audio?.play().catch(() => {});
	}

	function restart() {
		if (!game) return;
		clearTimeout(respawnTimer);
		const auto = game.auto;
		game.practice = practice && !auto;
		game.attempt++;
		seekAndPlay(game.begin(false));
		renderer?.reset(game.state);
		screen = 'playing';
	}

	function togglePractice() {
		practice = !practice;
		if (!game) return;
		game.practice = practice && !game.auto;
		if (!practice) game.checkpoints = [];
	}

	function exit() {
		clearTimeout(respawnTimer);
		dashOpen.set(false);
	}

	function finish() {
		if (!game) return;
		const key = bestKey(levelKey, difficulty);
		if (!game.auto) best = saveBest(key, 100, game.practice, game.attempt);
		results = {
			attempts: game.attempt,
			jumps: game.jumps,
			auto: game.auto,
			practice: game.practice,
			seconds: Math.round((game.level.end - game.level.start) / 1000)
		};
		setTimeout(() => {
			if (game?.status === 'complete') screen = 'complete';
		}, 1400);
	}

	// --- Input --------------------------------------------------------------------------------

	const held = new Set();
	function setHeld(source, down) {
		if (!game || screen !== 'playing') return;
		const before = held.size > 0;
		if (down) held.add(source);
		else held.delete(source);
		const after = held.size > 0;
		if (before !== after) game.input(after, songTime());
	}
	function release() {
		if (held.size && game) game.input(false, songTime());
		held.clear();
	}

	const keys = () => [
		'Space',
		'ArrowUp',
		'KeyW',
		...($userSettings.settings?.gameplayKeys ?? ['KeyZ', 'KeyX'])
	];

	function onKey(event) {
		if (event.key === 'Escape' && event.type === 'keydown') {
			event.preventDefault();
			if (screen === 'playing') pause();
			else if (screen === 'paused') resume();
			else exit();
			return;
		}
		if (!keys().includes(event.code)) {
			if (
				event.type === 'keydown' &&
				event.code === 'KeyR' &&
				(screen === 'playing' || screen === 'paused')
			)
				restart();
			if (
				event.type === 'keydown' &&
				event.code === 'KeyP' &&
				(screen === 'playing' || screen === 'paused')
			)
				togglePractice();
			return;
		}
		// Typing somewhere: not a jump
		if (event.target instanceof HTMLInputElement) return;
		event.preventDefault();
		if (event.repeat) return;
		if (event.type === 'keydown' && screen === 'ready') return start(false);
		if (event.type === 'keydown' && screen === 'paused') return resume();
		setHeld(event.code, event.type === 'keydown');
	}

	function onPointer(event) {
		if (event.button !== 0 && event.type === 'pointerdown') return;
		if (screen !== 'playing') return;
		event.preventDefault();
		setHeld(`pointer${event.pointerId}`, event.type === 'pointerdown');
	}

	$effect(() => {
		keybindsPaused.set(true);
		return () => keybindsPaused.set(false);
	});
	$effect(() => {
		const playing = screen === 'playing' || screen === 'paused';
		setPlaybackLock('dash', playing ? () => "You're playing a Dash level: press Esc first." : null);
		return () => setPlaybackLock('dash', null);
	});

	// --- The frames -------------------------------------------------------------------------

	onMount(() => {
		renderer = createDashRenderer(canvas);
		let frame;
		let lastProgress = -1;
		const loop = () => {
			frame = requestAnimationFrame(loop);
			if (!game || !renderer) {
				const ctx = canvas?.getContext('2d');
				if (ctx) {
					renderer?.resize();
					ctx.fillStyle = '#0a0718';
					ctx.fillRect(0, 0, canvas.width, canvas.height);
				}
				return;
			}
			const g = game;
			let time = screen === 'ready' ? g.level.start : songTime();
			if (screen === 'playing' && (g.status === 'playing' || g.status === 'complete')) {
				// The song jumped back (a seek from somewhere else): this attempt starts over
				const audio = $songQueue.audio;
				if (g.status === 'playing' && audio && !audio.paused && time < g.state.time - 1500)
					time = g.state.time;
				for (const name of g.update(time)) {
					renderer.event(name, g.state, ICONS[iconIndex]);
					if (name === 'death') {
						playDashSound('death');
						audio?.pause();
						release();
						const key = bestKey(levelKey, difficulty);
						if (!g.auto) best = saveBest(key, Math.floor(g.progress), g.practice, g.attempt);
						clearTimeout(respawnTimer);
						respawnTimer = setTimeout(respawn, RESPAWN);
					} else if (name === 'checkpoint') playDashSound('checkpoint', 0.25);
					else if (name === 'complete') {
						playDashSound('complete', 0.35);
						finish();
					}
				}
			}
			const progress = Math.floor(g.progress);
			if (progress !== lastProgress) progressShown = lastProgress = progress;
			try {
				renderer.draw({
					level: g.level,
					state: g.state,
					time: g.status === 'dead' ? g.state.time : time,
					attempt: g.attempt,
					progress: g.progress,
					best: g.practice ? best.practice : best.normal,
					practice: g.practice,
					checkpoints: g.practice ? g.checkpoints : [],
					dead: g.status === 'dead',
					deadFor: performance.now() - g.diedAt,
					complete: g.status === 'complete',
					icon: ICONS[iconIndex],
					waiting: screen === 'playing' && g.status === 'playing' && time < g.state.time - 20,
					hud: screen !== 'ready'
				});
			} catch (error) {
				console.error('Could not draw the Dash level:', error);
			}
		};
		frame = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(respawnTimer);
		};
	});

	const pct = (value) => `${Math.floor(value)}%`;
</script>

<svelte:window onkeydown={onKey} onkeyup={onKey} onpointerup={onPointer} onblur={release} />

<div class="fixed inset-0 z-40 bg-black text-white select-none" transition:fade={{ duration: 200 }}>
	<canvas
		bind:this={canvas}
		class="absolute inset-0 size-full touch-none {screen === 'playing' ? 'cursor-none' : ''}"
		onpointerdown={onPointer}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>
	<div class="relative z-10">
		<Titlebar />
	</div>

	{#if screen === 'playing'}
		<div class="absolute top-14 right-4 z-10 flex gap-2">
			{#if game?.practice}
				<span
					class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-emerald-400/90 text-emerald-950 text-xs font-black tracking-wide"
				>
					<span class="icon-[mingcute--flag-2-line] size-4"></span>
					PRACTICE
				</span>
			{/if}
			{#if game?.auto}
				<span
					class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/90 text-black text-xs font-black tracking-wide"
				>
					<span class="icon-[mingcute--magic-2-line] size-4"></span>
					AUTO
				</span>
			{/if}
			<button
				class="grid place-items-center size-9 rounded-full bg-black/40 ring-1 ring-white/15 text-white/80 hover:text-white cursor-pointer"
				title="Pause (Esc)"
				aria-label="Pause"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={pause}
			>
				<span class="icon-[mingcute--pause-line] size-5"></span>
			</button>
		</div>
		{#if game && game.attempt === 1 && progressShown < 3 && !game.auto}
			<p
				class="absolute bottom-[12%] left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/40 text-sm font-semibold text-white/85 pointer-events-none"
				out:fade
			>
				Click, <kbd class="font-sans">Space</kbd> or <kbd class="font-sans">↑</kbd> to jump · hold
				to keep jumping · <kbd class="font-sans">Esc</kbd> pauses
			</p>
		{/if}
	{/if}

	{#if screen === 'loading'}
		<div class="absolute inset-0 grid place-items-center" transition:fade={{ duration: 150 }}>
			<p class="flex items-center gap-3 text-lg font-semibold text-white/80">
				<span class="icon-[mingcute--loading-line] size-6 animate-spin"></span>
				Building the level…
			</p>
		</div>
	{:else if screen === 'error'}
		<div class="absolute inset-0 grid place-items-center p-6">
			<div class="flex flex-col items-center gap-4 text-center">
				<p class="text-white/80">{message}</p>
				<button
					class="h-10 px-5 rounded-full bg-white text-black font-semibold cursor-pointer hover:scale-[1.03] transition"
					onclick={exit}>Back</button
				>
			</div>
		</div>
	{:else if screen === 'ready' && game}
		<div
			class="absolute inset-0 grid place-items-center p-6 bg-black/35"
			transition:fade={{ duration: 150 }}
		>
			<div
				class="w-[min(30rem,100%)] flex flex-col gap-5 p-6 rounded-3xl bg-black/60 backdrop-blur-xl ring-1 ring-white/15 shadow-2xl"
				in:zoom={{ start: 0.96, duration: 200 }}
			>
				<div class="text-center">
					<p class="text-xs font-black tracking-[0.2em] text-white/50">DASH</p>
					<h2 class="mt-1 text-2xl font-black leading-tight line-clamp-2">{game.level.title}</h2>
					<p class="text-sm text-white/60 truncate">
						{game.level.artist} · {game.level.version} by {game.level.creator}
					</p>
				</div>

				<div class="grid grid-cols-5 gap-1.5">
					{#each DIFFICULTIES as d (d)}
						<button
							class="flex flex-col items-center gap-1 py-2 rounded-xl ring-1 cursor-pointer transition {difficulty ===
							d
								? 'ring-white/50 bg-white/10'
								: 'ring-white/5 bg-white/[0.03] hover:bg-white/[0.08]'}"
							aria-pressed={difficulty === d}
							onclick={() => (difficulty = d)}
						>
							<span
								class="px-1.5 rounded text-[11px] font-black {difficulty === d
									? DIFFICULTY_INFO[d].color
									: 'bg-white/10 text-white/60'}">{DIFFICULTY_INFO[d].label}</span
							>
						</button>
					{/each}
				</div>

				<div class="flex items-center justify-between gap-3">
					<div class="flex gap-1.5">
						{#each ICONS as icon, i (i)}
							<button
								class="size-8 rounded-lg ring-2 cursor-pointer transition {iconIndex === i
									? 'ring-white scale-110'
									: 'ring-transparent opacity-70 hover:opacity-100'}"
								style="background: linear-gradient(135deg, {icon.primary} 50%, {icon.secondary} 50%)"
								aria-label="Icon colours {i + 1}"
								onclick={() => (iconIndex = i)}
							></button>
						{/each}
					</div>
					<button
						class="flex items-center gap-2 h-8 px-3 rounded-full text-xs font-bold cursor-pointer transition {practice
							? 'bg-emerald-400 text-emerald-950'
							: 'bg-white/10 text-white/70 hover:text-white'}"
						role="switch"
						aria-checked={practice}
						onclick={togglePractice}
					>
						<span class="icon-[mingcute--flag-2-line] size-4"></span>
						Practice
					</button>
				</div>

				<div class="grid grid-cols-2 gap-2 text-center">
					<div class="py-2 rounded-xl bg-white/5">
						<p class="text-[11px] font-bold text-white/45">NORMAL</p>
						<p class="text-lg font-black">{pct(best.normal)}</p>
					</div>
					<div class="py-2 rounded-xl bg-white/5">
						<p class="text-[11px] font-bold text-white/45">PRACTICE</p>
						<p class="text-lg font-black text-emerald-300">{pct(best.practice)}</p>
					</div>
				</div>

				<div class="flex gap-2">
					<button
						class="flex-1 h-12 rounded-full bg-white text-black text-lg font-black flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02] transition"
						onclick={() => start(false)}
					>
						<span class="icon-[mingcute--play-fill] size-6"></span>
						Play
					</button>
					<button
						class="h-12 px-5 rounded-full bg-white/10 text-white/80 font-semibold flex items-center gap-2 cursor-pointer hover:bg-white/15 hover:text-white transition"
						title="Watch it played perfectly"
						onclick={() => start(true)}
					>
						<span class="icon-[mingcute--eye-line] size-5"></span>
						Auto
					</button>
				</div>
				<p class="-mt-2 text-center text-xs text-white/40">
					The song starts over · {game.level.clicks} clicks · made from the beatmap
				</p>
			</div>
		</div>
	{:else if screen === 'paused' && game}
		<div
			class="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-sm"
			transition:fade={{ duration: 120 }}
		>
			<div class="flex flex-col items-center gap-5" in:fly={{ y: 10, duration: 150 }}>
				<p class="text-4xl font-black tracking-wide">Paused</p>
				<p class="text-white/60 text-sm">{pct(game.progress)} · attempt {game.attempt}</p>
				<div class="flex items-center gap-3">
					<button
						class="grid place-items-center size-16 rounded-full bg-white text-black cursor-pointer hover:scale-105 transition"
						title="Resume (Esc)"
						aria-label="Resume"
						onclick={resume}
					>
						<span class="icon-[mingcute--play-fill] size-8"></span>
					</button>
					<button
						class="grid place-items-center size-12 rounded-full bg-white/15 cursor-pointer hover:bg-white/25 transition"
						title="Restart (R)"
						aria-label="Restart"
						onclick={restart}
					>
						<span class="icon-[mingcute--refresh-2-line] size-6"></span>
					</button>
					<button
						class="grid place-items-center size-12 rounded-full cursor-pointer transition {practice
							? 'bg-emerald-400 text-emerald-950'
							: 'bg-white/15 hover:bg-white/25'}"
						title="Practice mode (P)"
						aria-label="Practice mode"
						aria-pressed={practice}
						onclick={togglePractice}
					>
						<span class="icon-[mingcute--flag-2-line] size-6"></span>
					</button>
					<button
						class="grid place-items-center size-12 rounded-full bg-white/15 cursor-pointer hover:bg-white/25 transition"
						title="Leave"
						aria-label="Leave"
						onclick={exit}
					>
						<span class="icon-[mingcute--close-line] size-6"></span>
					</button>
				</div>
			</div>
		</div>
	{:else if screen === 'complete' && results}
		<div
			class="absolute inset-0 grid place-items-center bg-black/40"
			transition:fade={{ duration: 200 }}
		>
			<div
				class="flex flex-col items-center gap-5 text-center"
				in:zoom={{ start: 0.8, duration: 350 }}
			>
				<p
					class="text-5xl sm:text-6xl font-black tracking-tight bg-gradient-to-b from-yellow-200 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]"
				>
					Level complete!
				</p>
				<div class="flex gap-3">
					{#each [['Attempts', results.attempts], ['Jumps', results.auto ? '—' : results.jumps], ['Time', `${Math.floor(results.seconds / 60)}:${String(results.seconds % 60).padStart(2, '0')}`]] as [label, value] (label)}
						<div class="w-28 py-3 rounded-2xl bg-black/50 ring-1 ring-white/10">
							<p class="text-[11px] font-bold text-white/50 uppercase">{label}</p>
							<p class="text-2xl font-black">{value}</p>
						</div>
					{/each}
				</div>
				{#if results.practice}
					<p class="text-sm text-emerald-300 font-semibold">
						In practice mode: now without checkpoints?
					</p>
				{/if}
				<div class="flex gap-2">
					<button
						class="h-11 px-6 rounded-full bg-white text-black font-bold flex items-center gap-2 cursor-pointer hover:scale-[1.03] transition"
						onclick={() => start(false)}
					>
						<span class="icon-[mingcute--refresh-2-line] size-5"></span>
						Play again
					</button>
					<button
						class="h-11 px-6 rounded-full bg-white/15 font-semibold cursor-pointer hover:bg-white/25 transition"
						onclick={() => (screen = 'ready')}
					>
						Options
					</button>
					<button
						class="h-11 px-6 rounded-full bg-white/15 font-semibold cursor-pointer hover:bg-white/25 transition"
						onclick={exit}
					>
						Leave
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
