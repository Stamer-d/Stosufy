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
	import { heardTime, silence, tellHeardTime } from '#lib/stores/equalizer.ts';
	import { songLevel } from '#lib/stores/mixer.ts';
	import { BufferSong } from '#lib/dash/player.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { isPreviewing } from '#lib/stores/stream.ts';
	import { beatmapContent } from '#lib/hitsounds/player.ts';
	import { chosenMapId, difficulties } from '#lib/gameplay/play.ts';
	import DashMenu from './DashMenu.svelte';
	import DashSoundMenu from './DashSoundMenu.svelte';
	import { allowedModes, dashModes, modesMark } from '#lib/dash/modes.ts';
	import { dashOpen } from '#lib/dash/store.ts';
	import { makeLevel } from '#lib/dash/level.ts';
	import { decodedAudio, hearAudio } from '#lib/dash/audio.ts';
	import { DashGame, RESPAWN, bestKey, bestOfSet, saveBest } from '#lib/dash/game.ts';
	import { createDashRenderer, ICONS } from '#lib/dash/render.ts';
	import { backgroundUrls } from '#lib/stores/data.ts';
	import { playDashSound } from '#lib/dash/sound.ts';
	import { dashSounds } from '#lib/dash/sounds.ts';
	import { SongClock } from '#lib/dash/clock.ts';
	import { lineAt, lyrics, lyricsOffset, lyricsWanted, shownLyrics } from '#lib/stores/lyrics.ts';

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
	/** The beatmap's background for the level's colours (kept for a renderer made later) */
	let themeImage = null;
	/** The set and difficulty whose background was asked for last */
	let themeFor = '';

	/** Loads the background of a beatmap (the first of its places that loads) for the level */
	async function loadTheme(setId, mapId) {
		const key = `${setId}:${mapId}`;
		if (key === themeFor) return;
		themeFor = key;
		themeImage = null;
		renderer?.setTheme(null);
		const urls = await backgroundUrls(setId, mapId).catch(() => []);
		for (const url of urls) {
			const image = new Image();
			image.crossOrigin = 'anonymous';
			image.src = url;
			try {
				await image.decode();
			} catch {
				continue;
			}
			if (themeFor !== key) return;
			themeImage = image;
			renderer?.setTheme(image);
			return;
		}
	}
	/** @type {DashGame | null} */
	let game = $state(null);
	/** 'loading' | 'error' | 'ready' | 'playing' | 'paused' | 'complete' */
	let screen = $state('loading');
	let message = $state('');
	let best = $state({ normal: 0, practice: 0, attempts: 0 });
	let results = $state(null);
	let progressShown = $state(0);

	// --- The song in the level: its lyrics, the countdown to its drops, its name at the start ---

	/** The line being sung (its index among the synced lines; -1: none to show) */
	let lyricIndex = $state(-1);
	/** What the countdown to a drop shows now ('' nothing) */
	let countdown = $state('');
	/** The song's name shows (the first seconds of the first attempt) */
	let intro = $state(false);

	// (the lyrics are looked up while Dash is open and wants them)
	$effect(() => {
		if (!$dashSounds.lyrics) return;
		lyricsWanted.update((n) => n + 1);
		return () => lyricsWanted.update((n) => n - 1);
	});
	/** The synced lines of this song, if they're of this version of it */
	let lyricLines = $derived(
		$dashSounds.lyrics && $lyrics.status === 'found' && !$lyrics.lyrics?.otherVersion
			? ($lyrics.lyrics?.lines ?? null)
			: null
	);
	let lyricText = $derived(
		lyricIndex >= 0
			? (($shownLyrics.key === $lyrics.key ? $shownLyrics.lines?.[lyricIndex] : null) ??
					lyricLines?.[lyricIndex]?.text ??
					'')
			: ''
	);

	/** The song's drops: the three beats before each, the drop, and when its "GO!" is over (ms) */
	let drops = $derived.by(() => {
		const level = game?.level;
		if (!level) return [];
		const out = [];
		let before = -Infinity;
		for (const k of level.kiai) {
			// (a drop: not right at the start, and not right after the one before)
			if (k.start > level.start + 3000 && k.start < level.end - 1000 && k.start - before > 4000) {
				const beats = level.beats.filter((b) => b.time < k.start - 20).slice(-3);
				if (beats.length === 3 && k.start - beats[0].time < 4000)
					out.push({
						marks: [beats[0].time, beats[1].time, beats[2].time, k.start],
						end: k.start + Math.min(900, (k.start - beats[2].time) * 2)
					});
			}
			before = k.end;
		}
		return out;
	});

	/** What of the song shows at a song time (set only when it changes) */
	function showSong(time, playing) {
		let line = -1;
		if (playing && lyricLines) {
			const at = time / 1000 + $lyricsOffset;
			const index = lineAt(lyricLines, at);
			// (a line stays until the next one, but not through a long stretch without singing)
			if (index >= 0 && lyricLines[index].text.trim() && at - lyricLines[index].time < 9)
				line = index;
		}
		if (line !== lyricIndex) lyricIndex = line;
		let count = '';
		if (playing && $dashSounds.countdown)
			for (const drop of drops) {
				if (time < drop.marks[0] || time >= drop.end) continue;
				count =
					time >= drop.marks[3]
						? 'GO!'
						: time >= drop.marks[2]
							? '1'
							: time >= drop.marks[1]
								? '2'
								: '3';
			}
		if (count !== countdown) countdown = count;
		const first =
			playing &&
			!!game &&
			game.attempt === 1 &&
			time < game.level.start + 3200 &&
			time > game.level.start + 150;
		if (first !== intro) intro = first;
	}
	/** Frames drawn a second (counted over half a second) */
	let fps = $state(0);
	/** How sharp the level is drawn now (lowered where frames come too slowly) */
	let sharpness = $state(1);
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
			// (the decoded song itself plays the level, exact to the sample: see player.ts)
			const decoded = decodedAudio(`${current.id}:${id}`);
			handBack();
			exact = decoded && audio ? { audio, song: new BufferSong(decoded) } : null;
			exactReady = !!exact;
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
				// (in the colours of its background, once that's loaded)
				loadTheme(current.id, id);
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

	/**
	 * The decoded song, played in the audio element's place while a level runs (the element goes
	 * on silently, so the rest of the app follows along): null where the song couldn't be read
	 * @type {{ audio: HTMLAudioElement, song: BufferSong } | null}
	 */
	let exact = null;
	/** Whether this level's song is read (for the menu) */
	let exactReady = $state(false);
	/** Whether the decoded song is what's heard now */
	let exactOn = false;

	/** Whether the decoded song can play this audio now (not with a speed mod that keeps the pitch) */
	const exactFor = (audio) =>
		!!exact && exact.audio === audio && (audio.playbackRate === 1 || !audio.preservesPitch);

	/** Where the song is as it's heard (ms) */
	function rawTime(audio) {
		return exactOn && exact?.audio === audio ? exact.song.time() : heardTime(audio);
	}

	function songTime() {
		const audio = $songQueue.audio;
		if (!audio) return 0;
		return clock.read(rawTime(audio), performance.now(), audio.paused, audio.playbackRate || 1);
	}

	/** The song time an input event happened at (not when it's handled) */
	function eventTime(event) {
		const audio = $songQueue.audio;
		if (!audio) return 0;
		const now = performance.now();
		return clock.at(event.timeStamp, rawTime(audio), now, audio.paused, audio.playbackRate || 1);
	}

	function seekAndPlay(ms) {
		const audio = $songQueue.audio;
		if (!audio) return;
		audio.currentTime = Math.max(0, ms / 1000);
		clock.jumped();
		audio.play().catch(() => {});
		if (!exactFor(audio)) return void handBack(false);
		const song = exact.song;
		const begin = () => {
			if (!song.start(ms, audio.playbackRate || 1, songLevel(audio))) return false;
			exactOn = true;
			silence(audio, true);
			tellHeardTime(audio, () => song.time());
			clock.jumped();
			return true;
		};
		// (the audio context may still have to wake up: the element plays until it has)
		if (!begin())
			BufferSong.ready().then((ok) => {
				if (!ok || exact?.song !== song || exactOn || audio.paused || screen !== 'playing') return;
				const at = audio.currentTime * 1000;
				ms = at;
				begin();
			});
	}

	/** The song stops (a crash, a pause) */
	function pauseSong() {
		const audio = $songQueue.audio;
		audio?.pause();
		if (exactOn) exact?.song.pause();
	}

	/** The song goes on where it stopped */
	function resumeSong() {
		const audio = $songQueue.audio;
		if (!audio) return;
		audio.play().catch(() => {});
		if (exactOn && exact?.audio === audio && !exact.song.resume(songLevel(audio))) handBack();
		clock.jumped();
	}

	/** The audio element is heard again (out of the level): from where the decoded song is */
	function handBack(seek = true) {
		if (!exactOn || !exact) return;
		exactOn = false;
		const { audio, song } = exact;
		const at = song.playing ? song.stop() : song.time();
		song.stop();
		tellHeardTime(audio, null);
		silence(audio, false);
		if (seek && $songQueue.audio === audio && isFinite(at) && at > 0) {
			audio.currentTime = Math.min(at / 1000, (audio.duration || Infinity) - 0.05);
			clock.jumped();
		}
	}
	$effect(() => () => handBack());

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
		pauseSong();
		// Dead: it starts again when it goes on
		clearTimeout(respawnTimer);
		screen = 'paused';
		release();
	}

	function resume() {
		if (screen !== 'paused') return;
		screen = 'playing';
		if (game?.status === 'dead') respawn();
		else resumeSong();
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
			handBack();
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
		handBack();
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
		if (themeImage) renderer.setTheme(themeImage);
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
				sharpness = renderer?.quality() ?? 1;
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
						pauseSong();
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
			showSong(time, screen === 'playing' && g.status === 'playing');
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
	{#if showFps && (screen === 'playing' || screen === 'paused')}
		<p
			class="absolute top-12 left-3 z-10 px-2 py-0.5 rounded-md bg-black/45 text-xs font-bold tabular-nums text-white/75 pointer-events-none"
			title="Frames per second (F); the resolution where it's lowered to keep them up"
		>
			{fps} FPS{#if sharpness < 1}&nbsp;· {Math.round(sharpness * 100)}%{/if}
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
		<!-- The song in the level: its name at the start, its lyrics, the countdown to a drop -->
		{#if intro && game}
			<div
				class="absolute inset-x-0 top-[22%] flex flex-col items-center gap-1 px-6 text-center pointer-events-none"
				in:fly={{ y: 12, duration: 350 }}
				out:fade={{ duration: 500 }}
			>
				<p class="song-text text-4xl sm:text-5xl font-black leading-tight line-clamp-2">
					{game.level.title}
				</p>
				<p class="song-text text-lg sm:text-xl font-bold text-white/80">{game.level.artist}</p>
			</div>
		{/if}
		{#if lyricText && !intro && !countdown}
			{#key lyricIndex}
				<p
					class="song-text absolute inset-x-0 top-[11%] mx-auto w-fit max-w-[80%] px-4 text-center text-2xl sm:text-3xl font-black leading-snug pointer-events-none"
					in:fly={{ y: 10, duration: 180 }}
					out:fade={{ duration: 120 }}
				>
					{lyricText}
				</p>
			{/key}
		{/if}
		{#if countdown}
			{#key countdown}
				<p
					class="song-text absolute inset-x-0 top-[16%] text-center font-black pointer-events-none {countdown ===
					'GO!'
						? 'text-7xl sm:text-8xl text-yellow-300'
						: 'text-6xl sm:text-7xl'}"
					in:zoom={{ start: 1.7, duration: 220 }}
					out:fade={{ duration: 100 }}
				>
					{countdown}
				</p>
			{/key}
		{/if}
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
		<DashMenu
			{screen}
			{message}
			{game}
			{song}
			bind:difficulty
			bind:iconIndex
			{practice}
			bind:autoCheckpoints
			{best}
			exact={exactReady}
			checkpointKeys={checkpointKeys()}
			bind:songs
			onplay={start}
			onpractice={togglePractice}
			onexit={exit}
		/>
	{:else if screen === 'paused' && game}
		<div
			class="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-sm"
			transition:fade={{ duration: 120 }}
		>
			<div
				class="w-[min(26rem,calc(100%-2rem))] flex flex-col gap-5 p-6 rounded-3xl bg-black/65 ring-1 ring-white/12 shadow-2xl"
				in:fly={{ y: 10, duration: 150 }}
			>
				<div class="text-center">
					<p class="text-3xl font-black tracking-wide">Paused</p>
					<p class="mt-1 text-sm text-white/55 truncate">{game.level.title}</p>
				</div>
				<div>
					<div class="flex justify-between text-xs font-bold mb-1.5 text-white/55">
						<span>Attempt {game.attempt}</span>
						<span class="tabular-nums text-white">{pct(game.progress)}</span>
					</div>
					<div class="relative h-3 rounded-full bg-white/10 overflow-hidden">
						<div
							class="h-full rounded-full {game.practice ? 'bg-emerald-400' : 'bg-white'}"
							style="width: {game.progress}%"
						></div>
						<span
							class="absolute inset-y-0 w-0.5 bg-amber-300"
							style="left: {Math.min(100, game.practice ? best.practice : best.normal)}%"
							title="Your best"
						></span>
					</div>
				</div>
				<button
					class="h-13 py-3 rounded-full bg-white text-black text-lg font-black flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.02] transition"
					onclick={resume}
				>
					<span class="icon-[mingcute--play-fill] size-6"></span>
					Resume
					<kbd class="ml-1 px-1.5 py-0.5 rounded-md bg-black/10 text-[11px] font-bold font-sans"
						>Esc</kbd
					>
				</button>
				<div class="grid grid-cols-3 gap-2">
					<button
						class="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/8 text-sm font-semibold text-white/80 cursor-pointer hover:bg-white/15 hover:text-white transition"
						onclick={restart}
					>
						<span class="icon-[mingcute--refresh-2-line] size-6"></span>
						Restart <kbd class="font-sans text-[10px] text-white/40">R</kbd>
					</button>
					<button
						class="flex flex-col items-center gap-1 py-3 rounded-2xl text-sm font-semibold cursor-pointer transition {practice
							? 'bg-emerald-400 text-emerald-950'
							: 'bg-white/8 text-white/80 hover:bg-white/15 hover:text-white'}"
						aria-pressed={practice}
						onclick={togglePractice}
					>
						<span class="icon-[mingcute--flag-2-line] size-6"></span>
						Practice
						<kbd class="font-sans text-[10px] {practice ? 'text-emerald-900' : 'text-white/40'}"
							>P</kbd
						>
					</button>
					<button
						class="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/8 text-sm font-semibold text-white/80 cursor-pointer hover:bg-white/15 hover:text-white transition"
						onclick={toMenu}
					>
						<span class="icon-[mingcute--menu-line] size-6"></span>
						Songs <span class="text-[10px] text-white/40">menu</span>
					</button>
				</div>
				<div class="flex items-center justify-between gap-2">
					{#if game.practice}
						<button
							class="flex items-center gap-2 h-10 px-4 rounded-full bg-white/8 text-sm font-semibold text-white/75 cursor-pointer hover:bg-white/15 hover:text-white transition disabled:opacity-40 disabled:cursor-default"
							disabled={!checkpointCount}
							onclick={removeCheckpoint}
						>
							<span class="icon-[mingcute--delete-2-line] size-5"></span>
							Remove last checkpoint ({checkpointCount})
						</button>
					{:else}
						<span class="text-xs text-white/35">Hold to keep jumping</span>
					{/if}
					<DashSoundMenu up labelled />
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

<style>
	/* Text over the level: readable on any of its colours */
	.song-text {
		text-shadow:
			0 0 2px rgba(0, 0, 0, 0.9),
			0 2px 0 rgba(0, 0, 0, 0.75),
			0 0 18px rgba(0, 0, 0, 0.55);
	}
</style>
