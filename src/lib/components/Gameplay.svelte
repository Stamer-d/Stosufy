<script module>
	// The last play made, kept when the view goes away (see the cache below)
	let lastPlay = null;
</script>

<script>
	// The gameplay of the song that plays, with the hitsound skin: autoplay, a replay of a
	// top score, or the user playing it (mouse or tablet to aim, two keys or the mouse
	// buttons to click, Esc to stop)
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { currentSong, songQueue, setPlaybackLock } from '#lib/stores/audio.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { heardTime } from '#lib/stores/equalizer.ts';
	import { isPreviewing, isStreamed } from '#lib/stores/stream.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { beatmapContent, playSoundNow } from '#lib/hitsounds/player.ts';
	import { skinFolder, skinsChanged, completeDefaultSkin, BUILTIN } from '#lib/hitsounds/skins.ts';
	import { parseGameplay, MOD } from '#lib/gameplay/beatmap.ts';
	import {
		loadGameplaySkin,
		forgetGameplaySkins,
		withFallback,
		STOSUFY_SKIN
	} from '#lib/gameplay/skin.ts';
	import { createGameplayRenderer, lastCursorPosition } from '#lib/gameplay/render.ts';
	import {
		autoplayFor,
		autoplayCursor,
		judgeFrames,
		createJudge,
		KEY
	} from '#lib/gameplay/judge.ts';
	import {
		gameplayMode,
		activePlay,
		chosenMapId,
		playKey,
		setGameplayMode,
		modNames,
		standardPicks,
		difficultyChosen
	} from '#lib/gameplay/play.ts';

	/**
	 * `hideLabel`: without "Autoplay" (or whose replay it is) at the top left, where the
	 * desktop's widgets are (the gameplay button says it there)
	 * @type {{ class?: string, hideLabel?: boolean }}
	 */
	let { class: className = '', hideLabel = false } = $props();

	let canvas = $state();
	let renderer = null;
	/** The last play's renderer, for the cursor while the next one is made */
	let idle = null;
	let view = null;
	let message = $state('');

	let song = $derived($currentSong.song);
	let mapId = $derived(
		song && ($userSettings.settings?.gameplayDifficulty, $standardPicks, chosenMapId(song))
	);
	let key = $derived(song ? `${song.id}:${mapId}` : null);
	let skinSetting = $derived($userSettings.settings?.hitsoundSkin ?? null);
	/** @type {import('#lib/gameplay/play.ts').GameplayMode} */
	const AUTO = { kind: 'auto' };
	let mode = $derived($gameplayMode.key === key ? $gameplayMode.mode : AUTO);
	let live = $derived(mode.kind === 'live');

	$effect(() => {
		$skinsChanged;
		forgetGameplaySkins();
	});

	/** The hardest difficulty of a song that is osu!standard (from its .osu files) */
	async function hardestStandard(current, skip) {
		const maps = [...(current.beatmaps ?? [])]
			.filter((map) => String(map.id) !== String(skip))
			.sort((a, b) => (Number(b.difficulty_rating) || 0) - (Number(a.difficulty_rating) || 0));
		for (const map of maps) {
			const content = await beatmapContent(current, String(map.id)).catch(() => null);
			if (content && /^Mode\s*:\s*0\s*$/m.test(content)) return String(map.id);
			if (content && !/^Mode\s*:/m.test(content)) return String(map.id);
		}
		return null;
	}

	/** Starts drawing a play (made for this view now, or the last one shown) */
	function show(target, play, playing, shown) {
		const { beatmap, judge, label, restAt } = play;
		renderer = createGameplayRenderer(target, beatmap, play.skin);
		idle = null;
		view = {
			judge,
			label,
			results: shown.kind !== 'auto',
			finished: false,
			// Autoplay's cursor between its inputs; it goes on from where the last song's
			// cursor was. Playing yourself, it's where the mouse is until the first input.
			cursor:
				shown.kind === 'auto'
					? (time) => autoplayCursor(beatmap.objects, time, restAt)
					: shown.kind === 'live'
						? () => (view?.judge.frames.length ? null : pointer)
						: null
		};
		activePlay.set({ key: playing, judge, kind: shown.kind });
	}

	$effect(() => {
		const current = song;
		const target = canvas;
		const skin = skinSetting;
		const shown = mode;
		const playing = key;
		const difficulty = mapId;
		void $skinsChanged;
		if (view && get(activePlay)?.judge === view.judge) activePlay.set(null);
		// Until the next play is made, the last one's renderer keeps showing the cursor
		if (renderer) idle = renderer;
		renderer = null;
		view = null;
		message = '';
		// Nothing of the last song stays (also when this one has no gameplay)
		target?.getContext('2d')?.clearRect(0, 0, target.width, target.height);
		if (!current || !target) return;
		// Only the song, difficulty, skin and mode rebuild the play (not every queue update)
		const preview = untrack(
			() =>
				($songQueue.type === 'preview' &&
					!current.queued &&
					!$mapDataStore[current.id] &&
					!isStreamed(current)) ||
				isPreviewing(current)
		);
		if (preview) {
			message = 'Gameplay shows for downloaded songs';
			return;
		}
		let cancelled = false;
		completeDefaultSkin();
		// The same play as the last time this was shown (back on the home screen, out of the
		// focus mode): shown right away, without loading it again
		const cacheKey = `${playing}|${skin}|${shown.kind}|${$skinsChanged}`;
		const cached =
			shown.kind !== 'live' &&
			lastPlay &&
			lastPlay.key === cacheKey &&
			(shown.kind === 'auto' || lastPlay.mode === shown)
				? lastPlay
				: null;
		if (cached) {
			show(target, cached, playing, shown);
			return () => {
				if (view && get(activePlay)?.judge === view.judge) activePlay.set(null);
			};
		}
		(async () => {
			const content = await beatmapContent(current, difficulty).catch(() => null);
			if (cancelled) return;
			// Let the song start first: the work below can take a moment on long maps
			await new Promise((resolve) => setTimeout(resolve, 0));
			if (cancelled) return;
			const auto = shown.kind === 'auto' && content ? autoplayFor(content) : null;
			const mods =
				shown.kind === 'replay' ? shown.replay.mods : shown.kind === 'live' ? shown.mods : 0;
			const beatmap = auto ? auto.beatmap : content ? parseGameplay(content, mods) : null;
			if (!beatmap) {
				// The hardest difficulty isn't osu!standard (taiko, mania…): the hardest that is
				if (content && !difficultyChosen(current) && !$standardPicks[String(current.id)]) {
					const found = await hardestStandard(current, difficulty);
					if (cancelled) return;
					if (found) {
						standardPicks.update((picks) => ({ ...picks, [String(current.id)]: found }));
						return;
					}
				}
				message = content ? 'Gameplay is only for osu!standard maps' : "Couldn't load the beatmap";
				return;
			}
			// No skin chosen: Stosufy's own, which has all it needs (the osu! default skin fills
			// in what a chosen skin lacks)
			const dir = skin === BUILTIN ? null : skin ? await skinFolder(skin) : STOSUFY_SKIN;
			const fallbackDir = skin === BUILTIN || !skin ? null : await skinFolder(null);
			const [own, fallback] = await Promise.all([
				loadGameplaySkin(dir),
				loadGameplaySkin(fallbackDir)
			]);
			if (cancelled) return;
			let judge;
			let label;
			if (shown.kind === 'replay') {
				judge = judgeFrames(beatmap, shown.replay.frames, shown.replay.mods);
				const names = modNames(shown.replay.mods);
				label = `${shown.replay.player}${names.length ? ' +' + names.join('') : ''} · #${shown.score.position}`;
			} else if (shown.kind === 'live') {
				judge = createJudge(beatmap, mods);
				judge.onSound = (sound) => playSoundNow(sound, judge);
				const names = modNames(mods);
				const relax = !!(mods & MOD.Relax);
				label = `Playing${names.length ? ' +' + names.join('') : ''} · ${relax ? 'just aim' : keyNames() + ' to click'} · Esc to stop`;
			} else {
				judge = auto.judge;
				label = 'Autoplay';
			}
			const play = {
				key: cacheKey,
				mode: shown,
				beatmap,
				judge,
				label,
				skin: withFallback(own, fallback),
				restAt: lastCursorPosition() ?? undefined
			};
			if (shown.kind !== 'live') lastPlay = play;
			show(target, play, playing, shown);
		})();
		return () => {
			cancelled = true;
			// Only its own: the other view may already show the play
			if (view && get(activePlay)?.judge === view.judge) activePlay.set(null);
		};
	});

	// --- The song's time, smooth between the audio element's updates ----------------------

	let lastRaw = -1;
	let lastPerf = 0;
	let lastTime = 0;
	function songTime() {
		const audio = $songQueue.audio;
		if (!audio) return 0;
		// As it's heard (with the equalizer's delay): the circles match what you hear
		const raw = heardTime(audio);
		const now = performance.now();
		if (audio.paused || raw !== lastRaw) {
			lastRaw = raw;
			lastPerf = now;
			return raw;
		}
		return raw + Math.min(100, (now - lastPerf) * (audio.playbackRate || 1));
	}

	// --- Playing ------------------------------------------------------------------------------

	const keys = () => $userSettings.settings?.gameplayKeys ?? ['KeyZ', 'KeyX'];
	const keyNames = () =>
		keys()
			.map((code) => code.replace(/^Key|^Digit/, ''))
			.join('/');

	let held = 0;
	let pointer = { x: 256, y: 192 };

	function feed() {
		if (!live || !view || !renderer) return;
		const audio = $songQueue.audio;
		if (!audio || audio.paused) return;
		const time = songTime();
		view.judge.input({ time, x: pointer.x, y: pointer.y, keys: held });
	}

	function onPointer(event) {
		if (!live || !renderer || !canvas) return;
		const rect = canvas.getBoundingClientRect();
		pointer = renderer.toPlayfield(event.clientX - rect.left, event.clientY - rect.top);
		if (event.type !== 'pointermove') {
			let mouse = 0;
			if (event.buttons & 1) mouse |= KEY.M1;
			if (event.buttons & 2) mouse |= KEY.M2;
			held = (held & (KEY.K1 | KEY.K2)) | mouse;
			// Keys hold M1/M2 too, like in osu!
			if (held & KEY.K1) held |= KEY.M1;
			if (held & KEY.K2) held |= KEY.M2;
			event.preventDefault();
		}
		feed();
	}

	function onKey(event) {
		if (!live) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			stop();
			return;
		}
		if (event.code === 'Space' && event.type === 'keydown') {
			event.preventDefault();
			skip();
			return;
		}
		const [first, second] = keys();
		const bit =
			event.code === first ? KEY.K1 | KEY.M1 : event.code === second ? KEY.K2 | KEY.M2 : 0;
		if (!bit) return;
		event.preventDefault();
		if (event.repeat) return;
		if (event.type === 'keydown') held |= bit;
		else held &= ~bit;
		feed();
	}

	function stop() {
		setGameplayMode(song, { kind: 'auto' });
	}

	// --- Skipping the intro, breaks and the end, like osu!'s skip button -------------------

	/** Where a skip now jumps to (ms), or null when there's nothing to skip */
	let skipTo = $state(null);
	const SKIP_LEAD = 2000;

	function skipTarget(time) {
		const objects = view?.judge.beatmap.objects;
		const audio = $songQueue.audio;
		if (!objects?.length || !audio) return null;
		const preempt = view.judge.beatmap.preempt;
		// The next object and where the gap before it starts
		let index = objects.findIndex((o) => o.time > time);
		if (index === -1) {
			// After the last object: on to the results
			const end = Math.max(...objects.map((o) => o.endTime));
			const duration = audio.duration * 1000;
			return time > end + 1000 && duration - time > 4000 ? duration - 50 : null;
		}
		const gapStart = index === 0 ? 0 : objects[index - 1].endTime + 300;
		if (time < gapStart) return null;
		const target = objects[index].time - preempt - 900;
		return target - time > SKIP_LEAD ? target : null;
	}

	function skip() {
		const audio = $songQueue.audio;
		if (skipTo === null || !audio) return;
		// Not a jump to start over from: the judge goes on
		lastTime = skipTo;
		audio.currentTime = skipTo / 1000;
		skipTo = null;
	}

	$effect(() => {
		const playing = live;
		keybindsPaused.set(playing);
		setPlaybackLock(
			'gameplay',
			playing ? () => "You're playing the map: press Esc to stop first." : null
		);
		held = 0;
		return () => {
			keybindsPaused.set(false);
			setPlaybackLock('gameplay', null);
		};
	});

	onMount(() => {
		let frame;
		let reported = false;
		const loop = () => {
			// Whatever happens in a frame, the next one still comes
			frame = requestAnimationFrame(loop);
			const audio = $songQueue.audio;
			if (!renderer || !view || !audio) {
				const at = lastCursorPosition();
				if (idle && at && !message) idle.drawIdle(at);
				return;
			}
			try {
				const time = songTime();
				if (live) {
					// Jumped (seeked): start over from here
					if (time < lastTime - 300 || time > lastTime + 1500) view.judge.reset(time);
					// Relax hits by aiming alone: an input every frame
					if (!view.judge.frames.length || view.judge.mods & MOD.Relax) feed();
					if (!audio.paused) view.judge.update(time);
				}
				lastTime = time;
				if (live) {
					const target = audio.paused ? null : skipTarget(time);
					if (target !== skipTo) skipTo = target;
				} else if (skipTo !== null) skipTo = null;
				view.finished = audio.ended;
				view.hideLabel = hideLabel;
				renderer.draw(time, view);
			} catch (error) {
				if (!reported) console.error('Could not draw the gameplay:', error);
				reported = true;
			}
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});
</script>

<svelte:window
	onkeydown={onKey}
	onkeyup={onKey}
	onpointermove={onPointer}
	onpointerdown={onPointer}
	onpointerup={onPointer}
	oncontextmenu={(e) => live && e.preventDefault()}
/>

<div class="{live ? 'cursor-none' : 'pointer-events-none'} {className}">
	<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
	{#if live && skipTo !== null}
		<button
			class="absolute bottom-24 right-6 z-10 flex items-center gap-2 h-12 px-6 rounded-xl bg-white/90 text-black text-lg font-black tracking-wide shadow-2xl cursor-pointer hover:bg-white transition pointer-events-auto"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={skip}
		>
			Skip
			<span class="icon-[mingcute--arrows-right-line] size-6"></span>
			<kbd class="ml-1 px-1.5 rounded bg-black/10 text-xs font-sans font-semibold">Space</kbd>
		</button>
	{/if}
	{#if message}
		<p class="absolute bottom-16 left-1/2 -translate-x-1/2 text-sm text-white/70 drop-shadow">
			{message}
		</p>
	{/if}
</div>
