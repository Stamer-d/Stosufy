// The web app's player: one plain <audio> element (no Web Audio: iOS keeps that playing in
// the background and on the lock screen, where its controls come from the Media Session).
// The songs stream from the beatmap mirror, like the desktop app's streaming, or play from
// the phone if they were downloaded.

import { get, writable } from 'svelte/store';
import type { MapSet } from '../lib/types';

const MIRROR = 'https://catboy.best';

export const streamUrl = (song: MapSet) => `${MIRROR}/preview/audio/${song.beatmaps?.[0]?.id}/full`;
const previewUrl = (song: MapSet) => `https://b.ppy.sh/preview/${song.id}.mp3`;
export const coverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/list@2x.jpg`;

export const queue = writable<{ songs: MapSet[]; index: number }>({ songs: [], index: -1 });
export const playing = writable(false);
export const time = writable({ current: 0, duration: 0 });
/** The song plays its 30 s preview (the mirror didn't have it) */
export const previewOnly = writable(false);

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;

function element() {
	if (audio) return audio;
	audio = new Audio();
	audio.preload = 'auto';
	audio.addEventListener('play', () => playing.set(true));
	audio.addEventListener('pause', () => playing.set(false));
	audio.addEventListener('timeupdate', () =>
		time.set({ current: audio!.currentTime, duration: audio!.duration || 0 })
	);
	audio.addEventListener('ended', () => next());
	// The mirror didn't have the song (or has a break): its preview instead
	audio.addEventListener('error', () => {
		const song = current();
		if (!song || get(previewOnly) || audio!.src.startsWith('blob:')) return;
		previewOnly.set(true);
		audio!.src = previewUrl(song);
		audio!.play().catch(() => {});
	});
	setupMediaSession();
	return audio;
}

const current = () => {
	const { songs, index } = get(queue);
	return songs[index] ?? null;
};

async function load() {
	const song = current();
	if (!song) return;
	const player = element();
	previewOnly.set(false);
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	// (imported here: downloads.ts imports this file too)
	const { localUrl } = await import('./downloads');
	objectUrl = await localUrl(song);
	player.src = objectUrl ?? streamUrl(song);
	await player.play().catch(() => {});
	showInMediaSession(song);
}

/** Plays `songs` from the one at `index` */
export function play(songs: MapSet[], index = 0) {
	queue.set({ songs, index });
	return load();
}

export function toggle() {
	const player = element();
	if (player.paused) player.play().catch(() => {});
	else player.pause();
}

export function next() {
	const { songs, index } = get(queue);
	if (index + 1 >= songs.length) return;
	queue.set({ songs, index: index + 1 });
	load();
}

export function previous() {
	const { songs, index } = get(queue);
	// A bit into the song: back to its start, else the one before
	if (element().currentTime > 3 || index === 0) {
		element().currentTime = 0;
		return;
	}
	queue.set({ songs, index: index - 1 });
	load();
}

export function seek(seconds: number) {
	element().currentTime = seconds;
}

function setupMediaSession() {
	if (!('mediaSession' in navigator)) return;
	const session = navigator.mediaSession;
	session.setActionHandler('play', () => element().play());
	session.setActionHandler('pause', () => element().pause());
	session.setActionHandler('nexttrack', next);
	session.setActionHandler('previoustrack', previous);
	session.setActionHandler(
		'seekto',
		(details) => details.seekTime != null && seek(details.seekTime)
	);
}

function showInMediaSession(song: MapSet) {
	if (!('mediaSession' in navigator)) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: song.title ?? '',
		artist: song.artist ?? '',
		artwork: [{ src: coverUrl(song), sizes: '300x300', type: 'image/jpeg' }]
	});
}
