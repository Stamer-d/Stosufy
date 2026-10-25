<script>
	// The puzzle, in two ways: against the clock (a song's background to put back together
	// while the song plays, muffled until the picture is whole, the fastest times on
	// leaderboards) and relaxed (any picture, any number of pieces, no time and no score).
	import { onMount } from 'svelte';
	import { fly, fade, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { get } from 'svelte/store';
	import { currentSong, setSongQueue, togglePlayback } from '#lib/stores/audio.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import { formatSongData, mapDataStore } from '#lib/stores/data.ts';
	import { setMuffle } from '#lib/stores/equalizer.ts';
	import { playSkinSound } from '#lib/hitsounds/player.ts';
	import { librarySong } from '#lib/stores/radio.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import { sameSong } from '#lib/tracks.ts';
	import {
		getDailyPuzzle,
		getDailyPuzzleBoard,
		getPuzzleBoard,
		getPuzzleTop,
		submitPuzzle
	} from '#lib/api.ts';
	import {
		DIFFICULTIES,
		MODES,
		MODS,
		PEEK_PENALTY,
		formatTime,
		gridFor,
		hashString,
		loadBackground,
		loadDaily,
		loadDailyBackground,
		loadImage,
		loadRelaxedDone,
		localDailyPuzzle,
		newSaveId,
		loadRecords,
		pieceCount,
		puzzleScore,
		puzzleSeed,
		puzzleSongs,
		saveRecord,
		solveDaily,
		scoreBoard,
		scoreMultiplier,
		rankingBoard
	} from '#lib/puzzle/puzzle.ts';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';
	import SongCover from '#lib/components/SongCover.svelte';
	import Triangles from '#lib/components/Triangles.svelte';
	import Jigsaw from '#lib/components/puzzle/Jigsaw.svelte';
	import SlidePuzzle from '#lib/components/puzzle/SlidePuzzle.svelte';
	import SpinPuzzle from '#lib/components/puzzle/SpinPuzzle.svelte';
	import PuzzleResults from '#lib/components/puzzle/PuzzleResults.svelte';
	import PuzzleLeaderboard from '#lib/components/puzzle/PuzzleLeaderboard.svelte';
	import RelaxedSetup from '#lib/components/puzzle/RelaxedSetup.svelte';
	import RelaxedPuzzle from '#lib/components/puzzle/RelaxedPuzzle.svelte';
	import Bursts from '#lib/components/puzzle/Bursts.svelte';
	import PuzzleTable from '#lib/components/puzzle/PuzzleTable.svelte';
	import PuzzleOptions from '#lib/components/puzzle/PuzzleOptions.svelte';
	import Puzzle3D from '#lib/components/puzzle/Puzzle3D.svelte';
	import {
		finishSound,
		missSound,
		puzzleVolume,
		setPuzzleVolume,
		snapSound,
		sparkleSound
	} from '#lib/puzzle/sounds.ts';

	const PUZZLES = { jigsaw: Jigsaw, slide: SlidePuzzle, spin: SpinPuzzle };

	// --- The choices, remembered ------------------------------------------------------------

	const SETTINGS_KEY = 'puzzleSettings';
	let choice = $state(readSettings());
	function readSettings() {
		const fallback = { style: 'timed', mode: 'jigsaw', difficulty: 1, mods: [], muffle: true };
		try {
			const saved = { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
			// It went by the beat before it went by time, and Easy was a mod then
			if (saved.style === 'rhythm') saved.style = 'timed';
			saved.mods = saved.mods.filter((id) => MODS.some((mod) => mod.id === id));
			return saved;
		} catch {
			return fallback;
		}
	}
	$effect(() => {
		const saved = JSON.stringify(choice);
		try {
			localStorage.setItem(SETTINGS_KEY, saved);
		} catch {
			// (not remembered)
		}
	});
	function toggleMod(id) {
		choice.mods = choice.mods.includes(id)
			? choice.mods.filter((mod) => mod !== id)
			: [...choice.mods, id];
	}
	/** The mods that count for a mode (Spun is only for the jigsaw) */
	const modsFor = (mode, mods) =>
		mods.filter((id) => MODS.find((mod) => mod.id === id)?.modes?.includes(mode) ?? true);

	// --- The song --------------------------------------------------------------------------

	let library = $derived(formatSongData($mapDataStore));
	let chosen = $state(null);
	// The song playing, else (once the library is there) a random one
	$effect(() => {
		if (!chosen) chosen = $currentSong.song ?? (library.length ? randomSong() : null);
	});
	function randomSong(except = null) {
		const songs = puzzleSongs().filter((song) => !sameSong(song, except));
		return songs.length ? songs[Math.floor(Math.random() * songs.length)] : null;
	}

	let query = $state('');
	let matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return [];
		return library
			.filter((song) => {
				const text = [song.title, song.artist, song.songSource, song.creator]
					.join(' ')
					.toLowerCase();
				return words.every((word) => text.includes(word));
			})
			.slice(0, 30);
	});

	// --- The daily puzzle: from the server, the same for everyone ----------------------------

	/** Without the server (offline, not logged in): one from the library, not ranked */
	let localDaily = $derived.by(() => {
		void $mapDataStore;
		return localDailyPuzzle();
	});
	let serverDaily = $state(null);
	let daily = $derived(serverDaily?.day === localDaily.day ? serverDaily : localDaily);
	let dailyState = $state(loadDaily());

	async function loadServerDaily() {
		const token = get(keyStore).access_token;
		if (!token) return;
		try {
			const found = await getDailyPuzzle(token);
			if (!found) return;
			// The downloaded song if it's in the library (its music plays), else what osu! said
			const song = librarySong({ id: found.setId, beatmaps: [] }) ?? {
				id: found.setId,
				title: found.title ?? '',
				artist: found.artist ?? '',
				beatmaps: found.mapId ? [{ id: found.mapId }] : []
			};
			serverDaily = { ...found, song, online: true };
		} catch (error) {
			console.error("Could not load today's puzzle:", error);
		}
	}
	// Once logged in (and again on each visit to the menu)
	$effect(() => {
		if ($keyStore.access_token) loadServerDaily();
	});

	/** Today's puzzle once it's solved: the first score and time (and its place, online) */
	let dailyDone = $derived(
		daily.online
			? daily.mine
			: dailyState.day === daily.day && dailyState.time
				? { time: dailyState.time, score: dailyState.score ?? 0 }
				: null
	);
	let streak = $derived(daily.online ? (daily.streak ?? 0) : dailyState.streak);

	let records = $state(loadRecords());
	/** Solved pictures, the fastest of each song first by when */
	let gallery = $derived.by(() => {
		const bySong = new Map();
		for (const record of Object.values(records)) {
			const kept = bySong.get(record.setId);
			if (!kept || record.at > kept.at) bySong.set(record.setId, record);
		}
		return [...bySong.values()].sort((a, b) => b.at - a.at);
	});

	// --- Playing ----------------------------------------------------------------------------

	/** 'menu', 'loading', 'play', 'results' or 'relaxed' */
	let view = $state('menu');
	let game = $state(null);
	let progress = $state(0);
	let moves = $state(0);
	let mistakes = $state(0);
	let placed = $state(0);
	let peeks = $state(0);
	let startedAt = $state(0);
	let now = $state(Date.now());
	let solvedAt = $state(0);
	let result = $state(null);
	/** How the leaderboard took the time: sending, done (with the board) or not ranked */
	let ranking = $state(null);
	let peeking = $state(false);
	let pointer = $state({ x: -1000, y: -1000 });

	// --- Leaderboards: a ranking of each mode, the chosen puzzle's and today's -------------

	const BOARD_SIZE = 10;
	/** The mode whose ranking shows */
	let rankMode = $state(choice.mode);
	let inMenu = $derived(view === 'menu' || view === 'loading');
	let rankBoard = $state({ board: null, error: null });
	let songBoard = $state({ board: null, error: null });
	let dayBoard = $state({ board: null, error: null });

	/**
	 * Loads a board while the menu shows (again on each visit): null while it loads, or why it
	 * can't be loaded
	 */
	function follow(token, why, load, show) {
		if (!inMenu) return;
		show({ board: null, error: null });
		if (!token) return show({ board: null, error: 'Log in with osu! to see the leaderboards.' });
		if (why) return show({ board: null, error: why });
		let stale = false;
		load(token)
			.then((board) => {
				if (!stale) show({ board, error: null });
			})
			.catch((error) => {
				console.error('Could not load the leaderboard:', error);
				if (!stale) show({ board: null, error: "Couldn't load the leaderboard." });
			});
		return () => (stale = true);
	}
	$effect(() => {
		const mode = rankMode;
		return follow(
			$keyStore.access_token,
			null,
			(token) => getPuzzleTop(token, 'score', mode, BOARD_SIZE).then(rankingBoard),
			(next) => (rankBoard = next)
		);
	});
	$effect(() => {
		const { mode, difficulty } = choice;
		const setId = Number(chosen?.id);
		return follow(
			$keyStore.access_token,
			!chosen
				? 'Pick a song to see its leaderboard.'
				: !(setId > 0)
					? 'Only songs from osu! have leaderboards.'
					: null,
			(token) => getPuzzleBoard(token, setId, mode, difficulty, BOARD_SIZE).then(scoreBoard),
			(next) => (songBoard = next)
		);
	});
	$effect(() => {
		const { day, online } = daily;
		return follow(
			$keyStore.access_token,
			online ? null : "Today's puzzle couldn't be loaded from the server.",
			(token) => getDailyPuzzleBoard(token, day, BOARD_SIZE).then(scoreBoard),
			(next) => (dayBoard = next)
		);
	});

	/** The first of a song's backgrounds that loads, and its shape */
	const loadPicture = (song) => loadBackground(song.id, song.beatmaps?.[0]?.id);

	/**
	 * Starts a puzzle of a song: it plays (with more of the library after it, so the music
	 * goes on; a daily song that isn't downloaded lets the music go on), and its background is
	 * cut up, the same way for everyone
	 */
	async function start(song, options = choice, isDaily = false) {
		if (!song) return;
		view = 'loading';
		let picture = null;
		const online = isDaily && daily.online;
		try {
			const playing = $currentSong.song;
			const downloaded = librarySong(song);
			if (downloaded && !sameSong(playing, downloaded)) {
				const more = puzzleSongs()
					.filter((other) => !sameSong(other, downloaded))
					.sort(() => Math.random() - 0.5)
					.slice(0, 40);
				await setSongQueue(0, [downloaded, ...more], 'playlist');
			} else if (!downloaded) await keepMusicGoing();
			else if (!$currentSong.isPlaying) togglePlayback();
			const mapId = song.beatmaps?.[0]?.id;
			picture = online ? await loadDailyBackground(song.id, mapId) : await loadPicture(song);
		} catch (error) {
			console.error('Could not start the puzzle:', error);
		}
		if (!picture) {
			showToast("Couldn't load this song's background", 'icon-[mingcute--pic-line]');
			view = 'menu';
			return;
		}
		const mods = isDaily ? [] : modsFor(options.mode, options.mods);
		const pieces = DIFFICULTIES[options.difficulty].pieces[options.mode];
		game = {
			song,
			...picture,
			...gridFor(pieces, picture.aspect),
			mode: options.mode,
			difficulty: options.difficulty,
			mods,
			muffle: options.muffle,
			daily: isDaily ? daily.day : null,
			dailyOnline: online,
			seed: isDaily ? daily.seed : puzzleSeed(song.id, options.mode, options.difficulty),
			key: Date.now()
		};
		chosen = librarySong(song) ?? chosen;
		progress = 0;
		moves = 0;
		mistakes = 0;
		placed = 0;
		peeks = 0;
		solvedAt = 0;
		ranking = null;
		startedAt = Date.now();
		view = 'play';
	}

	function playDaily() {
		if (!daily.song) return;
		start(
			daily.song,
			{ mode: daily.mode, difficulty: daily.difficulty, mods: [], muffle: choice.muffle },
			true
		);
	}

	const retry = () =>
		game &&
		start(
			game.song,
			{ mode: game.mode, difficulty: game.difficulty, mods: game.mods, muffle: game.muffle },
			!!game.daily
		);
	const next = () =>
		game &&
		start(randomSong(game.song), {
			mode: game.mode,
			difficulty: game.difficulty,
			mods: game.mods,
			muffle: game.muffle
		});
	function toMenu() {
		view = 'menu';
		peeking = false;
		records = loadRecords();
		dailyState = loadDaily();
		relaxedDone = loadRelaxedDone();
		loadServerDaily();
	}

	// --- Relaxed: any picture, any number of pieces, the music just plays on ----------------

	let relaxedGame = $state(null);
	let relaxedDone = $state(loadRelaxedDone());

	/** Music to puzzle to: what plays goes on, else the whole library on shuffle */
	async function keepMusicGoing() {
		if (!$currentSong.song) {
			const songs = puzzleSongs(false).sort(() => Math.random() - 0.5);
			if (songs.length) await setSongQueue(0, songs.slice(0, 200), 'playlist');
		} else if (!$currentSong.isPlaying) togglePlayback();
	}

	const pictureOf = (picture) =>
		picture.image ? loadImage([picture.image]) : loadBackground(picture.setId, picture.mapId);

	/** Opens a relaxed puzzle: a new one (`setup`) or one left unfinished (`save`) */
	async function openRelaxed(setup, save = null) {
		const picture = save?.picture ?? setup.picture;
		view = 'loading';
		let loaded = null;
		try {
			keepMusicGoing().catch((error) => console.error('Could not start the music:', error));
			loaded = await pictureOf(picture);
		} catch (error) {
			console.error('Could not open the puzzle:', error);
		}
		if (!loaded) {
			showToast("Couldn't load this picture", 'icon-[mingcute--pic-line]');
			view = 'menu';
			return;
		}
		const grid = save ? { cols: save.cols, rows: save.rows } : gridFor(setup.pieces, loaded.aspect);
		const mode = save ? (save.mode ?? 'jigsaw') : (setup.mode ?? 'jigsaw');
		relaxedGame = {
			id: save?.id ?? newSaveId(),
			mode,
			picture,
			...loaded,
			...grid,
			seed: save?.seed ?? Math.floor(Math.random() * 2 ** 32),
			ghost: save?.ghost ?? setup.ghost,
			outlines: save?.outlines ?? setup.outlines,
			saved: (mode === 'jigsaw' ? save?.pieces : save?.tiles) ?? null,
			time: save?.time ?? 0
		};
		view = 'relaxed';
	}

	let bursts = $state();
	let puzzle = $state();
	/** The puzzle shown in 3D, if one is */
	let shown3d = $state(null);
	let volume = $state(puzzleVolume());

	function act(action) {
		if (solvedAt) return;
		moves++;
		if (action.wrong) {
			mistakes++;
			missSound();
			bursts?.burst(action.x, action.y, { power: 0.2, color: '#ff5a5a' });
			return;
		}
		if (!action.home) return;
		// A piece in place: it pops, with a sound that climbs as the picture comes together
		placed++;
		const loud = 1.6 * volume;
		snapSound(progress);
		playSkinSound('normal', 'normal', loud);
		if (game.mode === 'jigsaw') playSkinSound('clap', 'normal', loud * 0.8);
		if (placed % 10 === 0) sparkleSound();
		bursts?.burst(action.x, action.y, { power: 1 });
		bursts?.ring(action.x, action.y, { color: '#66ccff' });
	}

	/**
	 * Shows a finished puzzle in 3D, cut like it was: from a record (with its picture, or the
	 * one given); older records without the cut get one like it
	 */
	async function view3d(record, shape, picture = null, pieces = 40) {
		const loaded =
			result?.record === record && result.url
				? { url: result.url, aspect: record.aspect }
				: await pictureOf(
						picture ?? record.picture ?? { setId: record.setId, mapId: record.mapId }
					);
		if (!loaded) {
			showToast("Couldn't load this picture", 'icon-[mingcute--pic-line]');
			return;
		}
		const aspect = record.aspect ?? loaded.aspect;
		shown3d = {
			url: loaded.url,
			aspect,
			...(record.cols ? { cols: record.cols, rows: record.rows } : gridFor(pieces, aspect)),
			seed: record.seed ?? hashString(String(record.at)),
			shape,
			title: record.title ?? record.picture?.title
		};
	}

	/** Puts the time on its leaderboard; what came of it, or why it isn't ranked */
	async function sendResult(record, pieces, online) {
		const token = get(keyStore).access_token;
		if (!token)
			return { status: 'unranked', message: 'Log in with osu! to get on the leaderboards.' };
		if (record.daily && !online) {
			return {
				status: 'unranked',
				message:
					"Today's puzzle came from your library (the server couldn't be reached), so it isn't ranked."
			};
		}
		if (!(Number(record.setId) > 0)) {
			return { status: 'unranked', message: 'Only songs from osu! have leaderboards.' };
		}
		try {
			const sent = await submitPuzzle(token, {
				setId: Number(record.setId),
				mapId: record.mapId != null && Number(record.mapId) > 0 ? Number(record.mapId) : null,
				mode: record.mode,
				difficulty: record.difficulty,
				mods: record.mods,
				time: Math.round(record.time),
				moves: record.moves,
				pieces,
				daily: record.daily
			});
			return { status: 'done', ...sent, board: scoreBoard(sent.board) };
		} catch (error) {
			console.error('Could not send the time:', error);
			return {
				status: 'unranked',
				message: "Couldn't reach the leaderboard. Your time is kept here."
			};
		}
	}

	function solved() {
		solvedAt = Date.now();
		peeking = false;
		finishSound();
		playSkinSound('finish', 'normal', 1.6 * volume);
		setTimeout(() => {
			const rect = puzzle?.boardRect();
			if (rect) bursts?.confetti(rect, 160);
		}, 700);
		const song = game.song;
		const time = solvedAt - startedAt + peeks * PEEK_PENALTY;
		const record = {
			setId: song.id,
			mapId: song.beatmaps?.[0]?.id ?? null,
			title: song.title ?? '',
			artist: song.artist ?? '',
			mode: game.mode,
			difficulty: game.difficulty,
			mods: game.mods,
			time,
			score: puzzleScore(game.mode, game.cols * game.rows, time, game.mods),
			moves,
			mistakes,
			peeks,
			at: solvedAt,
			daily: game.daily,
			seed: game.seed,
			cols: game.cols,
			rows: game.rows,
			aspect: game.aspect
		};
		const saved = saveRecord(record);
		const streakNow = game.daily ? solveDaily(record.time, record.score, game.daily) : null;
		const key = game.key;
		ranking = { status: 'sending' };
		sendResult(record, game.cols * game.rows, game.dailyOnline).then((sent) => {
			if (game?.key === key) ranking = sent;
		});
		// A moment to see the whole picture (and hear the music open up) first
		setTimeout(() => {
			if (game?.key !== key || view !== 'play') return;
			result = { record, ...saved, daily: streakNow, url: game.url };
			view = 'results';
		}, 2800);
	}

	// The music: muffled as if through a wall, opening up with each piece; whole at the end
	$effect(() => {
		if (view === 'play' && game?.muffle && !solvedAt) setMuffle(1 - progress * 0.8, 0.4);
		else setMuffle(0, solvedAt ? 1.5 : 0.3);
	});

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 100);
		const onKey = (event) => {
			if (view !== 'play' || event.target instanceof HTMLInputElement) return;
			if (event.key === 'Escape') toMenu();
			if (event.key.toLowerCase() === 'q' && !event.repeat) startPeek();
		};
		const onKeyUp = (event) => {
			if (event.key.toLowerCase() === 'q') peeking = false;
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			clearInterval(timer);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keyup', onKeyUp);
			setMuffle(0);
		};
	});

	/** A look at the whole picture: not with Hidden, and it costs a few seconds */
	function startPeek() {
		if (!game || game.mods.includes('HD') || solvedAt) return;
		peeking = true;
		peeks++;
	}

	let flashlight = $derived(view === 'play' && game?.mods.includes('FL') && !solvedAt ? 180 : 0);
	let elapsed = $derived(
		view === 'play' ? (solvedAt || now) - startedAt + peeks * PEEK_PENALTY : 0
	);
	/** Until the next daily puzzle, as 5h 12m */
	let untilNext = $derived.by(() => {
		const minutes = Math.max(0, Math.ceil((daily.nextAt - now) / 60000));
		return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
	});
	let multiplier = $derived(game ? scoreMultiplier(game.mods) : 1);
	/** What it's worth if it were solved now: it goes down while the clock runs */
	let liveScore = $derived(
		game ? puzzleScore(game.mode, game.cols * game.rows, elapsed, game.mods) : 0
	);
	let Puzzle = $derived(game ? PUZZLES[game.mode] : null);
	const modeOf = (id) => MODES.find((mode) => mode.id === id);
