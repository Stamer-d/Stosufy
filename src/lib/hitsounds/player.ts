// Plays the hitsounds of the beatmap with the music, like watching osu!'s autoplay: the
// samples are scheduled with Web Audio slightly ahead of the music's position. Samples come
// from the beatmap (its own hitsounds), the chosen osu! skin, or the built-in ones.

import { get, writable } from 'svelte/store';
import {
	readDir,
	readFile,
	readTextFile,
	writeTextFile,
	exists,
	mkdir
} from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';
import { fetch } from '@tauri-apps/plugin-http';
import { currentSong, songQueue } from '../stores/audio';
import { userSettings, updateUserSettings } from '../stores/user';
import { mapDataStore } from '../stores/data';
import { parseHitsounds, type HitSample, type HitsoundEvent } from './chart';
import { builtinSample } from './builtin';
import { skinFolder, hasDefaultSkin, downloadDefaultSkin, skinsChanged, BUILTIN } from './skins';
import type { MapSet, StoredMapSet } from '../types';

export type SampleSource = 'beatmap' | 'skin' | 'default' | 'simple';

export interface HitsoundStatus {
	state: 'off' | 'loading' | 'ready' | 'unavailable' | 'error';
	message?: string;
	/** How many of the song's different samples come from where */
	sources?: Partial<Record<SampleSource, number>>;
}

export const hitsoundStatus = writable<HitsoundStatus>({ state: 'off' });

const DEFAULT_VOLUME = 0.8;
const AUDIO_FILE = /\.(wav|ogg|mp3)$/i;

// --- Settings -----------------------------------------------------------------------

function settings() {
	const s = get(userSettings).settings ?? {};
	return {
		on: s.hitsounds ?? false,
		volume: s.hitsoundVolume ?? DEFAULT_VOLUME,
		skin: s.hitsoundSkin ?? null,
		// Off by default: many maps mute the hitnormal with their own silent samples, and a
		// music player should sound like the skin on every circle
		beatmap: s.mapHitsounds ?? false,
		// The "click" of every circle (the hitnormal) from the skin, even with the beatmap's
		// own samples on: maps often have quiet or silent hitnormals of their own
		skinClick: s.skinClick ?? true,
		/** Sounds turned off (whistle, finish, clap, slidertick) */
		muted: (['whistle', 'finish', 'clap', 'slidertick'] as const).filter(
			(sound) => s.hitsoundParts?.[sound] === false
		),
		offset: s.hitsoundOffset ?? 0,
		skinsFolder: s.skinsFolder ?? null
	};
}

export function toggleHitsounds() {
	updateUserSettings({ hitsounds: !settings().on });
}

// --- Folders of samples -------------------------------------------------------------

/** The audio files of a folder by lowercase name without extension */
type Folder = { dir: string; files: Map<string, string> };

const folders = new Map<string, Promise<Folder | null>>();

function folder(dir: string | null | undefined): Promise<Folder | null> {
	if (!dir) return Promise.resolve(null);
	if (!folders.has(dir)) {
		folders.set(
			dir,
			readDir(dir)
				.then((entries) => {
					const files = new Map<string, string>();
					for (const entry of entries) {
						if (!entry.isFile || !AUDIO_FILE.test(entry.name)) continue;
						const name = entry.name.toLowerCase().replace(AUDIO_FILE, '');
						// Like osu!: wav first, then ogg, then mp3
						if (!files.has(name) || /\.wav$/i.test(entry.name)) files.set(name, entry.name);
					}
					return { dir, files };
				})
				.catch(() => null)
		);
	}
	return folders.get(dir)!;
}

// --- Samples ------------------------------------------------------------------------

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

const buffers = new Map<string, Promise<AudioBuffer | null | undefined>>();

/**
 * A sample file as audio: null for files that are empty on purpose (skins mute samples with
 * them), undefined if it can't be read or decoded (then the next source is tried)
 */
function decode(file: string) {
	if (!buffers.has(file)) {
		buffers.set(
			file,
			readFile(file)
				.then(async (data) => {
					if (data.byteLength < 100) return null;
					return audioContext()
						.decodeAudioData(data.buffer.slice(0) as ArrayBuffer)
						.catch((error) => {
							console.warn('Could not decode the sample', file, error);
							return undefined;
						});
				})
				.catch(() => undefined)
		);
	}
	return buffers.get(file)!;
}

async function fromFolder(dir: Folder | null, name: string) {
	const file = dir?.files.get(name.toLowerCase());
	return file ? decode(await path.join(dir!.dir, file)) : undefined;
}

/**
 * The sound of a sample, picked like osu! does it (ppy/osu: LegacySkin, LegacyBeatmapSkin):
 * - the beatmap's own samples only for custom sample index 1+ (or a file): index 1 is
 *   "soft-hitnormal", index 2+ only "soft-hitnormal2" (no plain fallback within the map)
 * - else the skin's "soft-hitnormal", else its bank-less "hitnormal"
 * - else the same from the osu! default sounds, else the built-in one.
 * null plays nothing.
 */
