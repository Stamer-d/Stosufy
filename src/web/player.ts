// The web app's player: one plain <audio> element (no Web Audio: iOS keeps that playing in
// the background and on the lock screen, where its controls come from the Media Session).
// The songs stream from the beatmap mirror, like the desktop app's streaming, or play from
// the phone if they were downloaded. The queue, shuffle and repeat are kept for the next
// start, where it goes on where it was.

import { get, writable } from 'svelte/store';
import { downloaded, localUrl } from './downloads';
import { coverUrl, keyOf, previewUrl, slim, streamUrl } from './songs';
import { log } from './log';
import { offline } from '../lib/stores/network';
import type { MapSet } from '../lib/types';

export { streamUrl, coverUrl, bigCoverUrl, slim } from './songs';

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
/** At the end of the queue, songs like the ones before play on (the radio's) */
export const autoplay = writable(true);
/** Songs like these, without those (set by listening.ts: the radio) */
let similarTo: ((seeds: MapSet[], exclude: MapSet[]) => MapSet[]) | null = null;
export function setSimilarSongs(find: typeof similarTo) {
	similarTo = find;
}

/**
 * Autoplay: with fewer than two songs left, songs like the last ones are added, ahead of
 * time (with the screen locked, the next song has to be there already when one ends)
 */
function topUp() {
	const { songs, index } = get(queue);
	if (!get(autoplay) || get(repeat) !== 'off' || !similarTo || songs.length - index - 1 >= 2)
		return;
	const more = similarTo(songs.slice(-5).reverse(), songs).slice(0, 20).map(slim);
	if (!more.length) return;
	log(`autoplay: ${more.length} songs like these`);
	queue.update((q) => ({ ...q, songs: [...q.songs, ...more] }));
	ordered.push(...more);
	readNext();
}

/** The sleep timer: when it stops (ms), or at the end of the song playing */
export const sleepTimer = writable<{ at: number } | { endOfSong: true } | null>(null);
/** The <audio> element, once there (the listening history looks at it) */
export const audioElement = writable<HTMLAudioElement | null>(null);

/** The queue in the order it was played in (to go back to when shuffle is turned off) */
let ordered: MapSet[] = [];
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
/** The next song's downloaded audio, read ahead: iOS starts a song with the screen locked
 * only if it's started right away when the one before ends (no waiting on anything) */
let readAhead: { key: string; url: string } | null = null;
/** Where the song was at the last timeupdate (to see it go round to the start) */
let lastTime = 0;
/** The position was changed by hand (going back to the start isn't the song's end then) */
let seekedByHand = false;
/** The song in the <audio> element (none after a start: it loads at the first play) */
let loaded: MapSet | null = null;
/** The app paused it itself (else it was the system: a call, Siri, headphones out…) */
let pausing = false;
/** Tries to get a stream going again after it broke off, for the song now */
let retries = 0;

/** Pauses, as the app (not the system) */
function pauseHere(why: string) {
	pausing = true;
	log(`pause (${why})`);
	element().pause();
}

