// Hitsounds on the phone, as in the desktop app: the beatmap's hitsounds play with the music,
// like watching osu!'s autoplay, with the sounds that come with Stosufy. And the speed mods:
// Double Time / Nightcore 1.5× (Nightcore higher, with its drum beat), Half Time / Daycore
// 0.75×. The settings are the account's, the same as on the desktop.
//
// The samples are scheduled with Web Audio a moment ahead of where the song is. In the
// background (screen locked) the phone stops the page's timers: then only the music plays on,
// a bit faster or slower with a mod.

import { get, writable } from 'svelte/store';
import { userSettings, updateUserSettings } from './shims/user';
import { osuFile } from './osuFiles';
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
import type { PlaybackMod } from '../lib/types';

export type { PlaybackMod };
export { MODS };

const DEFAULT_VOLUME = 0.8;
/** How loud the hitsounds are next to the music (the phone plays the music at full volume) */
const LEVEL = 0.6;
const LOOKAHEAD = 0.2;
const TICK = 15;

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
const mapIdOf = () => String(currentSong()?.beatmaps?.[0]?.id ?? '');

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
let lastTime: number | null = null;
let restart = true;
let scheduled: { source: AudioBufferSourceNode; at: number }[] = [];

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

function tick() {
	const audio = get(audioElement);
	if (!chart || !audio || audio.paused || audio.ended || document.hidden) {
		if (scheduled.length) stopScheduled();
		lastTime = null;
		return;
	}
	const ctx = audioContext();
	if (ctx.state === 'suspended') {
		ctx.resume().catch(() => {});
		return;
	}
	const { volume, offset } = settings();
	master!.gain.value = volume * LEVEL;
	const rate = audio.playbackRate || 1;
	// (positive offsets play the hitsounds later)
	const time = audio.currentTime * 1000 - offset;
	if (restart || lastTime === null || time < lastTime - 50 || time > lastTime + 2000) {
		stopScheduled();
		next = indexAt(chart.events, time);
		restart = false;
	}
	lastTime = time;
	const ahead = LOOKAHEAD * 1000 * rate;
	const events = chart.events;
	while (next < events.length && events[next].time <= time + ahead) {
		const event = events[next++];
		const delay = (event.time - time) / rate / 1000;
		if (delay < -0.03) continue;
		const at = ctx.currentTime + Math.max(0, delay);
		for (const buffer of event.buffers) {
			if (!buffer) continue;
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			const gain = ctx.createGain();
			gain.gain.value = event.volume;
			source.connect(gain).connect(master!);
			source.start(at);
			scheduled.push({ source, at });
		}
	}
	if (scheduled.length > 64) scheduled = scheduled.filter((s) => s.at > ctx.currentTime);
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
		audio.addEventListener('seeked', () => (restart = true));
	});
	setInterval(tick, TICK);

	// The Nightcore beat (the desktop app's), with the timing points read here
	startBeats(() => {
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

	// Sound only after a tap (browsers' rule): wake the audio up on every one
	const wake = () => {
		if (settings().on) {
			const ctx = audioContext();
			if (ctx.state === 'suspended') ctx.resume().catch(() => {});
		}
		if (currentMod() === 'NC') prepareBeats();
	};
	window.addEventListener('pointerdown', wake, true);
	// In the background the timers stop: let the sounds rest, so they don't come in late
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopScheduled();
			context?.suspend().catch(() => {});
			suspendBeats();
		} else {
			restart = true;
			wake();
		}
	});
}
