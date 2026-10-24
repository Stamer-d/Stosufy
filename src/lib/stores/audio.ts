// The music player: the queue, the song that plays (an <audio> element through the mixer),
// switching songs with fades and crossfades, the sleep timer and the radio.
//
// Every song change goes through loadSong(); what the app shows as playing follows the audio
// element's own play and pause events, so it stays right whoever pauses it (the DJ mode, a
// listening session, the end of the song).

import { get, writable } from 'svelte/store';
import { downloadBeatmap, mapDataStore, saveMapData } from './data';
import { updateCurrentQueue, updateUserSettings, userSettings } from './user';
import { applyMod, prepareBeats, startBeats } from './mods';
import { track, untrack, setFade, setGain, rampGain, fadeTo, refresh } from './mixer';
import { measureLoudness, gainFor } from './loudness';
import { sameSong } from '../tracks';
import { offline } from './network';
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { playableBytes } from '../audioDecode';
import { attach, applyEq, detach, eqSettings } from './equalizer';
import { showToast } from './toast';
import { librarySong, radioSongs, afterSkip, RADIO_TOP_UP } from './radio';
import { setRPCActivity } from './discord';
import { playlistSongsCache } from './playlist';
import {
	isStreamed,
	markPreviewing,
	markStreamed,
	mirrorResting,
	openStream,
	prefetchStreams,
	streamedLoudness,
	streamingOn,
	streamMapId,
	type Incoming
} from './stream';
import type {
	CurrentSong,
	MapSet,
	PlaybackMod,
	PlaylistId,
	QueueType,
	RepeatMode,
	SongQueue
} from '../types';

export const songQueue = writable<SongQueue>({});
export const currentSong = writable<CurrentSong>({ song: null, isPlaying: false });
/** Songs the user queued with "Play next" / "Add to queue"; they play before the rest of the queue */
export const upNext = writable<MapSet[]>([]);
export const queuePanelOpen = writable(false);
/** Focus mode: only the wallpaper, the clock and the player */
export const focusMode = writable(false);
/** Position of the current song, updated twice a second */
export const playbackTime = writable({ current: 0, duration: 0 });

/** How often the position is saved, so the next start goes on from there (s of the song) */
const SAVE_POSITION_EVERY = 5;

if (typeof window !== 'undefined') {
	let savedAt = 0;
	setInterval(() => {
		const { audio, type, playlistId } = get(songQueue);
		const current = audio?.currentTime ?? 0;
		const duration = audio?.duration || 0;
		const previous = get(playbackTime);
		if (previous.current !== current || previous.duration !== duration) {
			playbackTime.set({ current, duration });
		}
		if (audio && type === 'playlist' && Math.abs(current - savedAt) >= SAVE_POSITION_EVERY) {
			savedAt = current;
			updateCurrentQueue({ currentSeconds: current || 0.001, playlistId });
		}
	}, 500);
}

const repeatMode = (): RepeatMode => get(userSettings).settings.repeat ?? 'off';
const crossfadeSeconds = () => get(userSettings).settings?.crossfade ?? 0;

// --- A song's audio ------------------------------------------------------------------------

function bytesFromBase64(base64Data: string) {
	const characters = atob(base64Data);
	const bytes = new Uint8Array(characters.length);
	for (let i = 0; i < characters.length; i++) bytes[i] = characters.charCodeAt(i);
	return bytes;
}

let measurements = Promise.resolve();

/**
 * Loudness normalization: songs measured before get their volume right away; others are
 * measured in the background (one at a time) and adjusted smoothly once that's done.
 */
function normalize(
	audio: HTMLAudioElement,
	song: MapSet,
	mapId: number | string,
	file: Uint8Array
) {
	const setId = String(song.id);
	const stored = get(mapDataStore)[setId];
	const audioFile = stored?.beatmaps?.[mapId]?.audioFile;
	if (!stored || !audioFile) {
		if (isStreamed(song)) normalizeStreamed(audio, String(mapId), file);
		return;
	}
	// Measured per audio file: sets can contain several songs
	const known = Object.values(stored.beatmaps).find(
		(map) => map.audioFile === audioFile && map.loudness != null
	)?.loudness;
	if (known != null) {
		setGain(audio, gainFor(known));
		return;
	}
	measurements = measurements.then(async () => {
		// Not while the song starts (its gameplay and the switch are loading then)
		await new Promise((resolve) => setTimeout(resolve, 4000));
		const loudness = await measureLoudness(file);
		if (loudness == null) return;
		// Kept in the stored set without updating the whole library (that redraws a lot);
		// it's only needed the next time the song plays
		const set = get(mapDataStore)[setId];
		if (set) {
			for (const map of Object.values(set.beatmaps))
				if (map.audioFile === audioFile) map.loudness = loudness;
		}
		await saveMapData();
		rampGain(audio, gainFor(loudness));
	});
}

