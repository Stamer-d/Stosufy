<script>
	// The gameplay of the song that plays, with the hitsound skin: autoplay, a replay of a
	// top score, or the user playing it (mouse or tablet to aim, two keys or the mouse
	// buttons to click, Esc to stop)
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { currentSong, songQueue, setPlaybackLock } from '#lib/stores/audio.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { keybindsPaused } from '#lib/stores/keybinds.ts';
	import { beatmapContent, playSoundNow } from '#lib/hitsounds/player.ts';
	import { skinFolder, skinsChanged, completeDefaultSkin, BUILTIN } from '#lib/hitsounds/skins.ts';
	import { parseGameplay } from '#lib/gameplay/beatmap.ts';
	import { loadGameplaySkin, forgetGameplaySkins, withFallback } from '#lib/gameplay/skin.ts';
	import { createGameplayRenderer } from '#lib/gameplay/render.ts';
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
		modNames
	} from '#lib/gameplay/play.ts';

	let { class: className = '' } = $props();

	let canvas = $state();
	let renderer = null;
	let view = null;
	let message = $state('');

	let song = $derived($currentSong.song);
	let mapId = $derived(song && ($userSettings.settings?.gameplayDifficulty, chosenMapId(song)));
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

	$effect(() => {
		const current = song;
		const target = canvas;
		const skin = skinSetting;
		const shown = mode;
		const playing = key;
		const difficulty = mapId;
		void $skinsChanged;
		if (view && get(activePlay)?.judge === view.judge) activePlay.set(null);
		renderer = null;
		view = null;
		message = '';
		// Nothing of the last song stays (also when this one has no gameplay)
		target?.getContext('2d')?.clearRect(0, 0, target.width, target.height);
		if (!current || !target) return;
		// Only the song, difficulty, skin and mode rebuild the play (not every queue update)
		const preview = untrack(
			() => $songQueue.type === 'preview' && !current.queued && !$mapDataStore[current.id]
		);
		if (preview) {
			message = 'Gameplay shows for downloaded songs';
			return;
		}
		let cancelled = false;
		completeDefaultSkin();
		(async () => {
			const content = await beatmapContent(current, difficulty).catch(() => null);
			if (cancelled) return;
			// Let the song start first: the work below can take a moment on long maps
			await new Promise((resolve) => setTimeout(resolve, 0));
			if (cancelled) return;
			const auto = shown.kind === 'auto' && content ? autoplayFor(content) : null;
			const mods = shown.kind === 'replay' ? shown.replay.mods : 0;
			const beatmap = auto ? auto.beatmap : content ? parseGameplay(content, mods) : null;
			if (!beatmap) {
				message = content ? 'Gameplay is only for osu!standard maps' : "Couldn't load the beatmap";
				return;
			}
			const dir = skin === BUILTIN ? null : await skinFolder(skin);
			const fallbackDir = skin === BUILTIN ? null : await skinFolder(null);
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
				judge = createJudge(beatmap, 0);
				judge.onSound = (sound) => playSoundNow(sound, judge);
				label = `Playing · ${keyNames()} to click · Esc to stop`;
			} else {
				judge = auto.judge;
				label = 'Autoplay';
			}
			renderer = createGameplayRenderer(target, beatmap, withFallback(own, fallback));
			view = {
				judge,
				label,
				results: shown.kind !== 'auto',
				finished: false,
				// Autoplay's cursor between its inputs
				cursor: shown.kind === 'auto' ? (time) => autoplayCursor(beatmap.objects, time) : null
			};
			activePlay.set({ key: playing, judge, kind: shown.kind });
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
		const raw = audio.currentTime * 1000;
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
			if (!renderer || !view || !audio) return;
			try {
				const time = songTime();
				if (live) {
					// Jumped (seeked): start over from here
					if (time < lastTime - 300 || time > lastTime + 1500) view.judge.reset(time);
					if (!view.judge.frames.length) feed();
					if (!audio.paused) view.judge.update(time);
				}
				lastTime = time;
				view.finished = audio.ended;
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
	{#if message}
		<p class="absolute bottom-16 left-1/2 -translate-x-1/2 text-sm text-white/70 drop-shadow">
			{message}
		</p>
	{/if}
</div>
