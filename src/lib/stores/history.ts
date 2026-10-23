// Listening history: which songs were heard, when and for how long. Wrapped and the radio are
// made from it. It's kept on this device and synced with the account (the Stamer API), so
// every device knows what was heard on the others. A song counts as played once it was heard for
// 30 seconds (or half of it, if it's shorter than a minute); one left before that is kept
// as a skip (the radio learns from those). What it was heard for counts in real time, so
// pauses, seeking and speed mods don't.

import { get, writable } from 'svelte/store';
import { load } from '@tauri-apps/plugin-store';
import { songQueue, currentSong } from './audio';
import { keyStore } from './auth';
import { offline } from './network';
import * as api from '../api';
import type { MapSet } from '../types';

/** What the history keeps of a song (the songs of a play are kept once, by key) */
export interface HistorySong {
	setId: number | string;
	track: number;
	mapId: number | string | null;
	title: string;
	artist: string;
	creator: string;
	genre: string | null;
	language: string | null;
	/** Where the song is from (an anime, a game…) */
	source: string | null;
	bpm: number | null;
}

/**
 * A play (or a skip, see counts()): the song's key, when it started (Unix time, s), how long
 * it was heard and its length (s)
 */
export type Play = [key: string, at: number, heard: number, length: number];

export interface History {
	songs: Record<string, HistorySong>;
	plays: Play[];
}

export const history = writable<History>({ songs: {}, plays: [] });

/** Heard this long, a song counts as played (s) */
const COUNTS_AFTER = 30;
/** Shorter songs are previews and clips: not kept (s) */
const SHORTEST = 30;
/** Heard less, it was only passed by (s) */
const KEPT_AFTER = 5;
const FILE = 'history.json';
const SAVE_AFTER = 5000;
/** How often the history is synced while the app runs (ms) */
const SYNC_EVERY = 5 * 60 * 1000;
/** The server takes this many plays at a time */
const UPLOAD_BATCH = 2000;
/** Closing or logging out waits this long for the upload at most (ms) */
const FLUSH_WAIT = 3000;

export const songKey = (song: { id?: number | string; setId?: number | string; track?: number }) =>
	`${song.id ?? song.setId}:${song.track ?? 0}`;

/** Whether a song heard this long was played (else it was skipped) */
export const counts = (heard: number, length: number) =>
	length >= SHORTEST && heard >= Math.min(COUNTS_AFTER, length / 2);

function historySong(song: MapSet): HistorySong {
	return {
		setId: song.id,
		track: song.track ?? 0,
		mapId: song.beatmaps?.[0]?.id ?? null,
		title: song.title ?? '',
		artist: song.artist ?? '',
		creator: song.creator ?? '',
		genre: song.genre ?? null,
		language: song.language ?? null,
		source: song.songSource || null,
		bpm: song.bpm ?? null
	};
}

// --- Saving ----------------------------------------------------------------------------------

let storePromise: ReturnType<typeof load> | null = null;
const store = () => (storePromise ??= load(FILE));
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Plays not uploaded yet */
let pending: Play[] = [];
/** Where the next pull from the server goes on from */
let cursor = 0;

async function save() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = null;
	if (!loaded) return;
	await loaded;
	try {
		const data = await store();
		const { songs, plays } = get(history);
		await data.set('songs', songs);
		await data.set('plays', plays);
		await data.set('pending', pending);
		await data.set('cursor', cursor);
		await data.save();
	} catch (error) {
		console.error('Could not save the listening history:', error);
	}
}

function saveLater() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(save, SAVE_AFTER);
}

async function loadHistory() {
	try {
		const data = await store();
		const songs = (await data.get<History['songs']>('songs')) ?? {};
		const plays = (await data.get<Play[]>('plays')) ?? [];
		// (kept before the history was synced: all of it is still to be uploaded)
		const stored = await data.get<Play[]>('pending');
		pending = [...(stored ?? plays), ...pending];
		cursor = (await data.get<number>('cursor')) ?? 0;
		// Plays counted before the file was read come after the saved ones
		history.update((now) => ({
			songs: { ...songs, ...now.songs },
			plays: [...plays, ...now.plays]
		}));
	} catch (error) {
		console.error('Could not read the listening history:', error);
	}
}

/** Forgets the history on this device (logging out: the account keeps it) */
export async function clearHistory() {
	history.set({ songs: {}, plays: [] });
	session = null;
	pending = [];
	cursor = 0;
	try {
		const data = await store();
		await data.clear();
		await data.save();
	} catch (error) {
		console.warn('Could not clear the listening history:', error);
	}
}

// --- Listening ---------------------------------------------------------------------------------

interface Session {
	audio: HTMLAudioElement;
	song: MapSet;
	/** When it started (Unix time, s) */
	at: number;
	/** Heard for (s) */
	heard: number;
	/** When it was last looked at (performance.now()) and where it was then (s of the song) */
	checked: number;
	position: number;
	/** Its length in real time (speed mods change it) */
	length: number;
}

let session: Session | null = null;