/** A streamed song: measured once a session (it isn't in the library to keep it in) */
function normalizeStreamed(audio: HTMLAudioElement, mapId: string, file: Uint8Array) {
	const known = streamedLoudness.get(mapId);
	if (known != null) {
		setGain(audio, gainFor(known));
		return;
	}
	measurements = measurements.then(async () => {
		await new Promise((resolve) => setTimeout(resolve, 4000));
		const loudness = await measureLoudness(file);
		if (loudness == null) return;
		streamedLoudness.set(mapId, loudness);
		rampGain(audio, gainFor(loudness));
	});
}

/** A song that isn't downloaded can't play without a connection */
class OfflineError extends Error {
	constructor(song: MapSet) {
		super(`${song.title} isn't downloaded`);
	}
}

/**
 * The difficulty whose song is saved locally, if the set is downloaded: songs from the
 * beatmap search then play in full from the disk instead of the osu! preview
 */
function localMapId(song: MapSet) {
	const stored = get(mapDataStore)[song.id];
	if (!stored) return null;
	const own = song.beatmaps?.find((map) => stored.beatmaps?.[map.id]?.audioFile)?.id;
	return own ?? Object.values(stored.beatmaps ?? {}).find((map) => map.audioFile)?.id ?? null;
}

/**
 * Throws away a song's audio that won't be played (again): stopped, out of the mixer and
 * the audio graph, and its data freed (a whole song each)
 */
function discard(audio: HTMLAudioElement | null | undefined) {
	if (!audio) return;
	audio.pause();
	untrack(audio);
	detach(audio);
	if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
}

/**
 * A streamed song's audio. An MP3 starts playing while it still comes in (fed to a
 * MediaSource as it arrives); anything else, or one that's already here, plays once whole.
 * While it comes in, `data-loading` is set on the element (it doesn't know its length yet).
 */
async function streamedAudio(incoming: Incoming): Promise<HTMLAudioElement> {
	const live =
		!incoming.complete &&
		incoming.format === 'mp3' &&
		typeof MediaSource !== 'undefined' &&
		MediaSource.isTypeSupported('audio/mpeg');
	if (!live) {
		const bytes = await incoming.bytes;
		if (!bytes) throw new Error('The streamed song broke off');
		return new Audio(URL.createObjectURL(new Blob([await playableBytes(bytes)])));
	}
	const source = new MediaSource();
	const audio = new Audio(URL.createObjectURL(source));
	audio.dataset.loading = '1';
	source.addEventListener(
		'sourceopen',
		() => {
			const buffer = source.addSourceBuffer('audio/mpeg');
			buffer.mode = 'sequence';
			const pending: Uint8Array[] = [...incoming.chunks];
			let ended = incoming.complete;
			const finish = () => {
				if (source.readyState === 'open') source.endOfStream();
				delete audio.dataset.loading;
			};
			const pump = () => {
				if (buffer.updating || source.readyState !== 'open') return;
				if (!pending.length) {
					if (ended) finish();
					return;
				}
				// What came in since, in one go
				const size = pending.reduce((sum, chunk) => sum + chunk.byteLength, 0);
				const joined = new Uint8Array(size);
				let at = 0;
				for (const chunk of pending) {
					joined.set(chunk, at);
					at += chunk.byteLength;
				}
				try {
					buffer.appendBuffer(joined);
					pending.length = 0;
				} catch (error) {
					// The buffer is full (a very long song): what's been played makes room
					if (error instanceof DOMException && error.name === 'QuotaExceededError') {
						if (audio.currentTime > 20) buffer.remove(0, audio.currentTime - 10);
						else setTimeout(pump, 1000);
						return;
					}
					console.error('Could not stream the song further:', error);
					ended = true;
					pending.length = 0;
					finish();
				}
			};
			buffer.addEventListener('updateend', pump);
			incoming.listen((chunk) => {
				if (chunk) pending.push(chunk);
				else ended = true;
				pump();
			});
			pump();
		},
		{ once: true }
	);
	return audio;
}

