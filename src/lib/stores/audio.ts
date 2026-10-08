import { get, writable } from 'svelte/store';
import { downloadBeatmap } from './data';
import { updateCurrentQueue, userSettings } from './user';
import { setRPCActivity } from './discord';
import { playlistSongsCache } from './playlist';
import type { CurrentSong, MapSet, PlaylistId, QueueType, SongQueue } from '../types';

export const songQueue = writable<SongQueue>({});
export const currentSong = writable<CurrentSong>({ song: null, isPlaying: false });

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
	if (type == 'preview') {
		const previewUrl = `${queue[index].preview_url}`;
		audio = new Audio(previewUrl);
		audio.volume = get(userSettings).settings.volume || 0.05;
	} else if (type == 'playlist') {
		const base64Data = await downloadBeatmap(queue[index], queue[index].beatmaps[0].id);
		audio = getAudioFromBase64(base64Data);
	}
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
let isSkipping = false;

export async function skipForward() {
	if (isSkipping) return; // Prevent concurrent skips
	isSkipping = true;

	try {
		const queue = get(songQueue);
		stopPlayback(true);
		await updateSongQueue(queue.currentIndex + 1);
		togglePlayback();
	} finally {
		isSkipping = false;
	}
}

export async function skipBackward() {
	if (isSkipping) return; // Prevent concurrent skips
	isSkipping = true;

	try {
		const queue = get(songQueue);

		if (queue.audio.currentTime > 2) {
			queue.audio.currentTime = 0;
			return;
		}
		if (queue.currentIndex === 0) return;
		stopPlayback(true);

		await updateSongQueue(queue.currentIndex - 1);
		togglePlayback();
	} finally {
		isSkipping = false;
	}
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
		await updateSongQueue(currentIndex || 0, songs, 'playlist', current.playlistId);
	}
}