function shuffled<T>(list: T[]) {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/**
 * The <audio> element. It loops: when a song ends by itself, iOS closes the app's audio and
 * doesn't let it start again with the screen locked, so a song never ends: going round to
 * its start is its end, and the next one starts in the same running audio.
 */
function element() {
	if (audio) return audio;
	audio = new Audio();
	audio.preload = 'auto';
	audio.loop = true;
	audioElement.set(audio);
	audio.addEventListener('play', () => playing.set(true));
	audio.addEventListener('pause', () => {
		playing.set(false);
		// (not the app: it says who, so the log shows why a song stopped by itself)
		if (!pausing && !audio!.ended)
			log(
				`paused by ${document.hidden ? 'the system, in the background' : 'the system'} (a call, Siri, headphones, another app's sound?)`
			);
		pausing = false;
	});
	audio.addEventListener('stalled', () => log('stream stalled'));
	audio.addEventListener('waiting', () => log('waiting for the stream'));
	// iOS forgets the lock screen's buttons when a song starts: set again each time
	audio.addEventListener('playing', () => {
		setupMediaSession();
		updatePosition();
		log(`playing ${current()?.title ?? ''}`);
	});
	audio.addEventListener('timeupdate', () => {
		const now = audio!.currentTime;
		const duration = audio!.duration || 0;
		time.set({ current: now, duration });
		const wentRound = duration > 0 && lastTime > duration - 3 && now < 2 && now < lastTime;
		lastTime = now;
		const sleep = get(sleepTimer);
		if (sleep && 'at' in sleep && Date.now() >= sleep.at) {
			sleepTimer.set(null);
			pauseHere('sleep timer');
		}
		if (now > 1) retries = 0;
		if (wentRound && !seekedByHand) {
			log('song went round: its end');
			songEnded();
		}
		seekedByHand = false;
		saveSoon();
	});
	audio.addEventListener('loadedmetadata', updatePosition);
	// (a speed mod: the lock screen's position runs at its speed)
	audio.addEventListener('ratechange', updatePosition);
	// (it loops, so only if that didn't work)
	audio.addEventListener('ended', () => {
		log('ended');
		songEnded();
	});
	audio.addEventListener('error', () => {
		const song = current();
		if (!song || audio!.src.startsWith('blob:')) return;
		const code = audio!.error?.code;
		// It played and the stream broke off (the connection, a moment): on from where it was,
		// a few times, waiting a bit longer each time
		const at = lastTime;
		if (!get(previewOnly) && at > 1 && retries < 4) {
			retries++;
			log(`stream broke off at ${Math.round(at)}s (error ${code}): again, try ${retries}`);
			setTimeout(() => {
				if (current() !== song) return;
				audio!.src = streamUrl(song);
				audio!.currentTime = at;
				audio!.play().catch((error) => log(`play() turned down: ${error?.name}`));
			}, 1000 * retries);
			return;
		}
		// The mirror didn't have the song (or has a break): its preview instead
		if (!get(previewOnly)) {
			log(`no stream for ${song.title} (error ${code}): its preview`);
			previewOnly.set(true);
			audio!.src = previewUrl(song);
			audio!.play().catch(() => {});
			return;
		}
		// Not even that (offline, and it isn't downloaded): the next one
		log(`can't play ${song.title} (error ${audio!.error?.code})`);
		setTimeout(() => current() === song && next(), 800);
	});
	setupMediaSession();
	return audio;
}

const current = () => {
	const { songs, index } = get(queue);
	return songs[index] ?? null;
};

/**
 * Plays the queue's current song: right away (a stream, or a download read ahead), only a
 * download that wasn't read ahead waits for it to be read
 */
function load(at = 0) {
	const song = current();
	if (!song) return;
	const player = element();
	loaded = song;
	previewOnly.set(false);
	showInMediaSession(song);
	const key = keyOf(song);
	const start = (url: string, own: boolean) => {
		if (objectUrl && objectUrl !== url) URL.revokeObjectURL(objectUrl);
		objectUrl = own ? url : null;
		lastTime = 0;
		player.src = url;
		// (where to start, once it knows how long the song is: before, browsers may forget it)
		if (at) {
			player.currentTime = at;
			player.addEventListener(
				'loadedmetadata',
				() => {
					if (loaded === song && player.currentTime < at - 1) player.currentTime = at;
				},
				{ once: true }
			);
		}
		log(`start ${song.title} (${own ? 'downloaded' : 'stream'})`);
		player.play().catch((error) => log(`play() turned down: ${error?.name}`));
		save();
		topUp();
		readNext();
	};
	if (readAhead?.key === key) {
		const { url } = readAhead;
		readAhead = null;
		start(url, true);
	} else if (get(downloaded).has(key)) {
		return localUrl(song).then((url) => {
			if (current() === song) start(url ?? streamUrl(song), !!url);
			else if (url) URL.revokeObjectURL(url);
		});
	} else start(streamUrl(song), false);
}

/** Reads the next song's audio ahead if it's downloaded */
async function readNext() {
	const { songs, index } = get(queue);
	const upcoming = songs[index + 1] ?? (get(repeat) === 'all' ? songs[0] : null);
	if (!upcoming) return;
	const key = keyOf(upcoming);
	if (readAhead?.key === key || !get(downloaded).has(key)) return;
	const url = await localUrl(upcoming);
	if (!url) return;
	if (readAhead) URL.revokeObjectURL(readAhead.url);
	readAhead = { key, url };
}

/** Plays `songs` from the one at `index` (shuffled when shuffle is on) */
export function play(
	songs: MapSet[],
	index = 0,
	{ shuffled: shuffleThem = false, at = 0 }: { shuffled?: boolean; at?: number } = {}
) {
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
	return load(at);
}

export function toggle() {
	const player = element();
	// After a start: the song of before, where it was
	if (!loaded) return load(get(time).current);
	if (player.paused) player.play().catch((error) => log(`play() turned down: ${error?.name}`));
	else pauseHere('tapped');
}

/** A song ended by itself: the next one (repeat one: it plays on, as it loops) */
function songEnded() {
	if (get(sleepTimer) && 'endOfSong' in get(sleepTimer)!) {
		sleepTimer.set(null);
		pauseHere('sleep timer, at the end of the song');
		element().currentTime = 0;
		return;
	}
	if (get(repeat) === 'one') return;
	const { songs, index } = get(queue);
	// The last one (offline: the last downloaded one): stop at its start
	const after = playableAfter(songs, index);
	if ((after < 0 || after >= songs.length) && get(repeat) !== 'all') {
		pauseHere('end of the queue');
		element().currentTime = 0;
		return;
	}
	next();
}

/** Offline, only the downloaded songs play: the next one of those (-1: none) */
function playableAfter(songs: MapSet[], index: number, step = 1) {
	if (!get(offline)) return index + step;
	const kept = get(downloaded);
	for (let i = index + step; i >= 0 && i < songs.length; i += step)
		if (kept.has(keyOf(songs[i]))) return i;
	return -1;
}

export function next() {
	const { songs } = get(queue);
	let { index } = get(queue);
	// (offline: past the ones that aren't downloaded)
	if (get(offline)) {
		const at = playableAfter(songs, index);
		if (at < 0) {
			if (get(repeat) !== 'all') return;
			const first = playableAfter(songs, -1);
			if (first < 0) return;
			queue.set({ songs, index: first });
			load();
			return;
		}
		index = at - 1;
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
		seekedByHand = true;
		element().currentTime = 0;
		return;
	}
	let before = index === 0 ? songs.length - 1 : index - 1;
	if (get(offline)) {
		before = playableAfter(songs, index, -1);
		if (before < 0) {
			seekedByHand = true;
			element().currentTime = 0;
			return;
		}
	}
	queue.set({ songs, index: before });
	load();
}

export function seek(seconds: number) {
	// (only a jump to the start isn't the song's end: dragged to the very end, the song going
	// round right after is its end)
	seekedByHand = seconds < 2;
	const player = element();
	// Dragged to the very end: that's the song's end (it loops, so it would start over at once,
	// before its end could be seen)
	if (player.duration && seconds >= player.duration - 0.5) {
		log('dragged to the end');
		songEnded();
		return;
	}
	lastTime = seconds;
	player.currentTime = seconds;
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
	readNext();
}

/** The song comes at the end of the queue */
export function addToQueue(song: MapSet) {
	if (!current()) return play([song]);
	queue.update(({ songs, index }) => ({ songs: [...songs, slim(song)], index }));
	ordered.push(slim(song));
	save();
	readNext();
}

export function removeFromQueue(at: number) {
	queue.update(({ songs, index }) => ({
		songs: songs.filter((_, i) => i !== at),
		index: at < index ? index - 1 : index
	}));
	save();
	readNext();
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
	readNext();
}

export function toggleAutoplay() {
	autoplay.update((on) => !on);
	save();
	topUp();
}

export function cycleRepeat() {
	repeat.update((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
	save();
	readNext();
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
				repeat: get(repeat),
				autoplay: get(autoplay),
				// (to tell at the next start whether the app was closed while a song played)
				playing: get(playing)
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
		if (saved?.autoplay === false) autoplay.set(false);
		log(
			saved?.playing
				? `app opened again: it was closed while ${saved.songs?.[saved.index]?.title ?? 'a song'} played (iOS closes apps in the background when it needs memory)`
				: `app opened (${__WEB_VERSION__})`
		);
	} catch {
		// (nothing to go on with)
	}
}

// A stream that stands still while it should play (the connection, without an error): on
// again from where it is, after a while
if (typeof window !== 'undefined') {
	let still = 0;
	let last = -1;
	setInterval(() => {
		const song = current();
		if (!audio || audio.paused || !song || document.hidden || audio.src.startsWith('blob:')) {
			still = 0;
			return;
		}
		still = audio.currentTime === last ? still + 1 : 0;
		last = audio.currentTime;
		if (still < 4 || !navigator.onLine || retries >= 4) return;
		still = 0;
		retries++;
		const at = audio.currentTime;
		log(`stream stood still at ${Math.round(at)}s: again, try ${retries}`);
		audio.src = get(previewOnly) ? previewUrl(song) : streamUrl(song);
		audio.currentTime = at;
		audio.play().catch((error) => log(`play() turned down: ${error?.name}`));
	}, 3000);
}

// The lock screen and Control Center

function setupMediaSession() {
	if (!('mediaSession' in navigator)) return;
	const session = navigator.mediaSession;
	session.setActionHandler('play', () => element().play());
	session.setActionHandler('pause', () => pauseHere('lock screen'));
	session.setActionHandler('nexttrack', () => {
		log('lock screen: next');
		next();
	});
	session.setActionHandler('previoustrack', () => {
		log('lock screen: back');
		previous();
	});
	// (with these, iOS shows ±10 s on the lock screen instead of back and next)
	for (const action of ['seekbackward', 'seekforward'] as const) {
		try {
			session.setActionHandler(action, null);
		} catch {
			// (not known here)
		}
	}
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
			playbackRate: audio.playbackRate || 1
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