/** The song's audio, loaded up to `currentSeconds` and ready to play */
async function createAudio(song: MapSet, type: QueueType, currentSeconds = 0) {
	let audio: HTMLAudioElement;
	const mapId = localMapId(song);
	const silent = fadeInNext || smoothIn;
	// Not downloaded and streaming is on: the whole song from the mirror (else as before)
	const streamId = mapId == null && streamingOn() ? streamMapId(song) : null;
	const incoming = streamId != null ? await openStream(streamId).catch(() => null) : null;
	markStreamed(song, !!incoming);
	// Streaming is on but the mirror didn't have it (or wants a break): the preview, never a
	// download nobody asked for (only songs without a preview are still downloaded)
	const previewInstead = streamId != null && !incoming && !!song.preview_url;
	markPreviewing(song, previewInstead);
	if (previewInstead && !mirrorResting())
		showToast(
			`Couldn't stream "${song.title}" right now: playing its preview`,
			'icon-[mingcute--cloud-line]'
		);
	if (incoming) {
		audio = await streamedAudio(incoming);
		track(audio, silent ? 0 : 1);
		incoming.bytes.then((bytes) => bytes && normalize(audio, song, streamId!, bytes));
	} else if (previewInstead || (type == 'preview' && !song.queued && mapId == null)) {
		audio = new Audio(`${song.preview_url}`);
		track(audio, silent ? 0 : 1);
	} else {
		// Offline only downloaded songs can play
		if (mapId == null && get(offline)) throw new OfflineError(song);
		const playedMapId = mapId ?? song.beatmaps[0].id;
		// Downloaded: straight from the file (no detour through the download, which also
		// saved the whole library each time)
		const localFile =
			mapId != null ? get(mapDataStore)[song.id]?.beatmaps?.[mapId]?.audioFile : null;
		const file = localFile
			? await readFile(localFile, { baseDir: BaseDirectory.Home }).catch(() => null)
			: null;
		const bytes = file ?? bytesFromBase64(await downloadBeatmap(song, playedMapId));
		// (Ogg as WAV where the web view can't play it: Safari's WebKit on macOS)
		audio = new Audio(URL.createObjectURL(new Blob([await playableBytes(bytes)])));
		track(audio, silent ? 0 : 1);
		normalize(audio, song, playedMapId, bytes);
	}
	if (smoothIn && !fadeInNext) fadeInWhenPlaying(audio);
	applyMod(audio);
	audio.addEventListener('ended', () => {
		// Ignore songs that were replaced in the meantime
		if (get(songQueue).audio === audio) handleSongEnded();
	});
	audio.addEventListener('play', () => playingChanged(audio));
	audio.addEventListener('pause', () => playingChanged(audio));
	await new Promise<void>((resolve, reject) => {
		audio.addEventListener('loadedmetadata', () => {
			if (audio.duration > currentSeconds) {
				audio.currentTime = currentSeconds;
			}
			resolve();
		});
		// A missing preview would otherwise keep waiting forever; callers skip the song
		audio.addEventListener('error', () => reject(new Error(`Could not load ${song.title}`)), {
			once: true
		});
	});
	return audio;
}

/** The current song started or stopped: shown as playing or paused, also on Discord */
function playingChanged(audio: HTMLAudioElement) {
	if (get(songQueue).audio !== audio) return;
	const playing = !audio.paused;
	if (get(currentSong).isPlaying !== playing)
		currentSong.update((cs) => ({ ...cs, isPlaying: playing }));
	setRPCActivity(playing ? get(currentSong).song : null);
}

// --- Switching songs -----------------------------------------------------------------------

// Set while the next song is loaded for a crossfade, so it starts silent
let fadeInNext = false;
// Set while the user switches songs: the old one fades out quickly, the new one fades in
let smoothIn = false;
const SWITCH_OUT_MS = 350;
const SWITCH_IN_MS = 600;
/** Songs fading out after a switch; they stop by themselves */
const releasing = new Set<HTMLAudioElement>();