function begin(audio: HTMLAudioElement, song: MapSet): Session {
	return {
		audio,
		song,
		at: Math.floor(Date.now() / 1000),
		heard: 0,
		checked: performance.now(),
		position: audio.currentTime,
		length: 0
	};
}

/** The song stopped being the current one (or starts over): a play, if it was heard long enough */
function finish(done: Session) {
	if (done.length < SHORTEST || done.heard < KEPT_AFTER) return;
	const key = songKey(done.song);
	const play: Play = [key, done.at, Math.round(done.heard), Math.round(done.length)];
	history.update(({ songs, plays }) => ({
		songs: { ...songs, [key]: historySong(done.song) },
		plays: [...plays, play]
	}));
	pending.push(play);
	saveLater();
}

function check() {
	const audio = get(songQueue).audio ?? null;
	const song = get(currentSong).song;
	if (session && (session.audio !== audio || !sameSongKey(session.song, song))) {
		finish(session);
		session = null;
	}
	if (!audio || !song) return;
	session ??= begin(audio, song);
	const now = performance.now();
	const duration = audio.duration;
	// Repeating the song: back at its start after its end, another play
	if (
		Number.isFinite(duration) &&
		session.position > duration - 3 &&
		audio.currentTime < 3 &&
		session.heard > 0
	) {
		finish(session);
		session = begin(audio, song);
	}
	// (at most a few seconds: the window may have been asleep)
	if (!audio.paused) session.heard += Math.min((now - session.checked) / 1000, 3);
	session.checked = now;
	session.position = audio.currentTime;
	if (Number.isFinite(duration)) session.length = duration / (audio.playbackRate || 1);
}

const sameSongKey = (a: MapSet | null, b: MapSet | null) => !!a && !!b && songKey(a) === songKey(b);

/** Counts the song that plays now, saves and uploads (the app is closing, or logging out) */
export async function flushHistory() {
	if (session) {
		finish(session);
		session = null;
	}
	await save();
	// (not for long: closing waits for it)
	await Promise.race([syncHistory(), new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT))]);
}

// --- Syncing -------------------------------------------------------------------------------

const playId = ([key, at]: Play) => `${key}@${at}`;
let syncing: Promise<void> | null = null;

/** Uploads the plays not uploaded yet, then gets the ones the other devices uploaded */
export function syncHistory() {
	syncing ??= sync().finally(() => (syncing = null));
	return syncing;
}

async function sync() {
	await loaded;
	const token = get(keyStore).access_token;
	if (!token || get(offline)) return;
	try {
		while (pending.length) {
			const batch = pending.slice(0, UPLOAD_BATCH);
			const { songs } = get(history);
			const batchSongs = Object.fromEntries(
				batch.map(([key]) => [key, songs[key]]).filter(([, song]) => song)
			);
			await api.addPlays(token, batch, batchSongs);
			// (plays counted while it uploaded stay)
			pending = pending.filter((play) => !batch.includes(play));
		}
		let more = true;
		while (more) {
			const page = await api.getPlays(token, cursor);
			addFromServer(page.plays, page.songs);
			cursor = page.cursor;
			more = page.more;
		}
	} catch (error) {
		// Next time (offline, or the API is down)
		console.warn('Could not sync the listening history:', error);
	}
	await save();
}

/** Plays from the server: the ones this device doesn't have yet, in time order */
function addFromServer(plays: Play[], songs: Record<string, HistorySong>) {
	history.update((now) => {
		const known = new Set(now.plays.map(playId));
		const added = plays.filter((play) => !known.has(playId(play)));
		const nextSongs = { ...songs, ...now.songs };
		if (!added.length) return { ...now, songs: nextSongs };
		const all = [...now.plays, ...added].sort((a, b) => a[1] - b[1]);
		return { songs: nextSongs, plays: all };
	});
}

/** Deletes the history: on this device and on the account (every device's, from now on) */
export async function deleteHistory() {
	const token = get(keyStore).access_token;
	if (!token) throw new Error('Not logged in');
	await api.clearPlays(token);
	const last = cursor;
	await clearHistory();
	// (the plays deleted on the server don't come back)
	cursor = last;
	await save();
}

if (typeof window !== 'undefined') {
	loaded = loadHistory();
	setInterval(check, 1000);
	// Once the login is there, and then every few minutes
	setTimeout(syncHistory, 5000);
	setInterval(syncHistory, SYNC_EVERY);
}

// --- Reading -----------------------------------------------------------------------------------

export interface SongPlays {
	plays: number;
	skips: number;
	/** When it was last played or skipped (Unix time, s) */
	last: number;
}

/** How often each song was played and skipped, and when last, by key */
export function playCounts(plays = get(history).plays) {
	const result = new Map<string, SongPlays>();
	for (const [key, at, heard, length] of plays) {
		const entry = result.get(key) ?? { plays: 0, skips: 0, last: 0 };
		if (counts(heard, length)) entry.plays++;
		else entry.skips++;
		entry.last = Math.max(entry.last, at);
		result.set(key, entry);
	}
	return result;
}
