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
import { osuFile, hitsoundMapId } from './osuFiles';
import { queue, audioElement } from './player';
import { parseHitsounds, type HitSample } from '../lib/hitsounds/chart';
import { builtinSample } from '../lib/hitsounds/builtin';
import { bundledSamples, bundledSample } from '../lib/hitsounds/bundled';
import { parseTimingPoints, type TimingPoint } from '../lib/osuFile';
import {
	MODS,
	applyMod,
	currentMod,
	prepareBeats,
	startBeats,
	suspendBeats
} from '../lib/stores/mods';
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
const DRIFT = 45;
const DRIFT_HIDDEN = 90;

export const hitsoundStatus = writable<'off' | 'loading' | 'ready' | 'unavailable'>('off');

function settings() {
	const s = get(userSettings).settings ?? {};
	return {
		on: s.hitsounds ?? false,
		volume: s.hitsoundVolume ?? DEFAULT_VOLUME,
		offset: s.hitsoundOffset ?? 0,
		muted: (['whistle', 'finish', 'clap', 'slidertick'] as const).filter(
			(sound) => s.hitsoundParts?.[sound] === false
		) as string[]
	};
}

// --- Samples ---------------------------------------------------------------------------

let context: AudioContext | null = null;
let master: GainNode | null = null;

function audioContext() {
	if (!context) {
		// A player's audio (iOS then lets it play on in the background: else it pauses it there,
		// and the hitsounds came late or not at all with the screen locked)
		const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
		if (session) session.type = 'playback';
		context = new AudioContext({ latencyHint: 'interactive' });
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

// --- The chart of the song playing ----------------------------------------------------------

type ChartEvent = { time: number; volume: number; buffers: (AudioBuffer | null)[] };

let chart: { key: string; events: ChartEvent[] } | null = null;
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

async function load() {
	const mapId = mapIdOf();
	const s = settings();
	const needsChart = s.on;
	const needsTiming = currentMod() === 'NC';
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
	const content = await osuFile(mapId);
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
	if (loadingKey !== key) return;
	chart = { key, events: events.filter((event) => event.buffers.some(Boolean)) };
	restart = true;
	hitsoundStatus.set('ready');
}

// --- Playing ---------------------------------------------------------------------------

let next = 0;
/** The song's time (ms) at a moment of the hitsounds' clock, and its speed then */
let anchor: { song: number; ctx: number; rate: number } | null = null;
let restart = true;
let scheduled: { source: AudioBufferSourceNode; at: number }[] = [];
/** The song waits for data: what's scheduled would come early */
let waiting = false;

function stopScheduled() {
	const now = context?.currentTime ?? 0;
	for (const { source, at } of scheduled) if (at > now) source.stop();
	scheduled = [];
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
	const time = audio.currentTime * 1000 - offset;
	// Where the song should be by the hitsounds' clock: off by more than a little (a seek, the
	// song stalling, the hitsounds' audio put to sleep for a moment), all anew from here.
	// Else the hitsounds keep their clock: evenly spaced, not shifted by each reading's jitter.
	const expected = anchor
		? anchor.song + (ctx.currentTime - anchor.ctx) * 1000 * anchor.rate
		: Number.NaN;
	if (
		restart ||
		!anchor ||
		anchor.rate !== rate ||
		!(Math.abs(expected - time) <= (hidden ? DRIFT_HIDDEN : DRIFT))
	) {
		stopScheduled();
		next = indexAt(chart.events, time);
		anchor = { song: time, ctx: ctx.currentTime, rate };
		restart = false;
	}
	const now = anchor.song + (ctx.currentTime - anchor.ctx) * 1000 * rate;
	const ahead = (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD) * 1000 * rate;
	const events = chart.events;
	while (next < events.length && events[next].time <= now + ahead) {
		const event = events[next++];
		const at = anchor.ctx + (event.time - anchor.song) / rate / 1000;
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
	if (scheduled.length > 64) scheduled = scheduled.filter((s) => s.at > ctx.currentTime - 1);
}

// --- Speed mods ----------------------------------------------------------------------------

export function setMod(choice: PlaybackMod | string) {
	const mod = (choice in MODS ? choice : 'NM') as PlaybackMod;
	updateUserSettings({ mod });
	// (picked with a tap: the beat's audio may start now)
	if (mod === 'NC') prepareBeats();
}

function applyCurrentMod() {
	const audio = get(audioElement);
	if (audio) applyMod(audio, currentMod());
}

// --- Start -----------------------------------------------------------------------------

if (typeof window !== 'undefined') {
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
	queue.subscribe(() => {
		restart = true;
		reload();
	});
	audioElement.subscribe((audio) => {
		if (!audio) return;
		applyCurrentMod();
		// (a new song resets the speed to the default one, which applyMod sets too)
		audio.addEventListener('loadstart', applyCurrentMod);
		const anew = () => {
			restart = true;
			if (document.hidden) tick();
		};
		audio.addEventListener('seeked', anew);
		audio.addEventListener('ratechange', anew);
		audio.addEventListener('waiting', () => {
			waiting = true;
			stopScheduled();
		});
		audio.addEventListener('playing', () => {
			waiting = false;
			anew();
		});
		audio.addEventListener('pause', () => tick());
		// (in the background the song's time updates come on time, the timers don't)
		audio.addEventListener('timeupdate', () => document.hidden && tick());
	});
	// The timers run only while they have something to do (a phone feels each one)
	let ticking: ReturnType<typeof setInterval> | null = null;
	let stopBeats: (() => void) | null = null;
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
					audio: document.hidden ? null : audio,
					setId: String(currentSong()?.id ?? ''),
					mapId,
					timing: timing?.key === mapId ? timing.points : null,
					volume: 0.6
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
		if (currentMod() === 'NC') prepareBeats();
	};
	window.addEventListener('pointerdown', wake, true);
	// To the background: the hitsounds scheduled seconds ahead from now on; back: a moment ahead
	document.addEventListener('visibilitychange', () => {
		restart = true;
		if (document.hidden) {
			if (settings().on) tick();
			else context?.suspend().catch(() => {});
			suspendBeats();
		} else wake();
	});
}