/** Fades a song out quickly and stops it (instead of cutting it off) */
function release(audio: HTMLAudioElement) {
	if (releasing.has(audio)) return;
	if (audio.paused) return discard(audio);
	releasing.add(audio);
	fadeTo(audio, 0, SWITCH_OUT_MS, (t) => 1 - (1 - t) ** 2).then(() => {
		releasing.delete(audio);
		// Still the current song when the next one couldn't be loaded: only stopped
		if (get(songQueue).audio !== audio) return discard(audio);
		audio.pause();
		untrack(audio);
	});
}

/** Fades a song in once it plays */
function fadeInWhenPlaying(audio: HTMLAudioElement) {
	audio.addEventListener(
		'playing',
		() => fadeTo(audio, 1, SWITCH_IN_MS, (t) => Math.sin((t * Math.PI) / 2)),
		{ once: true }
	);
}

/** Before the user's next song loads: the playing one fades out */
function switchAway() {
	const current = get(songQueue);
	finishCrossfade();
	if (current?.audio && !current.audio.paused) {
		smoothIn = true;
		release(current.audio);
	} else current?.audio?.pause();
	currentSong.update((cs) => ({ ...cs, isPlaying: false }));
	setRPCActivity(null);
}

/**
 * Each load of a song gets a number; one that finishes after a newer one started is
 * dropped. Without this, clicking songs quickly (or during a crossfade) could leave a song
 * playing that the app no longer knows about, and so can't stop.
 */
let loadGeneration = 0;

interface LoadOptions {
	type: QueueType;
	playlistId: PlaylistId | null;
	/** Where the song starts (s) */
	currentSeconds?: number;
	/** Plays it once it's loaded (else it waits, paused) */
	play?: boolean;
	/**
	 * A song that can't be loaded: the next one in this direction is tried (skipping through
	 * the queue). Without it the user is told, and nothing changes.
	 */
	skipFailed?: 1 | -1;
}

/** Loads the song at `index` of `queue` and makes it the current song */
async function loadSong(index: number, queue: MapSet[], options: LoadOptions): Promise<void> {
	const { type, playlistId, currentSeconds = 0, play = true, skipFailed } = options;
	const generation = ++loadGeneration;
	let audio: HTMLAudioElement;
	try {
		audio = await createAudio(queue[index], type, currentSeconds).finally(() => (smoothIn = false));
	} catch (error) {
		if (generation !== loadGeneration) return;
		if (skipFailed) {
			const next = index + skipFailed;
			if (next >= 0 && next < queue.length)
				await loadSong(next, queue, { ...options, currentSeconds: 0 });
			return;
		}
		if (error instanceof OfflineError) {
			showToast(
				`"${queue[index]?.title}" isn't downloaded, and you're offline`,
				'icon-[mingcute--wifi-off-line]'
			);
			return;
		}
		console.error('Could not play', queue[index]?.title, error);
		showToast(
			`Couldn't play ${queue[index]?.title ?? 'this song'}`,
			'icon-[mingcute--warning-line]'
		);
		return;
	}
	if (generation !== loadGeneration) return discard(audio);
	songQueue.set({ currentIndex: index, audio, queue, type, playlistId });
	currentSong.set({ song: queue[index], isPlaying: false });
	updateCurrentQueue({
		index,
		queue,
		type,
		playlistId,
		currentSeconds: currentSeconds || 0.001
	});
	if (play) startPlayback(audio);
}

// --- Locks ---------------------------------------------------------------------------------

/**
 * While listening along in a session the host picks the songs: a lock set by listen.ts
 * returns why the user can't change the song (null when they can). Following the host
 * itself goes through withoutPlaybackLock.
 */
const playbackLocks = new Map<string, () => string | null>();
let lockBypass = 0;

/** Sets (or with null removes) a lock by name: listen.ts, the gameplay while playing */
export function setPlaybackLock(name: string, lock: (() => string | null) | null) {
	if (lock) playbackLocks.set(name, lock);
	else playbackLocks.delete(name);
}

export async function withoutPlaybackLock<T>(change: () => Promise<T>) {
	lockBypass++;
	try {
		return await change();
	} finally {
		lockBypass--;
	}
}

