import { get, writable } from 'svelte/store';
import { downloadBeatmap, mapDataStore, saveMapData } from './data';
import { updateCurrentQueue, updateUserSettings, userSettings } from './user';
import { applyMod, prepareBeats, startBeats } from './mods';
import { track, untrack, setFade, setGain, rampGain } from './mixer';
import { measureLoudness, gainFor } from './loudness';
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
function normalize(audio: HTMLAudioElement, song: MapSet, file: Uint8Array) {
	const setId = String(song.id);
	const stored = get(mapDataStore)[setId];
	if (!stored) return;
	if (stored.loudness != null) {
		setGain(audio, gainFor(stored.loudness));
		return;
	}
	measurements = measurements.then(async () => {
		const loudness = await measureLoudness(file);
		if (loudness == null) return;
		mapDataStore.update((data) =>
			data[setId] ? { ...data, [setId]: { ...data[setId], loudness } } : data
		);
		await saveMapData();
		rampGain(audio, gainFor(loudness));
	});
}

// Set while the next song is loaded for a crossfade, so it starts silent
let fadeInNext = false;

async function getAudio(index: number, queue: MapSet[], type: QueueType, currentSeconds = 0) {
	let audio: HTMLAudioElement = null;
	const song = queue[index];
	if (type == 'preview' && !song.queued) {
		audio = new Audio(`${song.preview_url}`);
		track(audio, fadeInNext ? 0 : 1);
	} else {
		const file = bytesFromBase64(await downloadBeatmap(song, song.beatmaps[0].id));
		audio = new Audio(URL.createObjectURL(new Blob([file])));
		track(audio, fadeInNext ? 0 : 1);
		normalize(audio, song, file);
	}
	applyMod(audio);
	audio.addEventListener('ended', () => {
		// Ignore songs that were replaced in the meantime
		if (get(songQueue).audio === audio) handleSongEnded();
	});
	await new Promise<void>((resolve) => {
		audio.addEventListener('loadedmetadata', () => {
			if (audio.duration > currentSeconds) {
				audio.currentTime = currentSeconds;
			}
			resolve();
		});
	});
	return audio;
}

export async function setSongQueue(
	index: number,
	queue: MapSet[],
	type: QueueType,
	playlistId: PlaylistId | null = null,
	playSong = true,
	currentSeconds = 0
) {
	stopPlayback();
	let audio: HTMLAudioElement;
	if (index !== null) audio = await getAudio(index, queue, type, currentSeconds);
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
		try {
			audio = await getAudio(targetIndex, targetQueue, type || current.type);
		} catch {
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
		// The song fading out of a crossfade keeps playing until the fade is done
		if (current.audio !== fadingOut) {
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
	const current = get(songQueue);
	stopPlayback(true);
	let audio: HTMLAudioElement;
	try {
		audio = await getAudio(index, queue, current.type);
	} catch {
		const next = index + direction;
		if (next >= 0 && next < queue.length) await playAt(next, queue, direction);
		return;
	}
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
	const current = get(songQueue);
	if (!current.queue?.[index]) return;
	await playAt(index, current.queue);
}

async function handleSongEnded() {
	const current = get(songQueue);
	if (repeatMode() === 'one') {
		current.audio.currentTime = 0;
		current.audio.play();
		return;
	}
	if (hasNext(current, get(upNext), repeatMode())) {
		await skipForward();
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
		const currentSongShuffledIndex = shuffledQueue.findIndex(
			(song) => song.id === currentSongData.id
		);
		if (currentSongShuffledIndex > 0) {
			shuffledQueue.splice(currentSongShuffledIndex, 1);
			shuffledQueue.unshift(currentSongData);
		}

		await updateSongQueue(0, shuffledQueue, current.type, current.playlistId);
	} else {
		const songs = get(playlistSongsCache)[current.playlistId]?.songs || [];
		const currentSongData = current.queue[current.currentIndex];
		const currentIndex = songs.findIndex((song) => song.id === currentSongData.id);
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
		if (current.type === 'preview' || !Number.isFinite(audio.duration)) return;
		if (repeatMode() === 'one' || !hasNext(current, get(upNext), repeatMode())) return;
		// Remaining time in real seconds, so speed mods are taken into account
		const length = audio.duration / audio.playbackRate;
		const remaining = (audio.duration - audio.currentTime) / audio.playbackRate;
		const fade = Math.min(seconds, length / 2);
		if (remaining <= fade) startCrossfade(audio, fade);
	}, 100);

	startBeats(() => ({
		audio: get(songQueue).audio ?? null,
		setId: get(currentSong).song?.id?.toString() ?? null
	}));
}
