// The web app's player: one plain <audio> element (no Web Audio: iOS keeps that playing in
// the background and on the lock screen, where its controls come from the Media Session).
// The songs stream from the beatmap mirror, like the desktop app's streaming, or play from
// the phone if they were downloaded. The queue, shuffle and repeat are kept for the next
// start, where it goes on where it was.

import { get, writable } from 'svelte/store';
import type { MapSet } from '../lib/types';

const MIRROR = 'https://catboy.best';

export const streamUrl = (song: MapSet) => `${MIRROR}/preview/audio/${song.beatmaps?.[0]?.id}/full`;
const previewUrl = (song: MapSet) => `https://b.ppy.sh/preview/${song.id}.mp3`;
export const coverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/list@2x.jpg`;
export const bigCoverUrl = (song: MapSet) =>
	`https://assets.ppy.sh/beatmaps/${song.id}/covers/card@2x.jpg`;

export type Repeat = 'off' | 'all' | 'one';

export const queue = writable<{ songs: MapSet[]; index: number }>({ songs: [], index: -1 });
export const playing = writable(false);
export const time = writable({ current: 0, duration: 0 });
/** The song plays its 30 s preview (the mirror didn't have it) */
export const previewOnly = writable(false);
export const shuffle = writable(false);
export const repeat = writable<Repeat>('off');
/** The full screen player is open */
export const playerOpen = writable(false);

/** The queue in the order it was played in (to go back to when shuffle is turned off) */
let ordered: MapSet[] = [];
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
/** The song in the <audio> element (none after a start: it loads at the first play) */
let loaded: MapSet | null = null;

/** Only what the player needs of a song (kept in localStorage) */
export function slim(song: MapSet): MapSet {
	const map = song.beatmaps?.[0];
	return {
		id: song.id,
		title: song.title,
		artist: song.artist,
		creator: song.creator,
		track: song.track,
		beatmaps: map ? [{ id: map.id, total_length: map.total_length, version: map.version }] : []
	} as MapSet;
}

function shuffled<T>(list: T[]) {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function element() {
	if (audio) return audio;
	audio = new Audio();
	audio.preload = 'auto';
	audio.addEventListener('play', () => playing.set(true));
	audio.addEventListener('pause', () => playing.set(false));
	audio.addEventListener('timeupdate', () => {
		time.set({ current: audio!.currentTime, duration: audio!.duration || 0 });
		saveSoon();
	});
	audio.addEventListener('loadedmetadata', updatePosition);
	audio.addEventListener('ended', () => next(true));
	audio.addEventListener('error', () => {
		const song = current();
		if (!song || audio!.src.startsWith('blob:')) return;
		// The mirror didn't have the song (or has a break): its preview instead
		if (!get(previewOnly)) {
			previewOnly.set(true);
			audio!.src = previewUrl(song);
			audio!.play().catch(() => {});
			return;
		}
		// Not even that (offline, and it isn't downloaded): the next one
		setTimeout(() => current() === song && next(true), 800);
	});
	setupMediaSession();
	return audio;
}

const current = () => {
	const { songs, index } = get(queue);
	return songs[index] ?? null;
};

async function load(at = 0) {
	const song = current();
	if (!song) return;
	const player = element();
	loaded = song;
	previewOnly.set(false);
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	// (imported here: downloads.ts imports this file too)
	const { localUrl } = await import('./downloads');
	objectUrl = await localUrl(song);
	if (current() !== song) return;
	player.src = objectUrl ?? streamUrl(song);
	if (at) player.currentTime = at;
	await player.play().catch(() => {});
	showInMediaSession(song);
	save();
}

/** Plays `songs` from the one at `index` (shuffled when shuffle is on) */
export function play(songs: MapSet[], index = 0, { shuffled: shuffleThem = false } = {}) {
	if (!songs.length) return;
	if (shuffleThem) shuffle.set(true);
	ordered = songs.map(slim);
	const first = ordered[index] ?? ordered[0];
	if (get(shuffle)) {
		const order = shuffleThem
			? shuffled(ordered)
			: [first, ...shuffled(ordered.filter((_, i) => i !== index))];
		queue.set({ songs: order, index: 0 });
	} else {
		queue.set({ songs: ordered, index });
	}
	return load();
}

export function toggle() {
	const player = element();
	// After a start: the song of before, where it was
	if (!loaded) return load(get(time).current);
	if (player.paused) player.play().catch(() => {});
	else player.pause();
}

/** The next song (`ended`: the one before ended by itself, so repeat one plays it again) */
export function next(ended = false) {
	const { songs, index } = get(queue);
	if (ended && get(repeat) === 'one') {
		element().currentTime = 0;
		element()
			.play()
			.catch(() => {});
		return;
	}
	if (index + 1 >= songs.length) {
		if (get(repeat) !== 'all' || !songs.length) return;
		queue.set({ songs, index: 0 });
	} else queue.set({ songs, index: index + 1 });
	load();
}

export function previous() {
	const { songs, index } = get(queue);
	// A bit into the song: back to its start, else the one before
	if (element().currentTime > 3 || (index === 0 && get(repeat) !== 'all')) {
		element().currentTime = 0;
		return;
	}
	queue.set({ songs, index: index === 0 ? songs.length - 1 : index - 1 });
	load();
}

export function seek(seconds: number) {
	element().currentTime = seconds;
	updatePosition();
}

/** Plays the song at `index` of the queue */
export function jumpTo(index: number) {
	queue.update((q) => ({ ...q, index }));
	return load();
}

/** The song comes right after the one playing */
export function playNext(song: MapSet) {
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => ({
		songs: [...songs.slice(0, index + 1), slim(song), ...songs.slice(index + 1)],
		index
	}));
	ordered.push(slim(song));
	save();
}