/** Whether a song change by the user is blocked (and says why) */
function locked(quiet = false) {
	if (lockBypass || !playbackLocks.size) return false;
	let reason: string | null = null;
	for (const lock of playbackLocks.values()) reason ??= lock();
	if (reason && !quiet) showToast(reason, 'icon-[mingcute--group-line]');
	return !!reason;
}

// --- Playing -------------------------------------------------------------------------------

/** Plays `queue` from the song at `index` (or loads it paused, with `playSong` false) */
export async function setSongQueue(
	index: number,
	queue: MapSet[],
	type: QueueType,
	playlistId: PlaylistId | null = null,
	playSong = true,
	currentSeconds = 0
) {
	if (locked()) return;
	if (!queue[index]) return;
	// Offline: on to the first downloaded song from there
	if (get(offline) && type !== 'preview') {
		const playable = (i: number) => localMapId(queue[i]) != null;
		if (!playable(index)) {
			const next = [...queue.keys()].map((k) => (index + k) % queue.length).find(playable);
			if (next === undefined) {
				showToast(
					"None of these songs are downloaded, and you're offline",
					'icon-[mingcute--wifi-off-line]'
				);
				return;
			}
			index = next;
			currentSeconds = 0;
		}
	}
	switchAway();
	await loadSong(index, queue, { type, playlistId, currentSeconds, play: playSong });
	const shuffle = get(userSettings).settings.shuffle || false;
	if (shuffle && currentSeconds == 0) await shuffleQueue();
}

/**
 * The queue changed (a playlist was edited, shuffled, a search loaded more songs): the new
 * one, without touching the song that plays. It stays the current song where it is in the
 * new queue; `index` is where to go on from when it isn't in there (null: where it was).
 */
export async function updateSongQueue(
	index: number | null,
	queue?: MapSet[] | null,
	type?: QueueType | null,
	playlistId: PlaylistId | null = null
) {
	const current = get(songQueue);
	const song = get(currentSong).song;
	if (!current.queue || !song) return;
	const nextQueue = queue ?? current.queue;
	const given = index ?? current.currentIndex ?? 0;
	const found = sameSong(nextQueue[given], song)
		? given
		: nextQueue.findIndex((other) => sameSong(other, song));
	const currentIndex = found >= 0 ? found : Math.min(given, Math.max(nextQueue.length - 1, 0));
	songQueue.set({
		...current,
		currentIndex,
		queue: nextQueue,
		type: type ?? current.type,
		playlistId: playlistId ?? current.playlistId
	});
	const next = get(songQueue);
	updateCurrentQueue({
		index: currentIndex,
		queue: nextQueue,
		type: next.type,
		playlistId: next.playlistId,
		currentSeconds: current.audio?.currentTime || 0.001
	});
}

/** Plays the current song (it may first need the Nightcore beat ready) */
function startPlayback(audio: HTMLAudioElement) {
	// Playback starts with a click, so the Nightcore beat may create its audio now
	if (get(userSettings).settings?.mod === 'NC') prepareBeats();
	// (not played after all: shown as paused again)
	audio.play().catch(() => playingChanged(audio));
}

export function stopPlayback() {
	const audio = get(songQueue).audio;
	if (!audio) return;
	// Stopping ends a crossfade, the song fading out with it
	finishCrossfade();
	audio.pause();
	currentSong.update((cs) => ({ ...cs, isPlaying: false }));
	setRPCActivity(null);
}

export function togglePlayback() {
	const audio = get(songQueue).audio;
	if (!audio) return;
	if (audio.paused) startPlayback(audio);
	else stopPlayback();
}

/** Whether there is a song to skip forward to */
export function hasNext(queue: SongQueue, queuedSongs: MapSet[], repeat: RepeatMode) {
	if (!queue.queue?.length) return false;
	return queuedSongs.length > 0 || queue.currentIndex < queue.queue.length - 1 || repeat === 'all';
}

/** Loads and plays the song at `index` of `queue`, skipping songs that can't be loaded */
async function playAt(index: number, queue: MapSet[], direction: 1 | -1 = 1) {
	// A crossfade fades the old song itself
	if (!fadeInNext) switchAway();
	const { type, playlistId } = get(songQueue);
	await loadSong(index, queue, {
		type: type ?? 'playlist',
		playlistId: playlistId ?? null,
		skipFailed: direction
	});
	if (type === 'radio') topUpRadio();
}

