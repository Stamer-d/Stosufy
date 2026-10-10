import { get, writable } from 'svelte/store';
import { downloadBeatmap } from './data';
import { updateCurrentQueue, userSettings } from './user';
import { setRPCActivity } from './discord';
import { playlistSongsCache } from './playlist';
import type { CurrentSong, MapSet, PlaylistId, QueueType, RepeatMode, SongQueue } from '../types';

export const songQueue = writable<SongQueue>({});
export const currentSong = writable<CurrentSong>({ song: null, isPlaying: false });
/** Songs the user queued with "Play next" / "Add to queue"; they play before the rest of the queue */
export const upNext = writable<MapSet[]>([]);
export const queuePanelOpen = writable(false);

const repeatMode = (): RepeatMode => get(userSettings).settings.repeat ?? 'off';

function getAudioFromBase64(base64Data: string) {
	const byteCharacters = atob(base64Data);
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	const blob = new Blob([new Uint8Array(byteNumbers)]);
	const audio = new Audio(URL.createObjectURL(blob));
	audio.volume = get(userSettings).settings.volume || 0.05;
	return audio;
}

async function getAudio(index: number, queue: MapSet[], type: QueueType, currentSeconds = 0) {
	let audio: HTMLAudioElement = null;
	const song = queue[index];
	if (type == 'preview' && !song.queued) {
		audio = new Audio(`${song.preview_url}`);
		audio.volume = get(userSettings).settings.volume || 0.05;
	} else {
		const base64Data = await downloadBeatmap(song, song.beatmaps[0].id);
		audio = getAudioFromBase64(base64Data);
	}
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
		current.audio.pause();
		setRPCActivity(null);
		if (!onlyPause) currentSong.update((cs) => ({ ...cs, isPlaying: false }));
		return current;
	});
}

export function togglePlayback() {
	songQueue.update((current) => {
		if (!current || !current.audio) return current;
		if (current.audio.paused) {
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
