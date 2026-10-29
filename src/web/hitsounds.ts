// Hitsounds on the phone, as in the desktop app: the beatmap's hitsounds play with the music,
// like watching osu!'s autoplay, with the sounds that come with Stosufy. And the speed mods:
// Double Time / Nightcore 1.5× (Nightcore higher, with its drum beat), Half Time / Daycore
// 0.75×. The settings are the account's, the same as on the desktop.
//
// The samples are scheduled with Web Audio a moment ahead of where the song is, on a clock of
// their own (evenly spaced) that's set anew when the song is off it by more than a little. In
// the background (screen locked) the phone runs the page's timers seldom: then they're
// scheduled seconds ahead (Web Audio plays them on time by itself), topped up on each of the
// song's time updates. The audio is a player's (iOS plays it on in the background then).

import { get, writable } from 'svelte/store';
import { userSettings, updateUserSettings } from './shims/user';
import { osuFile } from './osuFiles';
import { log } from './log';
import { songOffsetOf } from './songOffset';
import { hitsoundMapId, learnHardest, hardest } from './difficulties';
import { queue, audioElement, reclaimNowPlaying } from './player';
import { songContext, isRouted } from './audioGraph';
import { parseHitsounds, type HitSample } from '../lib/hitsounds/chart';
import { builtinSample, builtinExtra } from '../lib/hitsounds/builtin';
import { bundledSamples, bundledSample } from '../lib/hitsounds/bundled';
import { parseTimingPoints, type TimingPoint } from '../lib/osuFile';
import { MODS, applyMod, currentMod, prepareBeats, startBeats } from '../lib/stores/mods';
import type { MapSet, PlaybackMod } from '../lib/types';

export type { PlaybackMod };
export { hitsoundMapId };
export { MODS };

const DEFAULT_VOLUME = 0.8;
/** How loud the hitsounds are next to the music (the phone plays the music at full volume) */
const LEVEL = 0.6;
const LOOKAHEAD = 0.2;
/** In the background: this far ahead (the timers may come seconds late there) */
const LOOKAHEAD_HIDDEN = 12;
const TICK = 15;
/** How far (ms) the song may be off the hitsounds' clock before they're set anew (in the
 * background the song's time is read more coarsely) */
const FAR_OFF = 150;
const FAR_OFF_HIDDEN = 250;
/** How much of a small difference the hitsounds' clock follows on each reading */
const FOLLOW = 0.2;

export const hitsoundStatus = writable<'off' | 'loading' | 'ready' | 'unavailable'>('off');

function settings() {
	const s = get(userSettings).settings ?? {};
	return {
		on: s.hitsounds ?? false,
		volume: s.hitsoundVolume ?? DEFAULT_VOLUME,
		offset: s.hitsoundOffset ?? 0,
		muted: (['whistle', 'finish', 'clap', 'slidertick', 'spinner'] as const).filter(
			(sound) => s.hitsoundParts?.[sound] === false
		) as string[]
	};
}

// --- Samples ---------------------------------------------------------------------------

let context: AudioContext | null = null;
let master: GainNode | null = null;