let isSkipping = false;

/** Runs one skip at a time (quick clicks don't skip twice at once) */
async function skipping(skip: () => Promise<void>) {
	if (locked() || isSkipping) return;
	isSkipping = true;
	try {
		await skip();
	} finally {
		isSkipping = false;
	}
}

export function skipForward() {
	return skipping(async () => {
		const current = get(songQueue);
		if (!current.queue?.length) return;
		const [queuedSong, ...rest] = get(upNext);
		if (queuedSong) {
			// Play the queued song right after the current one, so "back" still works
			upNext.set(rest);
			const queue = [...current.queue];
			queue.splice(current.currentIndex + 1, 0, { ...queuedSong, queued: true });
			await playAt(current.currentIndex + 1, queue);
			return;
		}
		let next = current.currentIndex + 1;
		if (next >= current.queue.length) {
			if (repeatMode() !== 'all') return;
			next = 0;
		}
		await playAt(next, radioAfterSkip(current) ?? current.queue);
	});
}

export function skipBackward() {
	return skipping(async () => {
		const current = get(songQueue);
		if (!current.audio) return;
		if (current.audio.currentTime > 2 || !current.currentIndex) {
			current.audio.currentTime = 0;
			return;
		}
		await playAt(current.currentIndex - 1, current.queue, -1);
	});
}

/** Plays the song at `index` of the current queue (used by the queue panel) */
export async function jumpTo(index: number) {
	if (locked()) return;
	const current = get(songQueue);
	if (!current.queue?.[index]) return;
	await playAt(index, current.queue);
}

async function handleSongEnded() {
	const current = get(songQueue);
	// Listening along: the host's next song comes from the session, not this queue
	if (locked(true)) return;
	if (get(sleepTimer).endOfSong) {
		// Sleep timer "end of song": stop here, rewound for the next play
		sleepTimer.set({ until: null, endOfSong: false });
		stopPlayback();
		current.audio.currentTime = 0;
		return;
	}
	if (repeatMode() === 'one') {
		current.audio.currentTime = 0;
		startPlayback(current.audio);
		return;
	}
	if (hasNext(current, get(upNext), repeatMode())) {
		await skipForward();
	} else if (!(await autoplay(current))) {
		// End of the queue: stop and rewind, so pressing play starts the song again
		stopPlayback();
		current.audio.currentTime = 0;
	}
}

export function cycleRepeatMode() {
	const order: RepeatMode[] = ['off', 'all', 'one'];
	const next = order[(order.indexOf(repeatMode()) + 1) % order.length];
	userSettings.update((u) => ({ ...u, settings: { ...u.settings, repeat: next } }));
}

// --- The queue -----------------------------------------------------------------------------

/** Adds a song to the queue; `next` puts it in front of the other queued songs */
export async function queueSong(song: MapSet, next = false) {
	const current = get(songQueue);
	if (!current.queue?.length) {
		// Nothing is playing yet: just play the song
		await setSongQueue(0, [{ ...song, queued: true }], 'playlist');
		return;
	}
	upNext.update((songs) => (next ? [song, ...songs] : [...songs, song]));
}

export function removeQueuedSong(index: number) {
	upNext.update((songs) => songs.filter((_, i) => i !== index));
}

export function clearQueuedSongs() {
	upNext.set([]);
}

/** The songs in a random order (every order as likely) */
function shuffled<T>(items: T[]) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

/** Shuffles a playlist's queue, or puts it back in the playlist's order (as the setting is) */
export async function shuffleQueue() {
	const current = get(songQueue);
	if (!current?.queue?.length || current.type != 'playlist') return;
	const song = current.queue[current.currentIndex];
	if (get(userSettings).settings.shuffle) {
		// The song that plays first, the rest after it
		const rest = current.queue.filter((_, i) => i !== current.currentIndex);
		await updateSongQueue(0, [song, ...shuffled(rest)], current.type, current.playlistId);
	} else {
		const songs = get(playlistSongsCache)[current.playlistId]?.songs || [];
		// Not a playlist of the library (a mix, a friend's song): the order stays as it is
		if (!songs.length) return;
		// A queued song that isn't part of the playlist keeps playing; continue from the start
		await updateSongQueue(0, songs, 'playlist', current.playlistId);
	}
}

