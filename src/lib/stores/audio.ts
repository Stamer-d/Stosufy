import { get, writable } from 'svelte/store';
import { downloadBeatmap, mapDataStore, saveMapData } from './data';
import { updateCurrentQueue, updateUserSettings, userSettings } from './user';
import { applyMod, prepareBeats, startBeats } from './mods';
import { track, untrack, setFade, setGain, rampGain } from './mixer';
import { measureLoudness, gainFor } from './loudness';
import { sameSong } from '../tracks';
import { offline } from './network';
import { attach, applyEq, eqSettings } from './equalizer';
import { showToast } from './toast';
import { librarySong, similarSongs } from './radio';
import { setRPCActivity } from './discord';
import { playlistSongsCache } from './playlist';
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

if (typeof window !== 'undefined') {
	setInterval(() => {
		const audio = get(songQueue).audio;
		const current = audio?.currentTime ?? 0;
		const duration = audio?.duration || 0;
		const previous = get(playbackTime);
		if (previous.current !== current || previous.duration !== duration) {
			playbackTime.set({ current, duration });
		}
	}, 500);
}

const repeatMode = (): RepeatMode => get(userSettings).settings.repeat ?? 'off';
const crossfadeSeconds = () => get(userSettings).settings?.crossfade ?? 0;

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
	if (!stored || !audioFile) return;
	// Measured per audio file: sets can contain several songs
	const known = Object.values(stored.beatmaps).find(
		(map) => map.audioFile === audioFile && map.loudness != null
	)?.loudness;
	if (known != null) {
		setGain(audio, gainFor(known));
		return;
	}
	measurements = measurements.then(async () => {
		const loudness = await measureLoudness(file);
		if (loudness == null) return;
		mapDataStore.update((data) => {
			const set = data[setId];
			if (!set) return data;
			const beatmaps = Object.fromEntries(
				Object.entries(set.beatmaps).map(([id, map]) => [
					id,
					map.audioFile === audioFile ? { ...map, loudness } : map
				])
			);
			return { ...data, [setId]: { ...set, beatmaps } };
		});
		await saveMapData();
		rampGain(audio, gainFor(loudness));
	});
}

/** A song that isn't downloaded can't play without a connection */
class OfflineError extends Error {
	constructor(song: MapSet) {
		super(`${song.title} isn't downloaded`);
	}
}

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
	if (audio.paused) {
		audio.pause();
		untrack(audio);
		return;
	}
	releasing.add(audio);
	const from = audio.volume;
	const start = performance.now();
	const timer = setInterval(() => {
		const progress = Math.min(1, (performance.now() - start) / SWITCH_OUT_MS);
		// Straight on the element's volume: the levels may be changed for it no more
		audio.volume = from * (1 - progress) ** 2;
		if (progress < 1) return;
		clearInterval(timer);
		audio.pause();
		untrack(audio);
		releasing.delete(audio);
	}, 30);
}