/** The song comes at the end of the queue */
export function addToQueue(song: MapSet) {
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => ({ songs: [...songs, slim(song)], index }));
	ordered.push(slim(song));
	save();
}

export function removeFromQueue(at: number) {
	queue.update(({ songs, index }) => ({
		songs: songs.filter((_, i) => i !== at),
		index: at < index ? index - 1 : index
	}));
	save();
}

export function toggleShuffle() {
	const on = !get(shuffle);
	shuffle.set(on);
	const song = current();
	if (!song) return;
	const { songs, index } = get(queue);
	if (on) {
		ordered = songs;
		queue.set({ songs: [song, ...shuffled(songs.filter((_, i) => i !== index))], index: 0 });
	} else {
		const back = ordered.length ? ordered : songs;
		const at = back.findIndex(
			(other) => other.id == song.id && other.beatmaps?.[0]?.id == song.beatmaps?.[0]?.id
		);
		queue.set({ songs: back, index: Math.max(at, 0) });
	}
	save();
}

export function cycleRepeat() {
	repeat.update((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
	save();
}

// Kept for the next start

const KEY = 'stosufy-web-player';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const saveSoon = () => (saveTimer ??= setTimeout(save, 5000));

function save() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = null;
	const { songs, index } = get(queue);
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				songs,
				index,
				ordered,
				at: audio?.currentTime ?? get(time).current,
				shuffle: get(shuffle),
				repeat: get(repeat)
			})
		);
	} catch {
		// (full or private browsing: it starts empty next time)
	}
}

if (typeof localStorage !== 'undefined') {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (saved?.songs?.length) {
			queue.set({ songs: saved.songs, index: saved.index ?? 0 });
			ordered = saved.ordered ?? saved.songs;
			time.set({ current: saved.at ?? 0, duration: 0 });
		}
		shuffle.set(!!saved?.shuffle);
		if (saved?.repeat) repeat.set(saved.repeat);
	} catch {
		// (nothing to go on with)
	}
}

// The lock screen and Control Center

function setupMediaSession() {
	if (!('mediaSession' in navigator)) return;
	const session = navigator.mediaSession;
	session.setActionHandler('play', () => element().play());
	session.setActionHandler('pause', () => element().pause());
	session.setActionHandler('nexttrack', () => next());
	session.setActionHandler('previoustrack', previous);
	session.setActionHandler(
		'seekto',
		(details) => details.seekTime != null && seek(details.seekTime)
	);
}

function updatePosition() {
	if (!audio || !('mediaSession' in navigator) || !audio.duration) return;
	try {
		navigator.mediaSession.setPositionState({
			duration: audio.duration,
			position: Math.min(audio.currentTime, audio.duration),
			playbackRate: 1
		});
	} catch {
		// (older Safari)
	}
}

function showInMediaSession(song: MapSet) {
	if (!('mediaSession' in navigator)) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: song.title ?? '',
		artist: song.artist ?? '',
		artwork: [{ src: coverUrl(song), sizes: '300x300', type: 'image/jpeg' }]
	});
}