/** Selects a speed mod; it applies right away and to every following song */
export function setPlaybackMod(mod: PlaybackMod) {
	updateUserSettings({ mod });
	if (mod === 'NC') prepareBeats();
	for (const audio of [get(songQueue).audio, fadingOut]) if (audio) applyMod(audio, mod);
}

// --- Crossfade --------------------------------------------------------------------------

let fadingOut: HTMLAudioElement | null = null;
/** Counts the crossfades: one that's ended early doesn't stop the song after it */
let crossfadeId = 0;

function finishCrossfade() {
	crossfadeId++;
	if (fadingOut) {
		// Still the current song if the crossfade's next song couldn't be loaded
		if (get(songQueue).audio === fadingOut) fadingOut.pause();
		else discard(fadingOut);
		fadingOut = null;
	}
}

/** Starts the next song while this one fades out, with equal-power curves */
async function startCrossfade(audio: HTMLAudioElement, seconds: number) {
	fadingOut = audio;
	fadeInNext = true;
	try {
		await skipForward();
	} finally {
		fadeInNext = false;
	}
	const next = get(songQueue).audio;
	if (next === audio) {
		// The next song couldn't be loaded: let this one end normally
		fadingOut = null;
		return;
	}
	const id = ++crossfadeId;
	const ms = seconds * 1000;
	// On the audio thread (smooth even while the next song's gameplay loads)
	fadeTo(audio, 0, ms, (t) => 1 - Math.cos((t * Math.PI) / 2));
	if (next) fadeTo(next, 1, ms, (t) => Math.sin((t * Math.PI) / 2));
	setTimeout(() => {
		if (id === crossfadeId) finishCrossfade();
	}, ms + 30);
}

if (typeof window !== 'undefined') {
	setInterval(() => {
		const current = get(songQueue);
		const audio = current.audio;
		const seconds = crossfadeSeconds();
		if (!seconds || !audio || audio.paused || fadingOut || isSkipping) return;
		if (locked(true)) return;
		// The sleep timer stops at the end of this song: no next song to fade into
		if (get(sleepTimer).endOfSong) return;
		// Previews are only short clips; downloaded and streamed songs play in full, also in
		// the search
		const song = current.queue?.[current.currentIndex];
		if (current.type === 'preview' && (!song || (localMapId(song) == null && !isStreamed(song))))
			return;
		// Still streaming in: its length isn't known yet
		if (!Number.isFinite(audio.duration) || audio.dataset.loading) return;
		if (repeatMode() === 'one' || !hasNext(current, get(upNext), repeatMode())) return;
		// Remaining time in real seconds, so speed mods are taken into account
		const length = audio.duration / audio.playbackRate;
		const remaining = (audio.duration - audio.currentTime) / audio.playbackRate;
		const fade = Math.min(seconds, length / 2);
		if (remaining <= fade) startCrossfade(audio, fade);
	}, 100);

	// Only the current song (and the one fading out of a crossfade) may play: anything else
	// the app once played is stopped as soon as another song takes over
	const known = new Set<HTMLAudioElement>();
	songQueue.subscribe(({ audio }) => {
		if (audio) known.add(audio);
		for (const other of known) {
			if (other === audio || other === fadingOut) continue;
			release(other);
			known.delete(other);
		}
	});

	// The songs about to play, streamed ahead (the ones queued by hand first), so they start
	// right away and crossfade in time
	songQueue.subscribe(({ queue, currentIndex }) => {
		if (!queue || currentIndex == null) return;
		prefetchStreams(
			[...get(upNext), ...queue.slice(currentIndex + 1)].slice(0, 1),
			(song) => localMapId(song) != null
		);
	});

	// The equalizer: songs go through it once it's on (and stay, flat it changes nothing)
	let eqKey = '';
	// Every song plays through the audio graph (its fades run on the audio thread there; with
	// the equalizer off the graph changes nothing)
	const routeSong = () => {
		attach(get(songQueue).audio).then((source) => source && refresh());
	};
	// After the modules are loaded (user.ts and this one import each other)
	setTimeout(() => {
		songQueue.subscribe(routeSong);
		userSettings.subscribe(({ settings }) => {
			const key = JSON.stringify(settings?.equalizer ?? null);
			if (key === eqKey) return;
			eqKey = key;
			applyEq();
			routeSong();
		});
	});

	startBeats(() => ({
		audio: get(songQueue).audio ?? null,
		setId: get(currentSong).song?.id?.toString() ?? null,
		mapId: get(currentSong).song?.beatmaps?.[0]?.id?.toString() ?? null
	}));
}

