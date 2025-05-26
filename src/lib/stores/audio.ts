// @ts-nocheck
import { get, writable } from 'svelte/store';
import { downloadBeatmap, settings } from './data';
import { setRPCActivity } from './discord';
export let songQueue = writable([]);
export let currentSong = writable({ song: null, isPlaying: false });
export const settings = writable(
	JSON.parse(localStorage.getItem('appSettings')) || {
		volume: 0.05
	}
);

export function getAudioBlob64(base64Data) {
	const byteCharacters = atob(base64Data);
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	const byteArray = new Uint8Array(byteNumbers);
	const blob = new Blob([byteArray]);
	const audioUrl = URL.createObjectURL(blob);
	const audio = new Audio(audioUrl);
	let appSettings = get(settings);
	audio.volume = appSettings.volume;
	return audio;
}

async function getAudioBlob(index, queue, type) {
	let blob;
	let audio = null;
	if (type == 'preview') {
		const previewUrl = `https:${queue[index].preview_url}`;
		audio = new Audio(previewUrl);
		audio.volume = get(settings).volume || 0.05;
	} else if (type == 'playlist') {
		const base64Data = await downloadBeatmap(queue[index], queue[index].beatmaps[0].id);
		audio = getAudioBlob64(base64Data);
	}
	return audio;
}

export async function setSongQueue(index, queue, type, playlistId = null) {
	stopPlayback();

	let audio;
	if (index !== null) audio = await getAudioBlob(index, queue, type);
	songQueue.set({
		currentIndex: index,
		audio: audio,
		queue: queue,
		type: type,
		playlistId: playlistId
	});
	currentSong.set({ song: queue[index], isPlaying: false });
	togglePlayback();
}

export async function updateSongQueue(index, queue, type, playlistId = null) {
	if (!get(songQueue).queue || !get(currentSong).song) return;
	const current = get(songQueue);

	let audio;
	if (
		index != undefined &&
		queue != undefined &&
		type == 'playlist' &&
		playlistId == get(songQueue).playlistId
	) {
		console.log('Updating song queue');
	} else if (index !== null) {
		try {
			audio = await getAudioBlob(index, queue || current.queue, type || current.type);
		} catch (e) {
			let newIndex;
			if (get(songQueue).currentIndex < index) {
				if (index < get(songQueue).queue.length - 1) {
					newIndex = index + 1;
				} else {
					newIndex = 0;
				}
			} else {
				newIndex = Math.max(1, index - 1);
			}
			await updateSongQueue(newIndex, queue, type, playlistId);
			return;
		}

		currentSong.set({
			song: queue ? queue[index] : current.queue[index],
			isPlaying: current.isPlaying
		});
	}

	songQueue.set({
		currentIndex: index != undefined ? index : current.currentIndex,
		audio: audio || current.audio,
		queue: queue || current.queue,
		type: type || current.type,
		playlistId: playlistId || current.playlistId
	});
}

export function stopPlayback() {
	songQueue.update((current) => {
		if (!current || !current.audio) return current;
		current.audio.pause();
		setRPCActivity(null);
		currentSong.update((cs) => ({ ...cs, isPlaying: false }));
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

export async function skipForward() {
	const queue = get(songQueue);
	stopPlayback();
	await updateSongQueue(queue.currentIndex + 1);
	togglePlayback();
}

export async function skipBackward() {
	const queue = get(songQueue);
	if (queue.currentIndex === 0) return;
	stopPlayback();

	await updateSongQueue(queue.currentIndex - 1);
	togglePlayback();
}
