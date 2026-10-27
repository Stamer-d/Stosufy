// Plays the hitsounds of the beatmap with the music, like watching osu!'s autoplay: the
// samples are scheduled with Web Audio slightly ahead of the music's position. Samples come
// from the beatmap (its own hitsounds), the chosen osu! skin, or the built-in ones.

import { heardTime, outputDelay } from '../stores/equalizer';
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
import { isPreviewing, isStreamed } from '../stores/stream';
import { parseHitsounds, type HitSample, type HitsoundEvent } from './chart';
import { builtinSample } from './builtin';
import { decodeAudio } from '../audioDecode';
import {
	skinFolder,
	hasDefaultSkin,
	downloadDefaultSkin,
	completeDefaultSkin,
	skinsChanged,
	BUILTIN
} from './skins';
import { builtinExtra, type ExtraSound } from './builtin';
import { BUNDLED_DIR, bundledSamples, bundledSample } from './bundled';
import type { GameplayBeatmap } from '../gameplay/beatmap';
import {
	autoplayFor,
	lastAtOrBefore,
	spinAt,
	trackingAt,
	type Judge,
	type PlaySound
} from '../gameplay/judge';
import { activePlay, chosenMapId } from '../gameplay/play';
import type { MapSet, StoredMapSet } from '../types';

export type SampleSource = 'beatmap' | 'skin' | 'default' | 'simple';

export interface HitsoundStatus {
	state: 'off' | 'loading' | 'ready' | 'unavailable' | 'error';
	message?: string;
	/** How many of the song's different samples come from where */
	sources?: Partial<Record<SampleSource, number>>;
	/** A skin is chosen but none of its sounds could be read (e.g. no access to its folder) */
	skinUnreadable?: boolean;
	/** Why, if known */
	skinError?: string;
}

export const hitsoundStatus = writable<HitsoundStatus>({ state: 'off' });

const DEFAULT_VOLUME = 0.8;
const AUDIO_FILE = /\.(wav|ogg|mp3)$/i;

// --- Settings -----------------------------------------------------------------------

function settings() {
	const s = get(userSettings).settings ?? {};
	return {
		// Playing a map yourself always has its sounds
		on: (s.hitsounds ?? false) || get(activePlay)?.kind === 'live',
		volume: s.hitsoundVolume ?? DEFAULT_VOLUME,
		skin: s.hitsoundSkin ?? null,
		// Off by default: many maps mute the hitnormal with their own silent samples, and a
		// music player should sound like the skin on every circle
		beatmap: s.mapHitsounds ?? false,
		/** Sounds turned off (whistle, finish, clap, slidertick) */
		muted: (['whistle', 'finish', 'clap', 'slidertick', 'sliderslide', 'spinner'] as const).filter(
			(sound) => s.hitsoundParts?.[sound] === false
		),
		offset: s.hitsoundOffset ?? 0,
		skinsFolder: s.osuFolder ?? s.skinsFolder ?? null
	};
}

export function toggleHitsounds() {
	updateUserSettings({ hitsounds: !settings().on });
}

// --- Folders of samples -------------------------------------------------------------

/** The audio files of a folder by lowercase name without extension */
type Folder = { dir: string; files: Map<string, string> };

const folders = new Map<string, Promise<Folder | null>>();
/** Why a folder couldn't be read, to show it */
const folderErrors = new Map<string, string>();