async function resolve(
	sample: HitSample,
	beatmap: Folder | null,
	skin: Folder | null,
	fallback: Folder | null,
	from: (source: SampleSource) => void = () => {},
	skinClick = false
) {
	const sound = sample.sound === 'slidertick' ? 'slidertick' : `hit${sample.sound}`;
	const name = `${sample.set}-${sound}`;
	const isClick = sample.sound === 'normal' && !sample.file;
	if (beatmap && (sample.file || sample.index >= 1) && !(isClick && skinClick)) {
		const names = sample.file
			? [sample.file.replace(AUDIO_FILE, ''), name, sound]
			: sample.index >= 2
				? [name + sample.index]
				: [name, sound];
		for (const candidate of names) {
			const own = await fromFolder(beatmap, candidate);
			if (own !== undefined) {
				from('beatmap');
				return own;
			}
		}
	}
	for (const [folder, source] of [
		[skin, 'skin'],
		[fallback, 'default']
	] as const) {
		for (const candidate of [name, sound]) {
			const skinned = await fromFolder(folder, candidate);
			if (skinned !== undefined) {
				from(source);
				return skinned;
			}
		}
	}
	from('simple');
	return builtinSample(audioContext(), sample.set, sample.sound);
}

// --- The chart of the playing song ------------------------------------------------------

interface Chart {
	key: string;
	events: { time: number; volume: number; buffers: (AudioBuffer | null)[] }[];
}

let chart: Chart | null = null;

async function chartsDir(setId: string | number) {
	return path.join(await path.homeDir(), 'Stosufy', 'Songs', `${setId}-hitsounds`);
}

/** The .osu file of a difficulty and the folder with the beatmap's own samples */
async function beatmapFiles(song: MapSet, stored: StoredMapSet | undefined) {
	const mapId = String(song.beatmaps?.[0]?.id ?? '');
	const local = stored?.beatmaps?.[mapId];
	let content: string | null = null;
	let samples = stored?.hitsounds?.dir ?? null;

	/** A beatmap file's content, if it is one (not empty or cut off) */
	const read = (file: string) =>
		readTextFile(file)
			.then((text) => (text.includes('[HitObjects]') ? text : null))
			.catch(() => null);

	for (const file of [local?.chartFile, local?.osuFile]) {
		if (!file || content) continue;
		content = await read(file);
	}

	// Imported from osu!: everything is in the beatmap's folder there
	if (stored?.source === 'osu' && local?.audioFile) {
		const dir = await path.dirname(local.audioFile);
		samples ??= dir;
		if (!content) {
			for (const entry of await readDir(dir).catch(() => [])) {
				if (!entry.isFile || !entry.name.toLowerCase().endsWith('.osu')) continue;
				const text = (await read(await path.join(dir, entry.name))) ?? '';
				if (new RegExp(`^BeatmapID:\\s*${mapId}\\s*$`, 'm').test(text)) {
					content = text;
					break;
				}
			}
		}
	}

	// Downloaded before hitsounds were saved: the .osu file from osu!, kept for next time
	if (!content && Number(mapId) > 0) {
		const dir = await chartsDir(song.id);
		const file = await path.join(dir, `${mapId}.osu`);
		content = await read(file);
		if (!content) {
			const response = await fetch(`https://osu.ppy.sh/osu/${mapId}`);
			const text = response.ok ? await response.text() : '';
			if (text.includes('[HitObjects]')) {
				content = text;
				await mkdir(dir, { recursive: true }).catch(() => {});
				await writeTextFile(file, content).catch(() => {});
			}
		}
	}
	return { content, samples };
}

function songKey(song: MapSet | null) {
	return song ? `${song.id}:${song.beatmaps?.[0]?.id}` : null;
}

let loadingKey: string | null = null;

