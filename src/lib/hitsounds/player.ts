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
import type { MapSet, StoredMapSet } from '../types';

export interface HitsoundStatus {
	state: 'off' | 'loading' | 'ready' | 'unavailable' | 'error';
	message?: string;
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
		beatmap: s.beatmapHitsounds ?? true,
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

/** The osu! Skins folder: chosen in the settings, else the default osu! one */
export async function skinsFolder(): Promise<string | null> {
	const chosen = settings().skinsFolder;
	if (chosen) return chosen;
	try {
		const dir = await path.join(await path.localDataDir(), 'osu!', 'Skins');
		return (await exists(dir)) ? dir : null;
	} catch {
		return null;
	}
}

/** The skins in the osu! Skins folder */
export async function listSkins(): Promise<string[]> {
	const dir = await skinsFolder();
	if (!dir) return [];
	try {
		return (await readDir(dir))
			.filter((entry) => entry.isDirectory)
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
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

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** A sample file as audio; null for files that are empty on purpose (skins mute samples so) */
function decode(file: string) {
	if (!buffers.has(file)) {
		buffers.set(
			file,
			readFile(file)
				.then(async (data) => {
					if (data.byteLength < 100) return null;
					return audioContext().decodeAudioData(data.buffer.slice(0) as ArrayBuffer);
				})
				.catch(() => null)
		);
	}
	return buffers.get(file)!;
}

async function fromFolder(dir: Folder | null, name: string) {
	const file = dir?.files.get(name.toLowerCase());
	return file ? decode(await path.join(dir!.dir, file)) : undefined;
}

/**
 * The sound of a sample, like osu! picks it: the beatmap's own (custom index 1+ or a file),
 * else the skin's, else the built-in one. null plays nothing.
 */
async function resolve(sample: HitSample, beatmap: Folder | null, skin: Folder | null) {
	const name = `${sample.set}-hit${sample.sound}`;
	if (beatmap) {
		if (sample.file) {
			const own = await fromFolder(beatmap, sample.file.replace(AUDIO_FILE, ''));
			if (own !== undefined) return own;
		}
		if (sample.index >= 1) {
			const own = await fromFolder(beatmap, sample.index > 1 ? name + sample.index : name);
			if (own !== undefined) return own;
		}
	}
	const skinned = await fromFolder(skin, name);
	if (skinned !== undefined) return skinned;
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
	const { on, skin, beatmap } = settings();
	const key = song && `${songKey(song)}:${skin}:${beatmap}`;
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
		const files = await beatmapFiles(song, stored);
		if (loadingKey !== key) return;
		if (!files.content) {
			hitsoundStatus.set({ state: 'unavailable', message: "Couldn't get the beatmap" });
			return;
		}
		const events: HitsoundEvent[] = parseHitsounds(files.content);
		const [beatmapFolder, skinFolder] = await Promise.all([
			beatmap ? folder(files.samples) : null,
			skin ? skinsFolder().then((dir) => (dir ? path.join(dir, skin).then(folder) : null)) : null
		]);
		// Each different sample once
		const resolved = new Map<string, Promise<AudioBuffer | null>>();
		const sound = (sample: HitSample) => {
			const id = `${sample.set}:${sample.sound}:${sample.index}:${sample.file ?? ''}`;
			if (!resolved.has(id)) resolved.set(id, resolve(sample, beatmapFolder, skinFolder));
			return resolved.get(id)!;
		};
		const ready = await Promise.all(
			events.map(async (event) => ({
				time: event.time,
				volume: event.volume / 100,
				buffers: await Promise.all(event.samples.map(sound))
			}))
		);
		if (loadingKey !== key) return;
		chart = { key: key!, events: ready };
		restart = true;
		hitsoundStatus.set({ state: 'ready' });
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
		const key = `${s.on}:${s.skin}:${s.beatmap}:${s.skinsFolder}`;
		if (key === last) return;
		last = key;
		if (!s.on) stopScheduled();
		load();
	});
	setInterval(tick, 15);
}

/** Forget the read folders, e.g. after choosing another skins folder */
export function forgetSkinFolders() {
	folders.clear();
	buffers.clear();
	loadingKey = null;
	load();
}