/** Fades a song in once it plays */
function fadeInWhenPlaying(audio: HTMLAudioElement) {
	audio.addEventListener(
		'playing',
		() => {
			const start = performance.now();
			const timer = setInterval(() => {
				const progress = Math.min(1, (performance.now() - start) / SWITCH_IN_MS);
				setFade(audio, Math.sin((progress * Math.PI) / 2));
				if (progress === 1) clearInterval(timer);
			}, 30);
		},
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
	setRPCActivity(null);
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
 * Each load of a song gets a number; one that finishes after a newer one started is
 * dropped. Without this, clicking songs quickly (or during a crossfade) could leave a song
 * playing that the app no longer knows about, and so can't stop.
 */
let loadGeneration = 0;

/** Throws away a song's audio that won't be played */
function discard(audio: HTMLAudioElement | null | undefined) {
	if (!audio) return;
	audio.pause();
	untrack(audio);
	if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
}

async function getAudio(index: number, queue: MapSet[], type: QueueType, currentSeconds = 0) {
	let audio: HTMLAudioElement = null;
	const song = queue[index];
	const mapId = localMapId(song);
	if (type == 'preview' && !song.queued && mapId == null) {
		audio = new Audio(`${song.preview_url}`);
		track(audio, fadeInNext || smoothIn ? 0 : 1);
	} else {
		// Offline only downloaded songs can play
		if (mapId == null && get(offline)) throw new OfflineError(song);
		const playedMapId = mapId ?? song.beatmaps[0].id;
		const file = bytesFromBase64(await downloadBeatmap(song, playedMapId));
		audio = new Audio(URL.createObjectURL(new Blob([file])));
		track(audio, fadeInNext || smoothIn ? 0 : 1);
		normalize(audio, song, playedMapId, file);
	}
	if (smoothIn && !fadeInNext) fadeInWhenPlaying(audio);
	applyMod(audio);
	audio.addEventListener('ended', () => {
		// Ignore songs that were replaced in the meantime
		if (get(songQueue).audio === audio) handleSongEnded();
	});
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

export async function setSongQueue(
	index: number,
	queue: MapSet[],
	type: QueueType,
	playlistId: PlaylistId | null = null,
	playSong = true,
	currentSeconds = 0
) {
	if (locked()) return;
	// Offline: on to the first downloaded song from there
	if (get(offline) && index !== null && queue[index] && type !== 'preview') {
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
	currentSong.update((cs) => ({ ...cs, isPlaying: false }));
	const generation = ++loadGeneration;
	let audio: HTMLAudioElement;
	if (index !== null) {
		try {
			audio = await getAudio(index, queue, type, currentSeconds).finally(() => (smoothIn = false));
			if (generation !== loadGeneration) return discard(audio);
		} catch (error) {
			if (generation !== loadGeneration) return;
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
	}
	songQueue.set({
		currentIndex: index,
		audio: audio,
		queue: queue,
		type: type,
		playlistId: playlistId
	});
	currentSong.set({ song: queue[index], isPlaying: false });
	updateCurrentQueue({ index, queue, type, playlistId, currentSeconds: currentSeconds });
	if (playSong) togglePlayback();
	const shuffle = get(userSettings).settings.shuffle || false;
	if (shuffle && currentSeconds == 0) await shuffleQueue();
}

export async function updateSongQueue(
	index: number | null,
	queue?: MapSet[] | null,
	type?: QueueType | null,
	playlistId: PlaylistId | null = null
) {
	if (!get(songQueue).queue || !get(currentSong).song) return;
	const current = get(songQueue);
	let audio: HTMLAudioElement;

	const targetQueue = queue || current.queue;
	const targetIndex = index;

	if (
		index != undefined &&
		queue != undefined &&
		type == 'playlist' &&
		playlistId == get(songQueue).playlistId
	) {
		console.log('Updating song queue');
	} else if (index !== null && targetIndex < targetQueue.length) {
		const generation = ++loadGeneration;
		try {
			audio = await getAudio(targetIndex, targetQueue, type || current.type);
			if (generation !== loadGeneration) return discard(audio);
		} catch {
			if (generation !== loadGeneration) return;
			let newIndex;
			if (get(songQueue).currentIndex < index) {
				if (index < targetQueue.length - 1) {
					newIndex = index + 1;
				} else {
					newIndex = 0;
				}
			} else {
				newIndex = Math.max(0, index - 1);
			}
			await updateSongQueue(newIndex, queue, type, playlistId);
			return;
		}

		currentSong.set({
			song: targetQueue[targetIndex],
			isPlaying: false
		});
	}

	songQueue.set({
		currentIndex: targetIndex != undefined ? targetIndex : current.currentIndex,
		audio: audio || current.audio,
		queue: targetQueue,
		type: type || current.type,
		playlistId: playlistId || current.playlistId
	});

	const newQueue = get(songQueue);
	updateCurrentQueue({
		index: newQueue.currentIndex || 0,
		queue: newQueue.queue,
		type: newQueue.type,
		playlistId: newQueue.playlistId,
		currentSeconds: 0.001
	});
}

export function stopPlayback(onlyPause = false) {
	songQueue.update((current) => {
		if (!current || !current.audio) return current;
		// The song fading out of a crossfade keeps playing until the fade is done; stopping
		// (or starting another song) ends the crossfade
		if (current.audio !== fadingOut || !onlyPause) {
			finishCrossfade();
			current.audio.pause();
		}
		setRPCActivity(null);
		if (!onlyPause) currentSong.update((cs) => ({ ...cs, isPlaying: false }));
		return current;
	});
}

export function togglePlayback() {
	songQueue.update((current) => {
		if (!current || !current.audio) return current;
		if (current.audio.paused) {
			// Playback starts with a click, so the Nightcore beat may create its audio now
			if (get(userSettings).settings?.mod === 'NC') prepareBeats();
			current.audio.play().then(() => {
				currentSong.update((cs) => ({ ...cs, isPlaying: true }));
			});
			setRPCActivity(get(currentSong).song);

			return current;
		} else {
			stopPlayback();

			return current;
		}
	});
}
/** Loads and plays the song at `index` of `queue`, skipping songs that can't be loaded */
async function playAt(index: number, queue: MapSet[], direction: 1 | -1 = 1) {
	// A crossfade fades the old song itself
	if (fadeInNext) stopPlayback(true);
	else switchAway();
	const generation = ++loadGeneration;
	let audio: HTMLAudioElement;
	try {
		audio = await getAudio(index, queue, get(songQueue).type).finally(() => (smoothIn = false));
		if (generation !== loadGeneration) return discard(audio);
	} catch {
		if (generation !== loadGeneration) return;
		const next = index + direction;
		if (next >= 0 && next < queue.length) await playAt(next, queue, direction);
		return;
	}
	// The queue as it is now (it may have changed while the song loaded)
	const current = get(songQueue);
	songQueue.set({ ...current, currentIndex: index, audio, queue });
	currentSong.set({ song: queue[index], isPlaying: false });
	updateCurrentQueue({
		index,
		queue,
		type: current.type,
		playlistId: current.playlistId,
		currentSeconds: 0.001
	});
	togglePlayback();
}

/** Whether there is a song to skip forward to */
export function hasNext(queue: SongQueue, queuedSongs: MapSet[], repeat: RepeatMode) {
	if (!queue.queue?.length) return false;
	return queuedSongs.length > 0 || queue.currentIndex < queue.queue.length - 1 || repeat === 'all';
}

let isSkipping = false;

export async function skipForward() {
	if (locked()) return;
	if (isSkipping) return; // Prevent concurrent skips
	isSkipping = true;

	try {
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
		await playAt(next, current.queue);
	} finally {
		isSkipping = false;
	}
}

export async function skipBackward() {
	if (locked()) return;
	if (isSkipping) return; // Prevent concurrent skips
	isSkipping = true;

	try {
		const current = get(songQueue);

		if (current.audio.currentTime > 2 || current.currentIndex === 0) {
			current.audio.currentTime = 0;
			return;
		}
		await playAt(current.currentIndex - 1, current.queue, -1);
	} finally {
		isSkipping = false;
	}
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
		current.audio.play();
		return;
	}
	if (hasNext(current, get(upNext), repeatMode())) {
		await skipForward();
	} else if (await autoplay(current)) {
		// Autoplay continues with similar songs
	} else {
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

export async function shuffleQueue() {
	const current = get(songQueue);
	const shuffle = get(userSettings).settings.shuffle;
	if (!current || !current.queue || current.queue.length === 0 || current.type != 'playlist')
		return;

	if (shuffle) {
		const currentSongData = current.queue[current.currentIndex];
		const shuffledQueue = [...current.queue].sort(() => Math.random() - 0.5);
		const currentSongShuffledIndex = shuffledQueue.findIndex((song) =>
			sameSong(song, currentSongData)
		);
		if (currentSongShuffledIndex > 0) {
			shuffledQueue.splice(currentSongShuffledIndex, 1);
			shuffledQueue.unshift(currentSongData);
		}

		await updateSongQueue(0, shuffledQueue, current.type, current.playlistId);
	} else {
		const songs = get(playlistSongsCache)[current.playlistId]?.songs || [];
		const currentSongData = current.queue[current.currentIndex];
		const currentIndex = songs.findIndex((song) => sameSong(song, currentSongData));
		// A queued song that isn't part of the playlist keeps playing; continue from the start
		await updateSongQueue(Math.max(currentIndex, 0), songs, 'playlist', current.playlistId);
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
let fadeTimer: ReturnType<typeof setInterval> | null = null;

function finishCrossfade() {
	if (fadeTimer) clearInterval(fadeTimer);
	fadeTimer = null;
	if (fadingOut) {
		fadingOut.pause();
		untrack(fadingOut);
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
	const start = performance.now();
	fadeTimer = setInterval(() => {
		const progress = Math.min(1, (performance.now() - start) / (seconds * 1000));
		setFade(audio, Math.cos((progress * Math.PI) / 2));
		setFade(next, Math.sin((progress * Math.PI) / 2));
		if (progress === 1) finishCrossfade();
	}, 50);
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
		// Previews are only short clips; downloaded songs play in full, also in the search
		const song = current.queue?.[current.currentIndex];
		if (current.type === 'preview' && (!song || localMapId(song) == null)) return;
		if (!Number.isFinite(audio.duration)) return;
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

	// The equalizer: songs go through it once it's on (and stay, flat it changes nothing)
	let eqKey = '';
	const routeSong = () => {
		if (eqSettings().on) attach(get(songQueue).audio);
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

/** Plays a song followed by similar songs from the library */
export async function startRadio(song: MapSet) {
	const seed = librarySong(song) ?? song;
	await setSongQueue(0, [seed, ...similarSongs(seed)], 'radio');
}

/** At the end of a queue: keep playing songs similar to the last one, unless turned off */
async function autoplay(current: SongQueue) {
	const last = current.queue?.[current.currentIndex];
	if (get(userSettings).settings?.autoplay === false || !last || !librarySong(last)) return false;
	// Don't repeat what was just played
	const next = similarSongs(last, current.queue ?? []);
	if (!next.length) return false;
	await setSongQueue(0, next, 'radio');
	showToast(`Autoplay: songs like "${last.title}"`, 'icon-[mingcute--radio-line]');
	return true;
}