// --- Sleep timer ------------------------------------------------------------------------

/** Stops playback at `until` (a timestamp) or at the end of the current song */
export const sleepTimer = writable<{ until: number | null; endOfSong: boolean }>({
	until: null,
	endOfSong: false
});

const SLEEP_FADE_SECONDS = 8;

/** Minutes from now, 'song' for the end of the current song, or null to turn it off */
export function setSleepTimer(choice: number | 'song' | null) {
	sleepTimer.set({
		until: typeof choice === 'number' ? Date.now() + choice * 60_000 : null,
		endOfSong: choice === 'song'
	});
}

if (typeof window !== 'undefined') {
	let fading = false;
	setInterval(() => {
		const { until } = get(sleepTimer);
		const audio = get(songQueue).audio;
		if (!until || fading || Date.now() < until) return;
		sleepTimer.set({ until: null, endOfSong: false });
		if (!audio || audio.paused) return;
		// Fade out instead of cutting the song off; follows the song if the next one starts
		fading = true;
		const faded = new Set<HTMLAudioElement>();
		const start = performance.now();
		const timer = setInterval(() => {
			const progress = Math.min(1, (performance.now() - start) / (SLEEP_FADE_SECONDS * 1000));
			const current = get(songQueue).audio;
			if (current) {
				faded.add(current);
				setFade(current, 1 - progress);
			}
			if (progress < 1 && current && !current.paused) return;
			clearInterval(timer);
			stopPlayback();
			faded.forEach((element) => setFade(element, 1));
			fading = false;
		}, 100);
	}, 1000);
}

// --- Radio ------------------------------------------------------------------------------

/** Skipped this early, the radio plays fewer songs like it (s) */
const RADIO_SKIP_SECONDS = 30;

/** Plays a song followed by similar songs from the library */
export async function startRadio(song: MapSet) {
	const seed = librarySong(song) ?? song;
	await setSongQueue(0, [seed, ...radioSongs([seed])], 'radio');
}

/** The songs a radio goes on from: its first song, and the last ones up to the current one */
function radioSeeds(queue: MapSet[], index: number) {
	const recent = queue.slice(Math.max(1, index - 2), index + 1).reverse();
	return [queue[0], ...recent].filter(Boolean);
}

/** Near the end of a radio: more songs like it, after the others (so "back" still works) */
function topUpRadio() {
	const { queue, currentIndex, type } = get(songQueue);
	if (type !== 'radio' || !queue?.length || currentIndex == null) return;
	if (queue.length - currentIndex - 1 >= RADIO_TOP_UP) return;
	const more = radioSongs(radioSeeds(queue, currentIndex), queue);
	if (more.length) songQueue.update((q) => ({ ...q, queue: [...(q.queue ?? []), ...more] }));
}

/** A radio song skipped right away: the queue with the songs like it moved to the end */
function radioAfterSkip(current: SongQueue) {
	const { queue, currentIndex, audio, type } = current;
	if (type !== 'radio' || !queue || currentIndex == null || !audio) return null;
	if (audio.currentTime >= RADIO_SKIP_SECONDS) return null;
	const upcoming = afterSkip(queue.slice(currentIndex + 1), queue[currentIndex]);
	return [...queue.slice(0, currentIndex + 1), ...upcoming];
}

/** At the end of a queue: keep playing songs like the last ones, unless turned off */
async function autoplay(current: SongQueue) {
	const queue = current.queue ?? [];
	const last = queue[current.currentIndex];
	if (get(userSettings).settings?.autoplay === false || !last || !librarySong(last)) return false;
	// Like the last few songs, the last one most; nothing that was just played
	const recent = queue.slice(Math.max(0, current.currentIndex - 2), current.currentIndex + 1);
	const next = radioSongs([last, ...recent.reverse().slice(1)], queue);
	if (!next.length) return false;
	await setSongQueue(0, next, 'radio');
	showToast(`Autoplay: songs like "${last.title}"`, 'icon-[mingcute--radio-line]');
	return true;
}