</script>

{#if view === 'menu' || view === 'loading'}
	<div class="pb-12">
		<!-- Header -->
		<div class="relative overflow-hidden">
			<div
				class="absolute inset-0 bg-gradient-to-br from-primary-400/70 via-primary-700/40 to-secondary-200"
			></div>
			<Triangles count={24} seed={11} />
			<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent"></div>
			<div class="relative px-8 pt-10 pb-6">
				<p class="text-sm font-bold uppercase tracking-wide text-white/70">Stosufy</p>
				<h1 class="flex items-center gap-3 text-5xl font-extrabold tracking-tight">
					<span class="icon-[ri--puzzle-2-line] size-11"></span>Puzzle
				</h1>
				<p class="mt-2 max-w-2xl text-white/80">
					{#if choice.style === 'relaxed'}
						Just puzzling: pick any picture and how many pieces, and put it together while your
						music plays. No time limit, no score, and it waits for you when you leave.
					{:else}
						Put the backgrounds of your songs back together as fast as you can while they play: the
						faster, the more points, and mods multiply them. The music stays muffled until the
						picture is whole, and the best scores go on the leaderboards: of every puzzle, of the
						daily puzzle and overall.
					{/if}
				</p>
				<div class="mt-5 flex flex-wrap items-center gap-4">
					<div
						class="inline-flex gap-1 p-1 rounded-full bg-black/30 backdrop-blur ring-1 ring-white/10"
						role="tablist"
					>
						{#each [['timed', 'Against the clock', 'icon-[mingcute--time-line]'], ['relaxed', 'Relaxed', 'icon-[ri--puzzle-2-line]']] as [id, label, icon] (id)}
							<button
								role="tab"
								aria-selected={choice.style === id}
								class="flex items-center gap-2 px-4 h-9 rounded-full text-sm font-semibold cursor-pointer transition {choice.style ===
								id
									? 'bg-white text-black'
									: 'text-white/80 hover:text-white hover:bg-white/10'}"
								onclick={() => (choice.style = id)}
							>
								<span class="{icon} size-4"></span>{label}
							</button>
						{/each}
					</div>
					<label
						class="flex items-center gap-2 px-3 h-11 rounded-full bg-black/30 backdrop-blur ring-1 ring-white/10 text-sm"
						title="How loud the puzzle's sounds are"
					>
						<span class="icon-[mingcute--volume-line] size-4 text-white/80"></span>
						<span class="text-white/80 font-semibold">Sounds</span>
						<input
							type="range"
							min="0"
							max="1.5"
							step="0.05"
							bind:value={volume}
							onchange={() => {
								setPuzzleVolume(volume);
								snapSound(0.6);
							}}
							class="w-28 accent-primary-400"
						/>
					</label>
				</div>
			</div>
		</div>

		<div class="px-8 flex flex-col gap-10">
			{#if choice.style === 'relaxed'}
				<RelaxedSetup
					busy={view === 'loading'}
					onstart={(setup) => openRelaxed(setup)}
					onresume={(save) => openRelaxed(null, save)}
				/>
			{:else}
				<!-- Today's puzzle -->
				{#if daily.song}
					<section class="relative h-52 rounded-xl overflow-hidden">
						<BeatmapBackground
							setId={daily.song.id}
							mapId={daily.song.beatmaps?.[0]?.id}
							title={daily.song.title}
							class="absolute inset-0"
							imageClass={dailyDone ? '' : 'blur-md scale-110'}
						/>
						<div
							class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10"
						></div>
						<div class="relative h-full flex items-end justify-between gap-6 p-6">
							<div class="min-w-0">
								<p
									class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary-400"
								>
									<span class="icon-[mingcute--calendar-day-line] size-4"></span>Daily puzzle
								</p>
								<p class="mt-1 text-3xl font-extrabold leading-tight truncate">
									{dailyDone ? daily.song.title || 'Daily puzzle' : '???'}
								</p>
								<p class="text-white/80 truncate">
									{#if dailyDone}
										{daily.song.artist}
									{:else if daily.online}
										The same puzzle for everyone today. Your first try counts on today's board, and
										every try for your ranking.
									{:else}
										A song from your library (offline, so it isn't ranked)
									{/if}
								</p>
								<div class="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
									<span class="flex items-center gap-1 px-2 py-1 rounded-full bg-white/15">
										<span class="{modeOf(daily.mode)?.icon} size-3.5"></span>{modeOf(daily.mode)
											?.label}
									</span>
									<span
										class="px-2 py-1 rounded-full text-black"
										style="background-color: {DIFFICULTIES[daily.difficulty].color}"
										>{DIFFICULTIES[daily.difficulty].label}</span
									>
									{#if streak}
										<span
											class="flex items-center gap-1 px-2 py-1 rounded-full bg-orange-400/20 text-orange-200"
										>
											<span class="icon-[mingcute--fire-line] size-3.5"></span>{streak}
											{streak === 1 ? 'day' : 'days'}
										</span>
									{/if}
									{#if daily.online}
										<span class="flex items-center gap-1 px-2 py-1 rounded-full bg-white/15">
											<span class="icon-[mingcute--group-line] size-3.5"></span>{daily.players} solved
										</span>
									{/if}
									<span
										class="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-white/70"
									>
										<span class="icon-[mingcute--time-line] size-3.5"></span>Next in {untilNext}
									</span>
								</div>
							</div>
							<div class="shrink-0 flex items-center gap-4">
								{#if dailyDone}
									<div class="text-right">
										<p class="text-4xl font-black tabular-nums">
											{dailyDone.score.toLocaleString()}
										</p>
										<p class="text-sm font-bold">
											<span class="text-white/70">{formatTime(dailyDone.time, true)}</span>
											{#if dailyDone.rank}
												<span class="text-primary-400">· #{dailyDone.rank} of {daily.players}</span>
											{/if}
										</p>
									</div>
								{/if}
								<button
									class="flex items-center gap-2 px-5 h-11 rounded-full bg-primary-300 hover:bg-primary-400 font-semibold cursor-pointer transition shadow-lg shadow-black/40 disabled:opacity-50"
									disabled={view === 'loading'}
									onclick={playDaily}
								>
									<span class="icon-[mingcute--play-fill] size-5"></span>
									{dailyDone ? 'Practice' : 'Play'}
								</button>
							</div>
						</div>
					</section>
				{/if}

				<!-- A puzzle of your own -->
				<section class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
					<div class="flex flex-col gap-3 min-w-0">
						<h2 class="text-xl font-bold">The song</h2>
						{#if chosen}
							<div class="relative h-36 rounded-xl overflow-hidden">
								<BeatmapBackground
									setId={chosen.id}
									mapId={chosen.beatmaps?.[0]?.id}
									title={chosen.title}
									class="absolute inset-0"
								/>
								<div class="absolute inset-0 bg-gradient-to-t from-black/85 to-black/10"></div>
								<div class="absolute bottom-0 inset-x-0 p-4 min-w-0">
									<p class="text-lg font-extrabold truncate">{chosen.title}</p>
									<p class="text-sm text-white/75 truncate">
										{chosen.artist}{chosen.songSource ? ` · ${chosen.songSource}` : ''}
									</p>
								</div>
							</div>
						{:else}
							<p class="text-secondary-600">
								Download a few songs first: the puzzles are made from their backgrounds.
							</p>
						{/if}
						<div class="flex flex-wrap gap-2">
							<button
								class="flex items-center gap-2 px-4 h-9 rounded-full bg-secondary-200 hover:bg-secondary-300 text-sm font-semibold cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
								disabled={!$currentSong.song}
								onclick={() => (chosen = $currentSong.song)}
							>
								<span class="icon-[mingcute--music-2-line] size-4"></span>Now playing
							</button>
							<button
								class="flex items-center gap-2 px-4 h-9 rounded-full bg-secondary-200 hover:bg-secondary-300 text-sm font-semibold cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
								disabled={!library.length}
								onclick={() => (chosen = randomSong(chosen))}
							>
								<span class="icon-[mingcute--shuffle-2-line] size-4"></span>Random anime song
							</button>
						</div>
						<div class="relative">
							<span
								class="absolute left-3 top-1/2 -translate-y-1/2 icon-[mingcute--search-line] size-4 text-secondary-600"
							></span>
							<input
								bind:value={query}
								placeholder="Search your songs: title, artist, anime…"
								class="w-full h-10 pl-9 pr-3 rounded-lg bg-secondary-200 ring-1 ring-white/5 focus:ring-primary-400 outline-none text-sm"
							/>
						</div>
						{#if matches.length}
							<div
								class="max-h-64 overflow-y-auto rounded-lg bg-secondary-100/60 ring-1 ring-white/5"
							>
								{#each matches as song (`${song.id}:${song.track ?? 0}`)}
									<button
										class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-secondary-300 transition {sameSong(
											song,
											chosen
										)
											? 'bg-secondary-300'
											: ''}"
										onclick={() => {
											chosen = song;
											query = '';
										}}
									>
										<SongCover
											setId={song.id}
											track={song.track}
											title={song.title}
											class="size-9 rounded shrink-0"
											lazy
										/>
										<span class="min-w-0">
											<span class="block text-sm font-semibold truncate">{song.title}</span>
											<span class="block text-xs text-secondary-600 truncate"
												>{song.artist}{song.songSource ? ` · ${song.songSource}` : ''}</span
											>
										</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<div class="flex flex-col gap-5 min-w-0">
						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-bold">Mode</h2>
							<div class="grid grid-cols-3 gap-2">
								{#each MODES as mode (mode.id)}
									<button
										class="flex flex-col items-start gap-1 p-3 rounded-xl text-left cursor-pointer ring-1 transition {choice.mode ===
										mode.id
											? 'bg-primary-300/20 ring-primary-400'
											: 'bg-secondary-200 ring-white/5 hover:bg-secondary-300'}"
										onclick={() => (choice.mode = mode.id)}
									>
										<span class="{mode.icon} size-6"></span>
										<span class="font-bold">{mode.label}</span>
										<span class="text-xs text-secondary-600 leading-snug">{mode.hint}</span>
									</button>
								{/each}
							</div>
						</div>

						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-bold">Difficulty</h2>
							<div class="flex flex-wrap gap-2">
								{#each DIFFICULTIES as difficulty, index (difficulty.label)}
									<button
										class="px-4 h-9 rounded-full text-sm font-bold cursor-pointer transition ring-2 {choice.difficulty ===
										index
											? 'text-black'
											: 'bg-secondary-200 hover:bg-secondary-300 ring-transparent'}"
										style={choice.difficulty === index
											? `background-color: ${difficulty.color}; --tw-ring-color: ${difficulty.color}`
											: `color: ${difficulty.color}`}
										onclick={() => (choice.difficulty = index)}
									>
										{difficulty.label}
										<span class="opacity-70 font-semibold">· {pieceCount(index, choice.mode)}</span>
									</button>
								{/each}
							</div>
						</div>

						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-bold">Mods</h2>
							<div class="flex flex-wrap gap-2">
								{#each MODS as mod (mod.id)}
									{@const on = choice.mods.includes(mod.id)}
									{@const usable = !mod.modes || mod.modes.includes(choice.mode)}
									<button
										title={mod.hint}
										class="flex items-center gap-2 px-3 h-9 rounded-full text-sm font-semibold cursor-pointer transition disabled:opacity-35 disabled:pointer-events-none {on
											? 'bg-white text-black'
											: 'bg-secondary-200 hover:bg-secondary-300'}"
										disabled={!usable}
										onclick={() => toggleMod(mod.id)}
									>
										<span class="font-extrabold">{mod.id}</span>
										<span class="opacity-70">{mod.label}</span>
										<span class="font-bold {on ? 'text-primary-200' : 'text-primary-400'}"
											>×{mod.multiplier}</span
										>
									</button>
								{/each}
							</div>
							<label class="mt-1 flex items-center gap-3 text-sm cursor-pointer w-fit">
								<input
									type="checkbox"
									bind:checked={choice.muffle}
									class="accent-primary-400 size-4"
								/>
								<span>
									<span class="font-semibold">Muffled music</span>
									<span class="text-secondary-600">· opens up as the picture comes together</span>
								</span>
							</label>
						</div>

						<button
							class="self-start flex items-center gap-2 px-6 h-12 rounded-full bg-primary-300 hover:bg-primary-400 font-bold cursor-pointer transition shadow-lg shadow-black/30 disabled:opacity-50 disabled:pointer-events-none"
							disabled={!chosen || view === 'loading'}
							onclick={() => start(chosen)}
						>
							{#if view === 'loading'}
								<span class="icon-[line-md--loading-loop] size-5"></span>Cutting it up…
							{:else}
								<span class="icon-[ri--puzzle-2-line] size-5"></span>Start the puzzle
							{/if}
						</button>
					</div>
				</section>
			{/if}

			{#if choice.style !== 'relaxed'}
				<!-- Leaderboards -->
				<section class="flex flex-col gap-3">
					<h2 class="text-xl font-bold">Leaderboards</h2>
					<div class="grid gap-4 items-start lg:grid-cols-2">
						<!-- The ranking of a mode -->
						{#snippet rankingHeader()}
							<div class="flex gap-1 p-1 rounded-full bg-secondary-200 w-fit" role="tablist">
								{#each MODES as mode (mode.id)}
									<button
										role="tab"
										aria-selected={rankMode === mode.id}
										class="flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-semibold cursor-pointer transition {rankMode ===
										mode.id
											? 'bg-white text-black'
											: 'text-secondary-700 hover:text-white hover:bg-white/10'}"
										onclick={() => (rankMode = mode.id)}
									>
										<span class="{mode.icon} size-3.5"></span>{mode.label}
									</button>
								{/each}
							</div>
						{/snippet}
						{@render boardCard(
							'Ranking',
							'icon-[mingcute--trophy-line]',
							`Everyone's best scores of every ${modeOf(rankMode)?.label.toLowerCase()} puzzle, added up`,
							rankBoard,
							rankingHeader
						)}

						<div class="flex flex-col gap-4 min-w-0">
							<!-- Today's puzzle -->
							{@render boardCard(
								"Today's puzzle",
								'icon-[mingcute--calendar-day-line]',
								"Only everyone's first try counts",
								dayBoard,
								null
							)}
							<!-- The chosen song's puzzle -->
							{#snippet puzzleHeader()}
								{#if chosen}
									<p class="flex items-center gap-1.5 text-sm min-w-0">
										<span class="truncate font-semibold">{chosen.title}</span>
										<span class="{modeOf(choice.mode)?.icon} size-3.5 shrink-0"></span>
										<span
											class="shrink-0 font-semibold"
											style="color: {DIFFICULTIES[choice.difficulty].color}"
											>{DIFFICULTIES[choice.difficulty].label}</span
										>
									</p>
								{/if}
							{/snippet}
							{@render boardCard(
								'This puzzle',
								'icon-[ri--puzzle-2-line]',
								'The song, mode and difficulty you picked above',
								songBoard,
								puzzleHeader
							)}
						</div>
					</div>
				</section>
			{/if}

			<!-- Solved puzzles -->
			{#if choice.style === 'relaxed'}
				<section class="flex flex-col gap-3">
					<h2 class="text-xl font-bold">
						Your puzzles <span class="text-secondary-600 font-semibold text-base"
							>· {relaxedDone.length} done</span
						>
					</h2>
					{#if relaxedDone.length}
						<div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
							{#each relaxedDone as record (record.at)}
								<div class="relative group">
									<button
										class="block w-full relative aspect-video rounded-lg overflow-hidden text-left cursor-pointer ring-1 ring-white/10 hover:ring-primary-400 transition"
										title="Puzzle it again"
										onclick={() =>
											openRelaxed({
												picture: record.picture,
												mode: record.mode ?? 'jigsaw',
												pieces: record.pieces,
												ghost: false,
												outlines: true
											})}
										disabled={!record.picture.image && record.picture.setId == null}
									>
										{#if record.picture.image}
											<img
												src={record.picture.image}
												alt=""
												class="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
											/>
										{:else}
											<BeatmapBackground
												setId={record.picture.setId}
												mapId={record.picture.mapId}
												title={record.picture.title}
												class="absolute inset-0 transition-transform duration-300 group-hover:scale-105"
											/>
										{/if}
										<div
											class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
										></div>
										<span
											class="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-xs font-bold"
										>
											<span class="icon-[ri--puzzle-2-line] size-3.5"></span>{record.pieces}
										</span>
										<div class="absolute bottom-0 inset-x-0 p-2.5 min-w-0">
											<p class="text-sm font-bold truncate">{record.picture.title}</p>
											<p class="text-xs text-white/70">
												{formatTime(record.time)} · {new Date(record.at).toLocaleDateString()}
											</p>
										</div>
									</button>
									{@render view3dButton(() =>
										view3d(
											record,
											(record.mode ?? 'jigsaw') === 'jigsaw' ? 'jigsaw' : 'tiles',
											record.picture,
											record.pieces
										)
									)}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-secondary-600">Every puzzle you finish hangs here.</p>
					{/if}
				</section>
			{:else}
				<section class="flex flex-col gap-3">
					<h2 class="text-xl font-bold">
						Your gallery <span class="text-secondary-600 font-semibold text-base"
							>· {gallery.length} {gallery.length === 1 ? 'picture' : 'pictures'}</span
						>
					</h2>
					{#if gallery.length}
						<div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
							{#each gallery as record (record.setId)}
								<div class="relative group">
									<button
										class="block w-full relative aspect-video rounded-lg overflow-hidden text-left cursor-pointer ring-1 ring-white/10 hover:ring-primary-400 transition"
										title="Puzzle it again"
										onclick={() => {
											const song = librarySong({ id: record.setId, beatmaps: [] });
											if (!song) {
												showToast(
													`"${record.title}" isn’t downloaded anymore`,
													'icon-[mingcute--download-2-line]'
												);
												return;
											}
											chosen = song;
											choice.mode = record.mode;
											choice.difficulty = record.difficulty;
											document
												.querySelector('[data-scroll-container]')
												?.scrollTo({ top: 0, behavior: 'smooth' });
										}}
									>
										<BeatmapBackground
											setId={record.setId}
											mapId={record.mapId}
											title={record.title}
											class="absolute inset-0 transition-transform duration-300 group-hover:scale-105"
										/>
										<div
											class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
										></div>
										<div class="absolute bottom-0 inset-x-0 p-2.5 min-w-0">
											<p class="text-sm font-bold truncate">{record.title}</p>
											<p class="flex items-center gap-1.5 text-xs text-white/70">
												<span class="{modeOf(record.mode)?.icon} size-3.5"></span>
												<span style="color: {DIFFICULTIES[record.difficulty].color}"
													>{DIFFICULTIES[record.difficulty].label}</span
												>
												· {record.score != null
													? `${record.score.toLocaleString()} pts`
													: formatTime(record.time, true)}
											</p>
										</div>
									</button>
									{@render view3dButton(() =>
										view3d(
											record,
											record.mode === 'jigsaw' ? 'jigsaw' : 'tiles',
											{ setId: record.setId, mapId: record.mapId, title: record.title },
											DIFFICULTIES[record.difficulty].pieces[record.mode]
										)
									)}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-secondary-600">
							Every picture you put back together hangs here, with your best score.
						</p>
					{/if}
				</section>
			{/if}
		</div>
	</div>
{:else if view === 'play' && game && Puzzle}
	<div class="relative h-full flex flex-col overflow-hidden">
		<!-- The picture behind it all, dark and blurred -->
		<PuzzleTable url={game.url} />

		<!-- What's going on: the song, the clock and how far along -->
		<div class="relative z-[100040] flex items-center gap-4 px-5 py-3 bg-black/30 backdrop-blur">
			{#if !game.mods.includes('HD')}
				<img
					src={game.url}
					alt="What it should look like"
					class="h-14 aspect-video object-cover rounded ring-1 ring-white/15 shadow"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="font-bold truncate">
					{game.daily && !solvedAt ? 'Daily puzzle' : game.song.title}
				</p>
				<p class="text-xs text-white/60 flex items-center gap-1.5">
					<span class="{modeOf(game.mode)?.icon} size-3.5"></span>
					<span style="color: {DIFFICULTIES[game.difficulty].color}"
						>{DIFFICULTIES[game.difficulty].label}</span
					>
					{#each game.mods as mod (mod)}<span class="font-extrabold text-white/80">{mod}</span
						>{/each}
					· {moves} moves{#if peeks}
						· {peeks} {peeks === 1 ? 'peek' : 'peeks'} (+{(peeks * PEEK_PENALTY) / 1000}s){/if}
				</p>
			</div>
			{#if game.daily && !game.dailyOnline}
				<span
					class="px-3 h-8 grid place-items-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30 text-xs font-semibold text-amber-100"
					>Offline: not ranked</span
				>
			{/if}
			<div class="text-right" title="The points if it were solved now: the faster, the more">
				<p class="text-3xl font-extrabold tabular-nums leading-none">
					{liveScore.toLocaleString()}
				</p>
				<p class="text-sm tabular-nums text-white/70">
					{#if multiplier !== 1}<span class="text-primary-400 font-semibold"
							>×{multiplier.toFixed(2)}</span
						> ·
					{/if}{Math.round(progress * 100)}% done
				</p>
			</div>
			<div class="text-right">
				<p class="text-3xl font-extrabold tabular-nums leading-none">
					{formatTime(elapsed, true)}
				</p>
				<p class="text-sm text-white/70">time</p>
			</div>
			<div class="flex items-center gap-1">
				<PuzzleOptions onvolume={(next) => (volume = next)} />
				<button
					title={game.mods.includes('HD')
						? 'No peeking with Hidden'
						: `Hold to see the whole picture (Q); costs ${PEEK_PENALTY / 1000} seconds`}
					aria-label="Peek"
					class="size-9 grid place-items-center rounded-full hover:bg-white/15 cursor-pointer transition disabled:opacity-30 disabled:pointer-events-none"
					disabled={game.mods.includes('HD')}
					onpointerdown={startPeek}
					onpointerup={() => (peeking = false)}
					onpointerleave={() => (peeking = false)}
				>
					<span class="icon-[mingcute--eye-line] size-5"></span>
				</button>
				<button
					title="Start over"
					aria-label="Start over"
					class="size-9 grid place-items-center rounded-full hover:bg-white/15 cursor-pointer transition"
					onclick={retry}
				>
					<span class="icon-[mingcute--refresh-2-line] size-5"></span>
				</button>
				<button
					title="Leave (Esc)"
					aria-label="Leave the puzzle"
					class="size-9 grid place-items-center rounded-full hover:bg-white/15 cursor-pointer transition"
					onclick={toMenu}
				>
					<span class="icon-[mingcute--close-line] size-5"></span>
				</button>
			</div>
		</div>
		<!-- How much is done -->
		<div class="relative z-10 h-1 bg-white/10">
			<div
				class="h-full bg-primary-400 transition-[width] duration-300 shadow-[0_0_8px] shadow-primary-400"
				style="width: {progress * 100}%"
			></div>
		</div>

		<div
			class="relative flex-1 min-h-0"
			role="application"
			onpointermove={(event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			}}
		>
			{#key game.key}
				<Puzzle
					bind:this={puzzle}
					url={game.url}
					aspect={game.aspect}
					cols={game.cols}
					rows={game.rows}
					seed={game.seed}
					mods={game.mods}
					{peeking}
					onaction={act}
					onprogress={(fraction) => (progress = fraction)}
					onsolved={solved}
				/>
			{/key}

			<!-- Flashlight: only around the cursor -->
			{#if flashlight}
				<div
					class="absolute inset-0 z-[100003] pointer-events-none"
					style="background: radial-gradient(circle {flashlight}px at {pointer.x}px {pointer.y}px, transparent 55%, rgba(0,0,0,0.97) 100%)"
				></div>
			{/if}

			{#if solvedAt}
				<div
					class="absolute inset-0 z-[100002] grid place-items-center pointer-events-none"
					in:fade={{ duration: 200 }}
				>
					<p
						class="text-7xl font-black italic tracking-tight drop-shadow-[0_4px_30px_rgba(0,0,0,0.8)]"
						in:scale={{ start: 0.4, duration: 600, delay: 1100, easing: backOut }}
					>
						Solved!
					</p>
				</div>
			{/if}
		</div>
	</div>
{:else if view === 'relaxed' && relaxedGame}
	<RelaxedPuzzle game={relaxedGame} onleave={toMenu} onnew={toMenu} />
{:else if view === 'results' && result}
	<div class="h-full" in:fly={{ y: 20, duration: 300 }}>
		<PuzzleResults
			{result}
			{ranking}
			onretry={retry}
			onnext={next}
			onmenu={toMenu}
			on3d={() => view3d(result.record, result.record.mode === 'jigsaw' ? 'jigsaw' : 'tiles')}
		/>
	</div>
{/if}

{#snippet boardCard(title, icon, hint, shown, header)}
	<div class="flex flex-col gap-2 rounded-xl bg-secondary-100/60 ring-1 ring-white/5 p-3 min-w-0">
		<div class="px-3 pt-1">
			<p class="flex items-center gap-2 font-bold">
				<span class="{icon} size-5 text-amber-300"></span>{title}
			</p>
			<p class="text-xs text-secondary-600">{hint}</p>
		</div>
		{#if header}
			<div class="px-3">{@render header()}</div>
		{/if}
		<PuzzleLeaderboard board={shown.board} error={shown.error} />
	</div>
{/snippet}

{#snippet view3dButton(open)}
	<button
		class="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 h-7 rounded-full bg-black/60 hover:bg-primary-300 text-xs font-bold cursor-pointer transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
		title="Look at it in 3D"
		onclick={open}
	>
		<span class="icon-[mingcute--cube-3d-line] size-3.5"></span>3D
	</button>
{/snippet}

<Bursts bind:this={bursts} />
{#if shown3d}
	<Puzzle3D puzzle={shown3d} onclose={() => (shown3d = null)} />
{/if}