async function load() {
	const song = get(currentSong).song;
	const queue = get(songQueue);
	const { on, skin, beatmap, skinClick, muted } = settings();
	const key = song && `${songKey(song)}:${skin}:${beatmap}:${skinClick}:${muted}`;
	if (!on || !song) {
		chart = null;
		loadingKey = null;
		hitsoundStatus.set({ state: 'off' });
		return;
	}
	const stored = get(mapDataStore)[song.id] as StoredMapSet | undefined;
	// Previews are a cut of the song: the hitsounds wouldn't line up
	if (queue.type === 'preview' && !song.queued && !stored) {
		chart = null;
		loadingKey = key;
		hitsoundStatus.set({ state: 'unavailable', message: 'Not for previews' });
		return;
	}
	if (key === loadingKey) return;
	loadingKey = key;
	chart = null;
	hitsoundStatus.set({ state: 'loading' });
	try {
		// The osu! default sounds are the default skin: downloaded the first time
		if (skin !== BUILTIN && !(await hasDefaultSkin())) await downloadDefaultSkin();
		// (the setting "builtin" plays the simple built-in sounds)
		if (loadingKey !== key) return;
		const files = await beatmapFiles(song, stored);
		if (loadingKey !== key) return;
		if (!files.content) {
			hitsoundStatus.set({ state: 'unavailable', message: "Couldn't get the beatmap" });
			return;
		}
		const events: HitsoundEvent[] = parseHitsounds(files.content);
		const [beatmapFolder, skinSamples, defaultSamples] = await Promise.all([
			beatmap ? folder(files.samples) : null,
			skinFolder(skin).then(folder),
			// The osu! default sounds fill in what a skin doesn't have (not for "Simple")
			skin && skin !== BUILTIN ? skinFolder(null).then(folder) : null
		]);
		// Each different sample once
		const resolved = new Map<string, Promise<AudioBuffer | null>>();
		const sources: Partial<Record<SampleSource, number>> = {};
		const count = (source: SampleSource) => (sources[source] = (sources[source] ?? 0) + 1);
		const sound = (sample: HitSample) => {
			const id = `${sample.set}:${sample.sound}:${sample.index}:${sample.file ?? ''}`;
			if (!resolved.has(id))
				resolved.set(
					id,
					resolve(sample, beatmapFolder, skinSamples, defaultSamples, count, skinClick)
				);
			return resolved.get(id)!;
		};
		// Without the sounds turned off (a tick alone leaves nothing to play)
		const ready = (
			await Promise.all(
				events.map(async (event) => ({
					time: event.time,
					volume: event.volume / 100,
					buffers: await Promise.all(
						event.samples.filter((sample) => !(muted as string[]).includes(sample.sound)).map(sound)
					)
				}))
			)
		).filter((event) => event.buffers.length);
		if (loadingKey !== key) return;
		chart = { key: key!, events: ready };
		restart = true;
		// The skin is the osu! default sounds unless one is chosen
		if (!skin && sources.default) {
			sources.skin = (sources.skin ?? 0) + sources.default;
			delete sources.default;
		}
		hitsoundStatus.set({ state: 'ready', sources });
	} catch (error) {
		console.error('Could not load the hitsounds:', error);
		if (loadingKey === key) hitsoundStatus.set({ state: 'error', message: String(error) });
	}
}

// --- Playing ------------------------------------------------------------------------

/** How far ahead samples are scheduled; more while the window is hidden (timers slow down) */
const LOOKAHEAD = 0.12;
const LOOKAHEAD_HIDDEN = 1.5;

let next = 0;
let lastTime: number | null = null;
let restart = true;
let playing: { source: AudioBufferSourceNode; at: number }[] = [];

function stopScheduled() {
	const now = context?.currentTime ?? 0;
	for (const { source, at } of playing) if (at > now) source.stop();
	playing = [];
}

/** The first event at or after a time */
function indexAt(time: number) {
	const events = chart!.events;
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
	const audio = get(songQueue).audio;
	if (!chart || !audio || audio.paused || audio.ended) {
		if (playing.length) stopScheduled();
		lastTime = null;
		return;
	}
	const ctx = audioContext();
	if (ctx.state === 'suspended') ctx.resume();
	const { volume, offset } = settings();
	const userSettingsNow = get(userSettings).settings;
	const music = userSettingsNow?.muted ? 0 : (userSettingsNow?.volume ?? 0.05);
	master!.gain.value = music * volume * 2.5;

	const rate = audio.playbackRate || 1;
	// The song's position, with the offset: positive offsets play the hitsounds later
	const time = audio.currentTime * 1000 - offset;
	// Jumped (seek, new song, repeat): start over from here
	if (restart || lastTime === null || time < lastTime - 50 || time > lastTime + 2000) {
		stopScheduled();
		next = indexAt(time);
		restart = false;
	}
	lastTime = time;

	const ahead = (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD) * 1000 * rate;
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
			playing.push({ source, at });
		}
	}
	const now = ctx.currentTime;
	if (playing.length > 64) playing = playing.filter((p) => p.at > now);
}

let started = false;

export function startHitsounds() {
	if (started || typeof window === 'undefined') return;
	started = true;
	currentSong.subscribe(() => load());
	songQueue.subscribe(() => {
		restart = true;
		load();
	});
	let last = '';
	userSettings.subscribe(() => {
		const s = settings();
		const key = `${s.on}:${s.skin}:${s.beatmap}:${s.skinClick}:${s.muted}:${s.skinsFolder}`;
		if (key === last) return;
		last = key;
		if (!s.on) stopScheduled();
		load();
	});
	// Skins downloaded, imported or removed: read the folders again
	skinsChanged.subscribe(() => forgetSkinFolders());
	setInterval(tick, 15);
	// The browser may keep audio made without a click silent: wake it up on any click or key
	const wake = () => {
		if (context?.state === 'suspended') context.resume();
	};
	window.addEventListener('pointerdown', wake, true);
	window.addEventListener('keydown', wake, true);
}

/** Forget the read folders, e.g. after choosing another skins folder */
export function forgetSkinFolders() {
	folders.clear();
	buffers.clear();
	loadingKey = null;
	load();
}
