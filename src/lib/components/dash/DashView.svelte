<script>
	// The Dash mode: the song that plays as a one-button rhythm level, made from its beatmap.
	// Space, ↑, W, the gameplay keys or the mouse to jump; Esc pauses (and from the pause or the
	// results back to the menu, from the menu out of Dash). F shows the frames per second. In
	// practice Z sets a checkpoint and X takes the last one away (C and V where Z and X jump).
	import { onMount, tick, untrack } from 'svelte';
	import { fade, fly, scale as zoom } from 'svelte/transition';
	import { get } from 'svelte/store';
	import Titlebar from '../Titlebar.svelte';
	import { currentSong, songQueue, setPlaybackLock } from '#lib/stores/audio.ts';
	import { heardTime } from '#lib/stores/equalizer.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { isPreviewing } from '#lib/stores/stream.ts';
	import { beatmapContent } from '#lib/hitsounds/player.ts';
	import { chosenMapId, difficulties } from '#lib/gameplay/play.ts';
	import DashSongs from './DashSongs.svelte';
	import DashSoundMenu from './DashSoundMenu.svelte';
	import DashModesMenu from './DashModesMenu.svelte';
	import { allowedModes, dashModes, modesMark } from '#lib/dash/modes.ts';
	import { dashOpen } from '#lib/dash/store.ts';
	import { makeLevel } from '#lib/dash/level.ts';
	import { hearAudio } from '#lib/dash/audio.ts';
	import { DIFFICULTIES } from '#lib/dash/generate.ts';
	import { DashGame, RESPAWN, bestKey, bestOfSet, saveBest } from '#lib/dash/game.ts';
	import { createDashRenderer, ICONS, spritesUrl } from '#lib/dash/render.ts';
	import { ATLAS, SPRITES } from '#lib/dash/sprites.ts';
	import { playDashSound } from '#lib/dash/sound.ts';
	import { dashSounds } from '#lib/dash/sounds.ts';
	import { SongClock } from '#lib/dash/clock.ts';

	const DIFFICULTY_INFO = {
		easy: {
			label: 'Easy',
			color: 'bg-sky-400 text-sky-950',
			about: 'Slow and roomy: cube, ship, ball and UFO'
		},
		normal: {
			label: 'Normal',
			color: 'bg-lime-400 text-lime-950',
			about: 'Every basic part, a bit faster in the chorus'
		},
		hard: {
			label: 'Hard',
			color: 'bg-amber-400 text-amber-950',
			about: 'Fast and busy: every kind of part, orb chains, small parts'
		},
		insane: {
			label: 'Insane',
			color: 'bg-rose-400 text-rose-950',
			about: 'Tight timing, narrow tunnels and the top speeds in the drops'
		},
		extreme: {
			label: 'Extreme',
			color: 'bg-fuchsia-500 text-white',
			about: 'Demon level: very little room per click, 2–3 block tunnels, short parts'
		}
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
	/** Practice: checkpoints on their own too (the player's own come always) */
	let autoCheckpoints = $state(stored('stosufy-dash-auto-checkpoints', '1') === '1');
	$effect(() => store('stosufy-dash-auto-checkpoints', autoCheckpoints ? '1' : '0'));
	$effect(() => {
		if (game) game.autoCheckpoints = autoCheckpoints;
	});
	let showFps = $state(stored('stosufy-dash-fps', '1') === '1');
	$effect(() => store('stosufy-dash-fps', showFps ? '1' : '0'));
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
	/** Frames drawn a second (counted over half a second) */
	let fps = $state(0);
	/** The song list (↑ ↓ Enter in the menu) */
	let songs = $state();

	let song = $derived($currentSong.song);
	/**
	 * The beatmap's difficulty the level is made from: always the one with the most stars, of
	 * all the set has (streamed songs too); none until that's known
	 */
	let mapId = $state(null);
	$effect(() => {
		const current = song;
		mapId = null;
		if (!current) return;
		// (a set without osu!standard difficulties: the one the song plays)
		const fallback = () => current === song && (mapId = chosenMapId(current));
		difficulties(current)
			.then((list) => {
				if (current !== song) return;
				if (list.length) mapId = list[list.length - 1].id;
				else fallback();
			})
			.catch(fallback);
	});
	let levelKey = $derived(song ? `${song.id}:${mapId}` : null);

	// --- Making the level -------------------------------------------------------------------

	/** Another song started while the results show: its level is made after them */
	let stale = $state(false);
	let reload = $state(0);

	$effect(() => {
		const current = song;
		const id = mapId;
		const chosen = difficulty;
		// (the kinds of parts chosen: another level)
		const kinds = allowedModes($dashModes);
		const mark = modesMark($dashModes);
		void reload;
		if (untrack(() => screen) === 'complete') {
			stale = true;
			return;
		}
		stale = false;
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
		// (the hardest difficulty is still being found)
		if (id == null) return;
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
			// What's heard in the song (its hits, its loud parts) goes into the level too
			const sound = await hearAudio(`${current.id}:${id}`, audio);
			if (cancelled) return;
			try {
				const level = await makeLevel(content, {
					difficulty: chosen,
					seed: `${current.id}:${id}`,
					duration,
					sound,
					modes: kinds.modes,
					gravity: kinds.gravity,
					generator: kinds.generator
				});
				if (cancelled) return;
				const made = new DashGame(level);
				made.practice = practice;
				made.autoCheckpoints = autoCheckpoints;
				game = made;
				best = bestOfSet(current.id, chosen, mark);
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

	const clock = new SongClock();
	$effect(() => {
		clock.delay = $dashSounds.delay ?? 0;
	});

	function songTime() {
		const audio = $songQueue.audio;
		if (!audio) return 0;
		return clock.read(heardTime(audio), performance.now(), audio.paused, audio.playbackRate || 1);
	}

	/** The song time an input event happened at (not when it's handled) */
	function eventTime(event) {
		const audio = $songQueue.audio;
		if (!audio) return 0;
		const now = performance.now();
		return clock.at(event.timeStamp, heardTime(audio), now, audio.paused, audio.playbackRate || 1);
	}

	function seekAndPlay(ms) {
		const audio = $songQueue.audio;
		if (!audio) return;
		audio.currentTime = Math.max(0, ms / 1000);
		clock.jumped();
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
		renderer?.event('spawn', game.state, ICONS[iconIndex]);
		screen = 'playing';
		checkpointCount = 0;
		held.clear();
	}

	function respawn() {
		if (!game || screen !== 'playing') return;
		game.attempt++;
		const from = game.begin(game.practice);
		checkpointCount = game.checkpoints.length;
		renderer?.reset(game.state);
		renderer?.event('spawn', game.state, ICONS[iconIndex]);
		seekAndPlay(from);
	}

	function pause() {
		if (screen !== 'playing' || !game) return;
		$songQueue.audio?.pause();
		// Dead: it starts again when it goes on
		clearTimeout(respawnTimer);
		screen = 'paused';
		release();
	}

	function resume() {
		if (screen !== 'paused') return;
		screen = 'playing';
		if (game?.status === 'dead') respawn();
		else $songQueue.audio?.play().catch(() => {});
	}

	function restart() {
		if (!game) return;
		clearTimeout(respawnTimer);
		const auto = game.auto;
		game.practice = practice && !auto;
		game.attempt++;
		seekAndPlay(game.begin(false));
		checkpointCount = 0;
		renderer?.reset(game.state);
		renderer?.event('spawn', game.state, ICONS[iconIndex]);
		screen = 'playing';
	}

	function togglePractice() {
		practice = !practice;
		if (!game) return;
		game.practice = practice && !game.auto;
		if (!practice) game.checkpoints = [];
		checkpointCount = game.checkpoints.length;
	}

	/** How many checkpoints there are now (for the buttons) */
	let checkpointCount = $state(0);

	/** Practice: a checkpoint where the player is (at the time of the press) */
	function placeCheckpoint(event) {
		if (!game || screen !== 'playing') return;
		const at = event ? eventTime(event) : songTime();
		const now = game.checkpoints.length;
		if (!game.placeCheckpoint(at)) return;
		// (set already: it was asked for at a time that's played; else it comes with the update)
		if (game.checkpoints.length > now) {
			renderer?.event('checkpoint', game.state, ICONS[iconIndex]);
			playDashSound('checkpoint', 0.25);
		}
		checkpointCount = game.checkpoints.length;
	}

	/** Practice: the last checkpoint goes */
	function removeCheckpoint() {
		if (!game || (screen !== 'playing' && screen !== 'paused')) return;
		if (game.removeCheckpoint()) playDashSound('click', 0.4);
		checkpointCount = game.checkpoints.length;
	}

	/** The keys that set and take away checkpoints: Z and X, or C and V where those jump */
	const checkpointKeys = () => {
		const jump = keys();
		return {
			place: jump.includes('KeyZ') ? 'KeyC' : 'KeyZ',
			remove: jump.includes('KeyX') ? 'KeyV' : 'KeyX'
		};
	};
	const keyName = (code) => code.replace(/^Key/, '');

	function exit() {
		clearTimeout(respawnTimer);
		dashOpen.set(false);
	}

	/** Out of the level, back to the menu (the song goes on there) */
	function toMenu() {
		clearTimeout(respawnTimer);
		release();
		results = null;
		if (stale) {
			screen = 'loading';
			reload++;
			return;
		}
		if (game) {
			game.begin(false);
			game.status = 'ready';
			renderer?.reset(game.state);
		}
		screen = game ? 'ready' : 'loading';
		$songQueue.audio?.play().catch(() => {});
	}

	/** The next song of the list, its level made (from the results: the list shows first) */
	async function nextSong() {
		results = null;
		stale = false;
		screen = 'loading';
		await tick();
		if (!songs?.next()) toMenu();
	}

	function finish() {
		if (!game) return;
		const key = bestKey(levelKey, difficulty, modesMark($dashModes));
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
	function setHeld(source, down, event) {
		if (!game || screen !== 'playing') return;
		const before = held.size > 0;
		if (down) held.add(source);
		else held.delete(source);
		const after = held.size > 0;
		if (before !== after) {
			game.input(after, eventTime(event));
			if (after && !game.auto) playDashSound('click', 0.3);
		}
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
		// Typing in the search: not for the game (Esc there only leaves the search)
		if (event.target instanceof HTMLInputElement) return;
		if (event.key === 'Escape' && event.type === 'keydown') {
			event.preventDefault();
			if (screen === 'playing') pause();
			else if (screen === 'paused') resume();
			else if (screen === 'complete') toMenu();
			else exit();
			return;
		}
		// (unless F is one of the jump keys)
		if (
			event.type === 'keydown' &&
			event.code === 'KeyF' &&
			!event.repeat &&
			!keys().includes('KeyF')
		) {
			showFps = !showFps;
			return;
		}
		// The menu: ↑ ↓ through the songs, Enter takes one (or plays the one there)
		const menu = screen === 'ready' || screen === 'loading' || screen === 'error';
		if (
			menu &&
			event.type === 'keydown' &&
			(event.code === 'ArrowUp' || event.code === 'ArrowDown')
		) {
			event.preventDefault();
			songs?.move(event.code === 'ArrowUp' ? -1 : 1);
			return;
		}
		if (menu && event.type === 'keydown' && event.code === 'Enter') {
			event.preventDefault();
			if (!songs?.choose() && screen === 'ready') start(false);
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
			if (event.type === 'keydown' && !event.repeat && game?.practice) {
				const cp = checkpointKeys();
				if (event.code === cp.place) placeCheckpoint(event);
				else if (event.code === cp.remove) removeCheckpoint();
			}
			return;
		}
		event.preventDefault();
		if (event.repeat) return;
		if (event.type === 'keydown' && screen === 'ready') return start(false);
		if (event.type === 'keydown' && screen === 'paused') return resume();
		setHeld(event.code, event.type === 'keydown', event);
	}

	function onPointer(event) {
		if (event.button !== 0 && event.type === 'pointerdown') return;
		if (screen !== 'playing') return;
		event.preventDefault();
		setHeld(`pointer${event.pointerId}`, event.type === 'pointerdown', event);
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
		let frames = 0;
		let since = performance.now();
		const loop = () => {
			frame = requestAnimationFrame(loop);
			frames++;
			const now = performance.now();
			if (now - since >= 500) {
				fps = Math.round((frames * 1000) / (now - since));
				frames = 0;
				since = now;
			}
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
						const key = bestKey(levelKey, difficulty, modesMark($dashModes));
						if (!g.auto) best = saveBest(key, Math.floor(g.progress), g.practice, g.attempt);
						clearTimeout(respawnTimer);
						respawnTimer = setTimeout(respawn, RESPAWN);
					} else if (name === 'checkpoint') {
						playDashSound('checkpoint', 0.25);
						checkpointCount = g.checkpoints.length;
					} else if (name === 'complete') {
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
					state: g.view(time),
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

	/** An icon's picture out of the sprites, as a 32 px button's background */
	function iconLook(icon) {
		const [x, y, w, h] = SPRITES[icon.sprite];
		const k = 32 / Math.max(w, h);
		return `background: url(${spritesUrl}) ${-x * k}px ${-y * k}px / ${ATLAS[0] * k}px ${ATLAS[1] * k}px no-repeat`;
	}
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
	{#if showFps}
		<p
			class="absolute top-12 left-3 z-10 px-2 py-0.5 rounded-md bg-black/45 text-xs font-bold tabular-nums text-white/75 pointer-events-none"
			title="Frames per second (F)"
		>
			{fps} FPS
		</p>
	{/if}

	{#if screen === 'playing'}
		<div class="absolute top-14 right-4 z-10 flex gap-2">
			{#if game?.practice}
				<span
					class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-emerald-400/90 text-emerald-950 text-xs font-black tracking-wide"
				>
					<span class="icon-[mingcute--flag-2-line] size-4"></span>
					PRACTICE
				</span>
				<button
					class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-black/40 ring-1 ring-emerald-300/40 text-emerald-200 hover:text-white text-xs font-bold cursor-pointer"
					title="Set a checkpoint here ({keyName(checkpointKeys().place)})"
					aria-label="Set a checkpoint"
					onpointerdown={(e) => {
						e.stopPropagation();
						placeCheckpoint(e);
					}}
				>
					<span class="icon-[mingcute--add-line] size-4"></span>
					<kbd class="font-sans">{keyName(checkpointKeys().place)}</kbd>
				</button>
				<button
					class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-black/40 ring-1 ring-white/15 text-white/75 hover:text-white text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default"
					title="Remove the last checkpoint ({keyName(checkpointKeys().remove)})"
					aria-label="Remove the last checkpoint"
					disabled={!checkpointCount}
					onpointerdown={(e) => {
						e.stopPropagation();
						removeCheckpoint();
					}}
				>
					<span class="icon-[mingcute--delete-2-line] size-4"></span>
					<kbd class="font-sans">{keyName(checkpointKeys().remove)}</kbd>
					<span class="tabular-nums text-white/50">{checkpointCount}</span>
				</button>
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
				{#if game.practice}
					· <kbd class="font-sans">{keyName(checkpointKeys().place)}</kbd> checkpoint ·
					<kbd class="font-sans">{keyName(checkpointKeys().remove)}</kbd> removes it
				{/if}
			</p>
		{/if}
	{/if}

	{#if screen === 'loading' || screen === 'error' || (screen === 'ready' && game)}
		<div
			class="absolute inset-0 flex flex-wrap items-center justify-center content-center gap-4 p-6 pt-16 bg-black/35 overflow-y-auto"
			transition:fade={{ duration: 150 }}
		>
			<button
				class="absolute top-14 right-4 grid place-items-center size-9 rounded-full bg-black/40 ring-1 ring-white/15 text-white/80 hover:text-white cursor-pointer"
				title="Leave Dash (Esc)"
				aria-label="Leave Dash"
				onclick={exit}
			>
				<span class="icon-[mingcute--close-line] size-5"></span>
			</button>
			<DashSongs bind:this={songs} {difficulty} mark={modesMark($dashModes)} />
			{#if screen === 'loading'}
				<div
					class="w-[min(30rem,100%)] h-[min(34rem,70vh)] grid place-items-center rounded-3xl bg-black/60 backdrop-blur-xl ring-1 ring-white/15"
				>
					<p class="flex items-center gap-3 text-lg font-semibold text-white/80">
						<span class="icon-[mingcute--loading-line] size-6 animate-spin"></span>
						Building the level…
					</p>
				</div>
			{:else if screen === 'error'}
				<div
					class="w-[min(30rem,100%)] h-[min(34rem,70vh)] flex flex-col items-center justify-center gap-4 p-6 text-center rounded-3xl bg-black/60 backdrop-blur-xl ring-1 ring-white/15"
				>
					<span class="icon-[mingcute--music-2-line] size-10 text-white/40"></span>
					<p class="text-white/80">{message}</p>
					<p class="text-sm text-white/45">Choose a song on the left.</p>
				</div>
			{:else if game}
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
								title={DIFFICULTY_INFO[d].about}
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
					<p class="-mt-3 text-center text-xs text-white/50">{DIFFICULTY_INFO[difficulty].about}</p>

					<div class="flex items-center justify-between gap-3">
						<div class="flex gap-1.5">
							{#each ICONS as icon, i (i)}
								<button
									class="size-8 rounded-lg ring-2 cursor-pointer transition {iconIndex === i
										? 'ring-white scale-110'
										: 'ring-transparent opacity-70 hover:opacity-100'}"
									style={iconLook(icon)}
									aria-label="Icon {i + 1}"
									onclick={() => (iconIndex = i)}
								></button>
							{/each}
						</div>
						<div class="flex items-center gap-2">
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
							{#if practice}
								<button
									class="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold cursor-pointer transition {autoCheckpoints
										? 'bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/40'
										: 'bg-white/10 text-white/60 hover:text-white'}"
									role="switch"
									aria-checked={autoCheckpoints}
									title="Checkpoints on their own every few seconds. Your own: {keyName(
										checkpointKeys().place
									)} sets one, {keyName(checkpointKeys().remove)} removes the last"
									onclick={() => (autoCheckpoints = !autoCheckpoints)}
								>
									Auto
								</button>
							{/if}
							<DashModesMenu />
							<DashSoundMenu />
						</div>
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
			{/if}
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
					{#if game.practice}
						<button
							class="grid place-items-center size-12 rounded-full bg-white/15 cursor-pointer hover:bg-white/25 transition disabled:opacity-40 disabled:cursor-default"
							title="Remove the last checkpoint ({keyName(checkpointKeys().remove)})"
							aria-label="Remove the last checkpoint"
							disabled={!checkpointCount}
							onclick={removeCheckpoint}
						>
							<span class="icon-[mingcute--delete-2-line] size-6"></span>
						</button>
					{/if}
					<button
						class="grid place-items-center size-12 rounded-full bg-white/15 cursor-pointer hover:bg-white/25 transition"
						title="Back to the songs"
						aria-label="Back to the songs"
						onclick={toMenu}
					>
						<span class="icon-[mingcute--menu-line] size-6"></span>
					</button>
					<DashSoundMenu up />
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
						onclick={() => (stale ? ((screen = 'loading'), reload++) : start(false))}
					>
						<span class="icon-[mingcute--refresh-2-line] size-5"></span>
						{stale ? 'Next level' : 'Play again'}
					</button>
					<button
						class="h-11 px-6 rounded-full bg-white/15 font-semibold flex items-center gap-2 cursor-pointer hover:bg-white/25 transition"
						onclick={nextSong}
					>
						<span class="icon-[mingcute--skip-forward-line] size-5"></span>
						Next song
					</button>
					<button
						class="h-11 px-6 rounded-full bg-white/15 font-semibold flex items-center gap-2 cursor-pointer hover:bg-white/25 transition"
						title="Back to the songs (Esc)"
						onclick={toMenu}
					>
						<span class="icon-[mingcute--menu-line] size-5"></span>
						Songs
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