/** The songs' audio context (audioGraph.ts): the hitsounds play on the song's clock */
function audioContext() {
	if (!context) {
		context = songContext() ?? new AudioContext({ latencyHint: 'interactive' });
		master = context.createGain();
		master.connect(context.destination);
	}
	return context;
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** A bundled sample by name; null: the skin mutes it (an empty file), undefined: not there */
function bundled(name: string): Promise<AudioBuffer | null> | undefined {
	const url = bundledSamples.get(name);
	if (!url) return undefined;
	if (!buffers.has(url))
		buffers.set(
			url,
			bundledSample(url)
				.then((data) => (data.byteLength < 100 ? null : audioContext().decodeAudioData(data)))
				.catch(() => null)
		);
	return buffers.get(url)!;
}

/** The sound of a sample: Stosufy's "soft-hitclap", else its "hitclap", else a built-in one */
function sampleFor(sample: HitSample) {
	const sound = sample.sound === 'slidertick' ? 'slidertick' : `hit${sample.sound}`;
	return (
		bundled(`${sample.set}-${sound}`) ??
		bundled(sound) ??
		Promise.resolve(builtinSample(audioContext(), sample.set, sample.sound))
	);
}

// --- Spinners: their spin and bonus, as the desktop app plays autoplay's -------------------

/** Autoplay's spin (turns per ms): the most osu! counts, 477 rpm */
const AUTO_TURNS = (477 * 0.999) / 60000;
const SPIN_VOLUME = 0.6;
const BONUS_VOLUME = 0.7;
/** The osu! default spin (Stosufy's sounds have none: the desktop app's comes from here too) */
const SPIN_SOUND =
	'https://raw.githubusercontent.com/ppy/osu-resources/HEAD/osu.Game.Resources/Samples/Gameplay/spinnerspin.wav';

type Spinner = { start: number; end: number; required: number };

/**
 * An osu!standard map's spinners, with the spins they need (by the map's OD, like osu!), and
 * the times of autoplay's bonus spins (each a "ping")
 */
function spinnersOf(content: string) {
	const spinners: Spinner[] = [];
	const bonuses: number[] = [];
	if (Number(/^Mode\s*:\s*(\d+)/m.exec(content)?.[1] ?? 0) !== 0) return { spinners, bonuses };
	const od = Number(/^OverallDifficulty\s*:\s*([\d.]+)/m.exec(content)?.[1] ?? 5);
	const range = (min: number, mid: number, max: number) =>
		od > 5 ? mid + ((max - mid) * (od - 5)) / 5 : od < 5 ? mid - ((mid - min) * (5 - od)) / 5 : mid;
	const objects = content.slice(content.indexOf('[HitObjects]') + 12).split(/\r?\n/);
	for (const line of objects) {
		if (line.startsWith('[')) break;
		const p = line.split(',');
		const start = Number(p[2]);
		if (!(Number(p[3]) & 8) || !isFinite(start)) continue;
		const end = Math.max(start, Number(p[5]) || start);
		const seconds = (end - start) / 1000;
		const required = Math.floor((range(90, 150, 225) / 60) * seconds + 0.0001);
		const most = Math.floor((range(250, 380, 430) / 60) * seconds + 0.0001);
		spinners.push({ start, end, required });
		// (a bonus for each spin from the second past the needed ones)
		for (let spin = required + 2; spin < most; spin++) {
			const at = start + spin / AUTO_TURNS;
			if (at > end) break;
			bonuses.push(Math.round(at));
		}
	}
	return { spinners, bonuses };
}

/** The spin's pitch, rising as it's spun (osu!'s DrawableSpinner) */
const spinPitch = (spinner: Spinner, time: number) =>
	Math.min(
		100000 / 44100,
		(20000 + (((time - spinner.start) * AUTO_TURNS) / (spinner.required || 1)) * 40000) / 44100
	);
/** (it's at the top from two times the needed spins on) */
const spinTop = (spinner: Spinner) => spinner.start + (2 * (spinner.required || 1)) / AUTO_TURNS;

let spinLoad: Promise<AudioBuffer> | null = null;
/** The spin's sound, kept for offline; a simple one of Stosufy's own if it can't be had */
function spinSound() {
	spinLoad ??= (async () => {
		const cache =
			typeof caches === 'undefined' ? null : await caches.open('stosufy-sounds').catch(() => null);
		let response = await cache?.match(SPIN_SOUND);
		if (!response) {
			response = await fetch(SPIN_SOUND, { signal: AbortSignal.timeout(15000) });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			await cache?.put(SPIN_SOUND, response.clone()).catch(() => {});
		}
		return audioContext().decodeAudioData(await response.arrayBuffer());
	})().catch((error) => {
		log(`hitsounds: the spinner's sound couldn't be had (${error?.message ?? error})`);
		// (asked again with the next song)
		spinLoad = null;
		return builtinExtra(audioContext(), 'spinnerspin');
	});
	return spinLoad;
}

// --- The chart of the song playing ----------------------------------------------------------

type ChartEvent = { time: number; volume: number; buffers: (AudioBuffer | null)[] };

let chart: {
	key: string;
	events: ChartEvent[];
	spinners: Spinner[];
	spin: AudioBuffer | null;
} | null = null;
let timing: { key: string; points: TimingPoint[] } | null = null;
let loadingKey: string | null = null;

function currentSong() {
	const { songs, index } = get(queue);
	return songs[index] ?? null;
}
const mapIdOf = () => hitsoundMapId(currentSong());

/** Chooses the difficulty whose hitsounds play for a song's set */
export function chooseHitsoundDifficulty(song: MapSet, mapId: string) {
	const all = { ...get(userSettings).settings?.gameplayDifficulty };
	all[String(song.id)] = mapId;
	updateUserSettings({ gameplayDifficulty: all });
}

const audioFileOf = (content: string) =>
	/^AudioFilename\s*:\s*(.+?)\s*$/m.exec(content)?.[1]?.toLowerCase() ?? '';

/**
 * The chosen (or hardest) difficulty's .osu, if it's of the same audio file as the song's own
 * difficulty, the one playing: a set's difficulties can have audio files of their own (cut,
 * sped up, starting elsewhere), and the hitsounds were off by that, another amount each song.
 * Else the song's own (as the desktop app picks only difficulties of the same audio).
 */
async function chartFile(song: MapSet | null, mapId: string) {
	const own = String(song?.beatmaps?.[0]?.id ?? '');
	const [content, ownContent] = await Promise.all([
		osuFile(mapId),
		own && own !== mapId ? osuFile(own) : Promise.resolve(null)
	]);
	if (!ownContent) return content;
	if (!content) return ownContent;
	if (audioFileOf(content) === audioFileOf(ownContent)) return content;
	log(
		`hitsounds: difficulty ${mapId} has an audio file of its own (${audioFileOf(content)}), the song's own difficulty's instead`
	);
	return ownContent;
}

async function load() {
	const needsChart = settings().on;
	const needsTiming = currentMod() === 'NC';
	// (the set's hardest difficulty, as the desktop app's default, if not known yet)
	if (needsChart || needsTiming) await learnHardest(currentSong());
	const mapId = mapIdOf();
	const s = settings();
	const key = `${mapId}:${s.on}:${s.muted}:${needsTiming}`;
	if (!mapId || (!needsChart && !needsTiming)) {
		chart = null;
		loadingKey = null;
		hitsoundStatus.set('off');
		return;
	}
	if (key === loadingKey) return;
	loadingKey = key;
	if (needsChart) hitsoundStatus.set('loading');
	const content = await chartFile(currentSong(), mapId);
	if (loadingKey !== key) return;
	if (!content) {
		chart = null;
		hitsoundStatus.set(needsChart ? 'unavailable' : 'off');
		return;
	}
	timing = { key: mapId, points: parseTimingPoints(content) };
	if (!needsChart) {
		chart = null;
		hitsoundStatus.set('off');
		return;
	}
	const resolved = new Map<string, Promise<AudioBuffer | null>>();
	const sound = (sample: HitSample) => {
		const id = `${sample.set}:${sample.sound}`;
		if (!resolved.has(id)) resolved.set(id, sampleFor(sample));
		return resolved.get(id)!;
	};
	const events = await Promise.all(
		parseHitsounds(content).map(async (event) => ({
			time: event.time,
			volume: event.volume / 100,
			buffers: await Promise.all(
				event.samples
					.filter((sample) => !s.muted.includes(sample.sound))
					.map((sample) => sound(sample))
			)
		}))
	);
	// The spinners' sounds (unless turned off, like on the desktop)
	const spinning = s.muted.includes('spinner') ? null : spinnersOf(content);
	if (spinning?.bonuses.length) {
		const bonus = await (bundled('spinnerbonus') ??
			Promise.resolve(builtinExtra(audioContext(), 'spinnerbonus')));
		for (const time of spinning.bonuses)
			events.push({ time, volume: BONUS_VOLUME, buffers: [bonus] });
		events.sort((a, b) => a.time - b.time);
	}
	if (loadingKey !== key) return;
	const loaded = {
		key,
		events: events.filter((event) => event.buffers.some(Boolean)),
		spinners: spinning?.spinners ?? [],
		spin: null as AudioBuffer | null
	};
	chart = loaded;
	// (the spin comes once it's there: the hitsounds don't wait for it)
	if (loaded.spinners.length) spinSound().then((buffer) => (loaded.spin = buffer));
	restart = true;
	hitsoundStatus.set('ready');
}

// --- Playing ---------------------------------------------------------------------------

let next = 0;
/** The song's time (ms) at a moment of the hitsounds' clock, and its speed then */
let anchor: { song: number; ctx: number; rate: number } | null = null;
let restart = true;
let scheduled: { source: AudioBufferSourceNode; at: number }[] = [];
/** The next spinner whose spin isn't scheduled yet, and the spins scheduled (until they end) */
let nextSpin = 0;
let spins: { source: AudioBufferSourceNode; spinner: Spinner; end: number }[] = [];
/** The song waits for data: what's scheduled would come early */
let waiting = false;

/** Stops what's scheduled; the spinners' spin too unless `keepSpins` */
function stopScheduled(keepSpins = false) {
	const now = context?.currentTime ?? 0;
	for (const { source, at } of scheduled) if (at > now) source.stop();
	scheduled = [];
	if (keepSpins) return;
	for (const { source } of spins)
		try {
			source.stop();
		} catch {
			// (not started yet: WebKit may say so)
		}
	spins = [];
}

/** The first event at or after a time */
function indexAt(events: ChartEvent[], time: number) {
	let low = 0;
	let high = events.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (events[mid].time < time) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** A sound too quiet to hear while the hitsounds play: keeps the phone from putting the
 * hitsounds' audio to sleep between two of them in the background */
let keepAwake: ConstantSourceNode | null = null;
function awake(on: boolean) {
	if (on && !keepAwake && context && master) {
		keepAwake = context.createConstantSource();
		keepAwake.offset.value = 0.0001;
		keepAwake.connect(context.destination);
		keepAwake.start();
	} else if (!on && keepAwake) {
		keepAwake.stop();
		keepAwake.disconnect();
		keepAwake = null;
	}
}

function tick() {
	const audio = get(audioElement);
	if (!chart || !audio || audio.paused || audio.ended || waiting) {
		if (scheduled.length) stopScheduled();
		awake(false);
		anchor = null;
		return;
	}
	const ctx = audioContext();
	if (ctx.state !== 'running') {
		ctx.resume().catch(() => {});
		anchor = null;
		return;
	}
	awake(true);
	const hidden = document.hidden;
	const { volume, offset } = settings();
	master!.gain.value = volume * LEVEL;
	const rate = audio.playbackRate || 1;
	// (positive offsets play the hitsounds later)
	// (and the song's own offset on top: songOffset.ts)
	const time = audio.currentTime * 1000 - offset - songOffsetOf(currentSong());
	// Where the song should be by the hitsounds' clock. Far off (a seek, the song stalling, the
	// audio put to sleep for a moment): all anew from here. A little off: the clock follows the
	// song gently. Safari reads the song's place coarsely: setting everything anew on each
	// reading that was a bit off shifted the hitsounds by its jitter, and a reading a bit late
	// skipped the ones in between (slider ends, often)
	const expected = anchor
		? anchor.song + (ctx.currentTime - anchor.ctx) * 1000 * anchor.rate
		: Number.NaN;
	const drift = time - expected;
	// The song's sound goes through this context too (audioGraph.ts): it reaches the speaker
	// as late as the hitsounds. Played by the element itself it doesn't: the hitsounds go
	// as much earlier as this context takes to the speaker
	const late = isRouted(audio)
		? 0
		: ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) +
			(ctx.baseLatency ?? 0);
	/** When a time of the song is on the hitsounds' clock */
	const when = (songTime: number) => anchor!.ctx + (songTime - anchor!.song) / rate / 1000 - late;
	const jumped = restart || !anchor || anchor.rate !== rate;
	if (jumped || !(Math.abs(drift) <= (hidden ? FAR_OFF_HIDDEN : FAR_OFF))) {
		// (only off the clock, not moved: a spin going on goes on, ending where it now should;
		// started anew it was heard as a click)
		stopScheduled(!jumped);
		next = indexAt(chart.events, time);
		anchor = { song: time, ctx: ctx.currentTime, rate };
		if (jumped) {
			nextSpin = chart.spinners.findIndex((spinner) => spinner.end > time);
			if (nextSpin < 0) nextSpin = chart.spinners.length;
		} else
			for (const going of spins) {
				going.end = Math.max(when(going.spinner.end), ctx.currentTime);
				going.source.stop(going.end);
			}
		restart = false;
	} else if (Math.abs(drift) > 3) anchor.song += drift * FOLLOW;
	const now = anchor.song + (ctx.currentTime - anchor.ctx) * 1000 * rate;
	const ahead = (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD) * 1000 * rate;
	const events = chart.events;
	while (next < events.length && events[next].time <= now + ahead) {
		const event = events[next++];
		const at = anchor.ctx + (event.time - anchor.song) / rate / 1000 - late;
		if (at < ctx.currentTime - 0.03) continue;
		for (const buffer of event.buffers) {
			if (!buffer) continue;
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			const gain = ctx.createGain();
			gain.gain.value = event.volume;
			source.connect(gain).connect(master!);
			source.start(Math.max(at, ctx.currentTime));
			scheduled.push({ source, at });
		}
	}
	// The spinners' spin: a loop from its start to its end, its pitch rising on the audio clock
	// (so it plays on by itself in the background too)
	const { spinners, spin } = chart;
	while (spin && nextSpin < spinners.length && spinners[nextSpin].start <= now + ahead) {
		const spinner = spinners[nextSpin++];
		const from = Math.max(spinner.start, now);
		if (from >= spinner.end) continue;
		const source = ctx.createBufferSource();
		source.buffer = spin;
		source.loop = true;
		const gain = ctx.createGain();
		gain.gain.value = SPIN_VOLUME;
		source.connect(gain).connect(master!);
		const startAt = Math.max(when(from), ctx.currentTime);
		const top = Math.min(spinTop(spinner), spinner.end);
		source.playbackRate.setValueAtTime(spinPitch(spinner, from), startAt);
		if (top > from)
			source.playbackRate.linearRampToValueAtTime(
				spinPitch(spinner, top),
				Math.max(when(top), startAt)
			);
		source.start(startAt);
		const end = Math.max(when(spinner.end), startAt);
		source.stop(end);
		spins.push({ source, spinner, end });
	}
	if (spins.length > 8) spins = spins.filter((s) => s.end > ctx.currentTime);
	if (scheduled.length > 64) scheduled = scheduled.filter((s) => s.at > ctx.currentTime - 1);
}

// --- Speed mods ----------------------------------------------------------------------------

export function setMod(choice: PlaybackMod | string) {
	const mod = (choice in MODS ? choice : 'NM') as PlaybackMod;
	updateUserSettings({ mod });
	// (picked with a tap: the beat's audio may start now)
	if (mod === 'NC') {
		prepareBeats();
		// (the beat's audio began playing last: the lock screen's controls back to the song)
		setTimeout(reclaimNowPlaying, 50);
	}
}

function applyCurrentMod() {
	const audio = get(audioElement);
	if (audio) applyMod(audio, currentMod());
}

// --- Start -----------------------------------------------------------------------------

if (typeof window !== 'undefined') {
	// The page's sounds are a player's (iOS then lets the hitsounds and the Nightcore beat play
	// on in the background: else it pauses them there, and they came late or not at all with
	// the screen locked)
	const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
	if (session) session.type = 'playback';
	let last = '';
	const reload = () => {
		const s = settings();
		const now = `${s.on}:${s.muted}:${currentMod()}:${mapIdOf()}`;
		if (now === last) return;
		last = now;
		if (!s.on) stopScheduled();
		load();
	};
	userSettings.subscribe(() => {
		applyCurrentMod();
		reload();
	});
	hardest.subscribe(() => reload());
	queue.subscribe(() => {
		restart = true;
		reload();
	});
	// (the player has two elements and swaps them in a crossfade: each is wired once)
	const wired = new WeakSet<HTMLAudioElement>();
	audioElement.subscribe((audio) => {
		if (!audio) return;
		applyCurrentMod();
		if (wired.has(audio)) return;
		wired.add(audio);
		applyCurrentMod();
		// (a new song resets the speed to the default one, which applyMod sets too)
		audio.addEventListener('loadstart', applyCurrentMod);
		const anew = () => {
			restart = true;
			if (document.hidden) tick();
		};
		audio.addEventListener('seeked', () => mine() && anew());
		audio.addEventListener('ratechange', () => mine() && anew());
		// (only the one playing counts: the other may be loading the next song)
		const mine = () => audio === get(audioElement);
		audio.addEventListener('waiting', () => {
			if (!mine()) return;
			waiting = true;
			stopScheduled();
		});
		audio.addEventListener('playing', () => {
			if (!mine()) return;
			waiting = false;
			anew();
		});
		audio.addEventListener('pause', () => tick());
		// (in the background the song's time updates come on time, the timers don't)
		audio.addEventListener('timeupdate', () => {
			if (!document.hidden) return;
			tick();
			stopBeats?.tick();
		});
	});
	// The timers run only while they have something to do (a phone feels each one)
	let ticking: ReturnType<typeof setInterval> | null = null;
	let stopBeats: ReturnType<typeof startBeats> | null = null;
	const timers = () => {
		const on = settings().on;
		if (on && !ticking) ticking = setInterval(tick, TICK);
		if (!on && ticking) {
			clearInterval(ticking);
			ticking = null;
			stopScheduled();
			awake(false);
		}
		// The Nightcore beat (the desktop app's), with the timing points read here: only while
		// Nightcore is on
		const nightcore = currentMod() === 'NC';
		if (nightcore && !stopBeats)
			stopBeats = startBeats(() => {
				const audio = get(audioElement);
				const mapId = mapIdOf();
				return {
					audio,
					setId: String(currentSong()?.id ?? ''),
					mapId,
					timing: timing?.key === mapId ? timing.points : null,
					volume: 0.6,
					// (in the background seconds ahead, as the hitsounds)
					lookahead: document.hidden ? LOOKAHEAD_HIDDEN * 1000 : undefined
				};
			});
		if (!nightcore && stopBeats) {
			stopBeats();
			stopBeats = null;
		}
	};
	userSettings.subscribe(timers);

	// Sound only after a tap (browsers' rule): wake the audio up on every one
	const wake = () => {
		if (settings().on) {
			const ctx = audioContext();
			if (ctx.state === 'suspended') ctx.resume().catch(() => {});
		}
		if (currentMod() === 'NC') {
			prepareBeats();
			setTimeout(reclaimNowPlaying, 50);
		}
	};
	window.addEventListener('pointerdown', wake, true);
	// To the background: the hitsounds scheduled seconds ahead from now on; back: a moment ahead
	document.addEventListener('visibilitychange', () => {
		restart = true;
		if (document.hidden) {
			stopBeats?.tick();
			if (settings().on) tick();
		} else wake();
	});
}