/** The hitsounds that come with Stosufy: the default skin's */
const bundledFolder = (): Promise<Folder> =>
	Promise.resolve({ dir: BUNDLED_DIR, files: bundledSamples });

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
				.catch((error) => {
					folderErrors.set(dir, String(error));
					console.warn('Could not read the folder', dir, error);
					return null;
				})
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
function decode(file: string, bundled = false) {
	if (!buffers.has(file)) {
		buffers.set(
			file,
			(bundled ? bundledSample(file).then((data) => new Uint8Array(data)) : readFile(file))
				.then(async (data) => {
					if (data.byteLength < 100) return null;
					return decodeAudio(audioContext(), data.buffer.slice(0) as ArrayBuffer).catch((error) => {
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
	if (!file) return undefined;
	if (dir!.dir === BUNDLED_DIR) return decode(file, true);
	return decode(await path.join(dir!.dir, file));
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
	from: (source: SampleSource) => void = () => {}
) {
	const sound = sample.sound === 'slidertick' ? 'slidertick' : `hit${sample.sound}`;
	const name = `${sample.set}-${sound}`;
	// The click of every circle (the hitnormal) always comes from the skin: maps often have
	// quiet or silent hitnormals of their own
	const isClick = sample.sound === 'normal' && !sample.file;
	if (beatmap && (sample.file || sample.index >= 1) && !isClick) {
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

/** A sound of the play besides the hitsounds (spinner, slider slide, combo break) */
async function resolveExtra(
	name: ExtraSound,
	skin: Folder | null,
	fallback: Folder | null,
	simple: boolean
) {
	const names = name.endsWith('sliderslide') ? [name, 'sliderslide'] : [name];
	if (!simple) {
		for (const folder of [skin, fallback]) {
			for (const candidate of names) {
				const found = await fromFolder(folder, candidate);
				if (found !== undefined) return found;
			}
		}
	}
	return builtinExtra(audioContext(), name);
}

// --- Sounds outside of a map (the puzzle) ---------------------------------------------------

/** The sounds of the chosen skin by name, once per skin */
const skinSounds = new Map<string, Promise<AudioBuffer | null | undefined>>();

/**
 * Plays a sound of the chosen osu! skin right away, else the osu! default one, else the
 * built-in one: "hitnormal" etc. in a sample set, or the combo break. Doesn't download the
 * default skin for it; the hitsound volume counts.
 */
export function playSkinSound(
	sound: HitSample['sound'] | 'combobreak',
	set: HitSample['set'] = 'normal',
	volume = 1
) {
	const { skin, volume: hitsoundVolume } = settings();
	const key = `${skin}:${set}:${sound}`;
	if (!skinSounds.has(key)) {
		skinSounds.set(
			key,
			(async () => {
				// (no skin chosen: Stosufy's own sounds, the osu! default ones fill in)
				const [skinSamples, defaultSamples] = await Promise.all([
					skin ? skinFolder(skin).then(folder) : bundledFolder(),
					skin !== BUILTIN ? skinFolder(null).then(folder) : null
				]);
				if (sound === 'combobreak')
					return resolveExtra('combobreak', skinSamples, defaultSamples, skin === BUILTIN);
				return resolve({ set, sound, index: 0 }, null, skinSamples, defaultSamples);
			})().catch(() =>
				builtinSample(audioContext(), set, sound === 'combobreak' ? 'normal' : sound)
			)
		);
	}
	skinSounds.get(key)!.then((buffer) => {
		if (!buffer) return;
		const ctx = audioContext();
		if (ctx.state === 'suspended') ctx.resume();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const gain = ctx.createGain();
		gain.gain.value = volume * hitsoundVolume;
		source.connect(gain).connect(master!);
		source.start();
	});
}

/** The index of the event nearest to a time */
function nearestEvent<T extends { time: number }>(events: T[], time: number) {
	let low = 0;
	let high = events.length - 1;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (events[mid].time < time) low = mid + 1;
		else high = mid;
	}
	if (low > 0 && Math.abs(events[low - 1].time - time) <= Math.abs(events[low]?.time - time))
		return low - 1;
	return low;
}

// --- The chart of the playing song ------------------------------------------------------

type ChartEvent = { time: number; volume: number; buffers: (AudioBuffer | null)[] };

interface Chart {
	key: string;
	/** The song and difficulty (to match the gameplay view's play) */
	playKey: string;
	events: ChartEvent[];
	/** The osu!standard objects, for autoplay's play when the gameplay view doesn't show one */
	beatmap: GameplayBeatmap | null;
	content: string;
	/** Sounds of the play besides the hitsounds: spinner, slider slide, combo break */
	extras: Partial<Record<ExtraSound, AudioBuffer | null>>;
	/** The slider slide's sample set at each slider (by the time of its head) */
	slideSets: Map<number, string>;
	spinnerModulate: boolean;
	muted: string[];
}

let chart: Chart | null = null;

async function chartsDir(setId: string | number) {
	return path.join(await path.homeDir(), 'Stosufy', 'Songs', `${setId}-hitsounds`);
}

/** The .osu file of a difficulty and the folder with the beatmap's own samples */
async function beatmapFiles(
	song: MapSet,
	stored: StoredMapSet | undefined,
	mapId = chosenMapId(song) ?? ''
) {
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

/** The .osu file of a difficulty (by default the chosen one; also for the gameplay view) */
export async function beatmapContent(song: MapSet, mapId?: string | null) {
	const stored = get(mapDataStore)[song.id] as StoredMapSet | undefined;
	return (await beatmapFiles(song, stored, mapId ?? chosenMapId(song) ?? '')).content;
}

function songKey(song: MapSet | null) {
	return song ? `${song.id}:${chosenMapId(song)}` : null;
}

let loadingKey: string | null = null;

async function load() {
	const song = get(currentSong).song;
	const queue = get(songQueue);
	const { on, skin, beatmap, muted } = settings();
	const key = song && `${songKey(song)}:${skin}:${beatmap}:${muted}`;
	if (!on || !song) {
		chart = null;
		loadingKey = null;
		hitsoundStatus.set({ state: 'off' });
		return;
	}
	const stored = get(mapDataStore)[song.id] as StoredMapSet | undefined;
	// Previews are a cut of the song: the hitsounds wouldn't line up
	if (
		(queue.type === 'preview' && !song.queued && !stored && !isStreamed(song)) ||
		isPreviewing(song)
	) {
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
			// No skin chosen: the sounds that come with Stosufy
			skin ? skinFolder(skin).then(folder) : bundledFolder(),
			// The osu! default sounds fill in what a skin doesn't have (not for "Simple")
			skin !== BUILTIN ? skinFolder(null).then(folder) : null
		]);
		// Each different sample once
		const resolved = new Map<string, Promise<AudioBuffer | null>>();
		const sources: Partial<Record<SampleSource, number>> = {};
		const count = (source: SampleSource) => (sources[source] = (sources[source] ?? 0) + 1);
		const sound = (sample: HitSample) => {
			const id = `${sample.set}:${sample.sound}:${sample.index}:${sample.file ?? ''}`;
			if (!resolved.has(id))
				resolved.set(id, resolve(sample, beatmapFolder, skinSamples, defaultSamples, count));
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
		// The play's other sounds, from the skin, the osu! default ones, else built in
		const auto = autoplayFor(files.content);
		const gameplay = auto?.beatmap ?? null;
		const extraNames: ExtraSound[] = [
			'spinnerspin',
			'spinnerbonus',
			'combobreak',
			'normal-sliderslide',
			'soft-sliderslide',
			'drum-sliderslide'
		];
		const extras: Chart['extras'] = {};
		await Promise.all(
			extraNames.map(async (name) => {
				extras[name] = await resolveExtra(name, skinSamples, defaultSamples, skin === BUILTIN);
			})
		);
		const slideSets = new Map<number, string>();
		for (const object of gameplay?.objects ?? []) {
			if (object.kind !== 'slider') continue;
			const head = events[nearestEvent(events, object.time)];
			if (head && Math.abs(head.time - object.time) <= 3)
				slideSets.set(object.time, head.samples[0]?.set ?? 'normal');
		}
		if (loadingKey !== key) return;
		chart = {
			key: key!,
			playKey: songKey(song)!,
			events: ready,
			beatmap: gameplay,
			content: files.content,
			extras,
			slideSets,
			spinnerModulate: true,
			muted: muted as string[]
		};
		autoplay = null;
		restart = true;
		// The skin is the osu! default sounds unless one is chosen
		if (!skin && sources.default) {
			sources.skin = (sources.skin ?? 0) + sources.default;
			delete sources.default;
		}
		// A skin is chosen, but not a single sound came from it
		const skinUnreadable = !!skin && skin !== BUILTIN && !sources.skin;
		const skinDir = skin && skin !== BUILTIN ? await skinFolder(skin) : null;
		const skinError = skinUnreadable
			? ((skinDir && folderErrors.get(skinDir)) ??
				(skinSamples
					? `Found ${skinSamples.files.size} sound files in ${skinSamples.dir}, but none could be played`
					: `Couldn't open ${skinDir ?? 'the skin folder'}`))
			: undefined;
		if (skinUnreadable) console.warn('The skin gave no sounds:', skin, skinError);
		hitsoundStatus.set({ state: 'ready', sources, skinUnreadable, skinError });
	} catch (error) {
		console.error('Could not load the hitsounds:', error);
		if (loadingKey === key) hitsoundStatus.set({ state: 'error', message: String(error) });
	}
}

// --- Playing ------------------------------------------------------------------------

/** How far ahead samples are scheduled; more while the window is hidden (timers slow down) */
const LOOKAHEAD = 0.2;
const LOOKAHEAD_HIDDEN = 1.5;

let next = 0;
let lastTime: number | null = null;
let restart = true;
let playing: { source: AudioBufferSourceNode; at: number }[] = [];
/** Autoplay's play of the song, when the gameplay view doesn't show one */
let autoplay: Judge | null = null;
/** The play whose sounds are scheduled (to start over when it changes) */
let scheduledFor: Judge | null = null;

function stopScheduled() {
	const now = context?.currentTime ?? 0;
	for (const { source, at } of playing) if (at > now) source.stop();
	playing = [];
}

/** The play the sounds follow: the gameplay view's, else autoplay's; null without objects */
function currentPlay(): { judge: Judge; live: boolean } | null {
	if (!chart) return null;
	const shown = get(activePlay);
	if (shown && shown.key === chart.playKey)
		return { judge: shown.judge, live: shown.kind === 'live' };
	if (!chart.beatmap) return null;
	autoplay ??= autoplayFor(chart.content)?.judge ?? null;
	if (!autoplay) return null;
	return { judge: autoplay, live: false };
}

/** The first sound at or after a time */
function soundIndexAt(sounds: PlaySound[], time: number) {
	let low = 0;
	let high = sounds.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (sounds[mid].at < time) low = mid + 1;
		else high = mid;
	}
	return low;
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

/**
 * Plays samples `delay` seconds from now as heard: started earlier by the output delay of the
 * sound card, so they're heard together with the song (whose time already counts it)
 */
function schedule(buffers: (AudioBuffer | null | undefined)[], volume: number, delay: number) {
	const ctx = audioContext();
	const at = ctx.currentTime + Math.max(0, delay - outputDelay(ctx));
	for (const buffer of buffers) {
		if (!buffer) continue;
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const gain = ctx.createGain();
		gain.gain.value = volume;
		source.connect(gain).connect(master!);
		source.start(at);
		playing.push({ source, at });
	}
}

/** The samples of a sound of a play */
function soundBuffers(sound: PlaySound): {
	buffers: (AudioBuffer | null | undefined)[];
	volume: number;
} {
	if (!chart) return { buffers: [], volume: 1 };
	if (sound.kind === 'hit') {
		const event = chart.events[nearestEvent(chart.events, sound.time)];
		if (!event || Math.abs(event.time - sound.time) > 3) return { buffers: [], volume: 1 };
		return { buffers: event.buffers, volume: event.volume };
	}
	if (sound.kind === 'spinnerbonus' && chart.muted.includes('spinner'))
		return { buffers: [], volume: 1 };
	return { buffers: [chart.extras[sound.kind]], volume: sound.kind === 'combobreak' ? 0.8 : 0.7 };
}

/** Plays a sound of the user's own play right away (or when it's due) */
export function playSoundNow(sound: PlaySound, judge: Judge) {
	const audio = get(songQueue).audio;
	const shown = get(activePlay);
	if (!chart || !audio || shown?.judge !== judge || chart.playKey !== shown.key) return;
	const ctx = audioContext();
	if (ctx.state === 'suspended') ctx.resume();
	const { offset } = settings();
	const time = heardTime(audio) - offset;
	const { buffers, volume } = soundBuffers(sound);
	schedule(buffers, volume, (sound.at - time) / (audio.playbackRate || 1) / 1000);
}

// --- Loops: the slider slide and the spinner's spin ---------------------------------------

type Loop = { source: AudioBufferSourceNode; gain: GainNode; buffer: AudioBuffer } | null;
let slideLoop: Loop = null;
let spinLoop: Loop = null;

function loop(
	current: Loop,
	buffer: AudioBuffer | null | undefined,
	volume: number,
	rate = 1
): Loop {
	if (!buffer || volume <= 0) {
		current?.source.stop();
		return null;
	}
	if (current && current.buffer !== buffer) {
		current.source.stop();
		current = null;
	}
	if (!current) {
		const ctx = audioContext();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.loop = true;
		const gain = ctx.createGain();
		source.connect(gain).connect(master!);
		source.start();
		current = { source, gain, buffer };
	}
	current.gain.gain.value = volume;
	current.source.playbackRate.value = rate;
	return current;
}

function stopLoops() {
	slideLoop = loop(slideLoop, null, 0);
	spinLoop = loop(spinLoop, null, 0);
}

/** The slider being slid and the spinner being spun at a time */
function updateLoops(judge: Judge, time: number) {
	const objects = judge.beatmap.objects;
	let slide: AudioBuffer | null | undefined = null;
	let spin: { rate: number } | null = null;
	// Objects around this time
	let i = Math.max(0, lastAtOrBefore(objects, time));
	for (; i >= 0 && i > lastAtOrBefore(objects, time) - 8; i--) {
		const object = objects[i];
		if (time < object.time || time > object.endTime) continue;
		const state = judge.states[object.index];
		if (
			object.kind === 'slider' &&
			!chart!.muted.includes('sliderslide') &&
			trackingAt(state, time)
		) {
			const set = chart!.slideSets.get(object.time) ?? 'normal';
			slide = chart!.extras[`${set}-sliderslide` as ExtraSound];
		}
		if (object.kind === 'spinner' && !chart!.muted.includes('spinner')) {
			const { total, rpm } = spinAt(state, time);
			if (rpm > 30) {
				const progress = total / (Math.PI * 2) / (object.spinner!.required || 1);
				// Higher as it's spun, like osu! (DrawableSpinner)
				const rate = chart!.spinnerModulate
					? Math.min(100000 / 44100, (20000 + progress * 40000) / 44100)
					: 1;
				spin = { rate };
			}
		}
	}
	slideLoop = loop(slideLoop, slide, 0.6);
	spinLoop = loop(spinLoop, spin ? chart!.extras.spinnerspin : null, 0.6, spin?.rate ?? 1);
}

function tick() {
	const audio = get(songQueue).audio;
	if (!chart || !audio || audio.paused || audio.ended) {
		if (playing.length) stopScheduled();
		stopLoops();
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
	const time = heardTime(audio) - offset;
	const play = currentPlay();
	// Jumped (seek, new song, repeat) or another play: start over from here
	if (
		restart ||
		lastTime === null ||
		time < lastTime - 50 ||
		time > lastTime + 2000 ||
		scheduledFor !== (play?.judge ?? null)
	) {
		stopScheduled();
		next = play ? soundIndexAt(play.judge.sounds, time) : indexAt(time);
		restart = false;
		scheduledFor = play?.judge ?? null;
	}
	lastTime = time;

	const ahead = (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD) * 1000 * rate;
	if (play) {
		// The play's sounds: only what's hit. The user's own play plays them as they happen.
		if (!play.live) {
			const sounds = play.judge.sounds;
			while (next < sounds.length && sounds[next].at <= time + ahead) {
				const sound = sounds[next++];
				const delay = (sound.at - time) / rate / 1000;
				if (delay < -0.03) continue;
				const { buffers, volume: eventVolume } = soundBuffers(sound);
				schedule(buffers, eventVolume, delay);
			}
		}
		updateLoops(play.judge, time);
	} else {
		// No osu!standard objects (taiko, mania): the beatmap's hitsounds as they are
		const events = chart.events;
		while (next < events.length && events[next].time <= time + ahead) {
			const event = events[next++];
			const delay = (event.time - time) / rate / 1000;
			if (delay < -0.03) continue;
			schedule(event.buffers, event.volume, delay);
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
	const reload = () => {
		const s = settings();
		const song = get(currentSong).song;
		const key = `${s.on}:${s.skin}:${s.beatmap}:${s.muted}:${s.skinsFolder}:${songKey(song)}`;
		if (key === last) return;
		last = key;
		if (!s.on) {
			stopScheduled();
			stopLoops();
		}
		load();
	};
	userSettings.subscribe(reload);
	activePlay.subscribe(() => {
		restart = true;
		reload();
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
	folderErrors.clear();
	buffers.clear();
	skinSounds.clear();
	loadingKey = null;
	load();
}
