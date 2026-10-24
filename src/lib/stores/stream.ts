// Streaming: the whole song of a beatmap that isn't downloaded, without downloading the set.
// A beatmap mirror (catboy.best) hands out only a difficulty's audio, without an osu! session
// key. A song can start playing while it still comes in (see audio.ts), the next one is loaded
// ahead, and the last few stay in memory (not saved), so going back is instant.
//
// The mirror limits how much each user asks for (it answers 429 and counts down in
// X-Ratelimit-Remaining), and bans users of apps that keep asking anyway: requests are spaced
// out, loading ahead stops when few are left, and a 429 pauses everything as long as it says.

import { get } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { userSettings } from './user';
import { offline } from './network';
import { showToast } from './toast';
import type { MapSet } from '../types';

/** The mirror's main server, and its regions (asked in turn when the main one fails) */
const MAIN = 'https://catboy.best';
const REGIONS = ['https://central.catboy.best', 'https://us.catboy.best', 'https://sg.catboy.best'];
/**
 * How long a server gets to answer (ms): a song nobody asked for in a while it may first have
 * to fetch itself. The song then takes as long as it takes.
 */
const ANSWER_TIMEOUT = 15000;
/** How many songs stay in memory */
const KEEP = 10;

// --- Being a good guest: the mirror's limits -------------------------------------------------

/** At most one request a second, and two at a time */
const GAP = 1000;
const AT_ONCE = 2;
/** Below this many requests left, nothing is loaded ahead anymore */
const SPARE = 5;

let lastRequest = 0;
let running = 0;
/** Requests for songs to play right now, waiting for their turn (loading ahead waits for them) */
let wantedNow = 0;
/** What the mirror said is left, and until when it asked to be left alone */
let remaining = Infinity;
let pausedUntil = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for a request's turn; false if it shouldn't be made at all (the mirror asked for a
 * pause, or it's only loading ahead and that would use up what's left)
 */
async function turn(now: boolean) {
	if (now) wantedNow++;
	try {
		for (;;) {
			if (Date.now() < pausedUntil) return false;
			if (!now && (remaining <= SPARE || wantedNow > 0)) return false;
			const wait = lastRequest + GAP - Date.now();
			if (wait <= 0 && running < AT_ONCE) {
				lastRequest = Date.now();
				running++;
				return true;
			}
			await sleep(Math.max(50, wait));
		}
	} finally {
		if (now) wantedNow--;
	}
}

/** The mirror asked for a break (it was said already, once) */
export const mirrorResting = () => Date.now() < pausedUntil;

/** What a server's answer says about the limits */
function noteLimits(response: Response) {
	const left = Number(response.headers.get('x-ratelimit-remaining'));
	if (response.headers.has('x-ratelimit-remaining') && Number.isFinite(left)) remaining = left;
	if (response.status !== 429) return;
	// How long to leave it alone: what it says (seconds, or a time), else a minute
	const retry = response.headers.get('retry-after') ?? response.headers.get('x-ratelimit-reset');
	const seconds = Number(retry);
	const until = !retry
		? Date.now() + 60000
		: Number.isFinite(seconds)
			? seconds > 1e9
				? seconds * 1000
				: Date.now() + seconds * 1000
			: Date.parse(retry) || Date.now() + 60000;
	const first = Date.now() >= pausedUntil;
	pausedUntil = Math.max(pausedUntil, Math.min(until, Date.now() + 10 * 60000));
	remaining = 0;
	if (first)
		showToast(
			'catboy.best wants a short break: previews for now, streaming goes on by itself',
			'icon-[mingcute--time-line]',
			6000
		);
}

/** Whether songs that aren't downloaded play in full from the mirror */
export function streamingOn() {
	return (get(userSettings).settings?.stream ?? false) && !get(offline);
}

/** The difficulty a song plays: its first */
export const streamMapId = (song: MapSet) => song.beatmaps?.[0]?.id ?? null;

export type AudioFormat = 'mp3' | 'ogg' | 'wav';

/** What the first bytes say the song is (null: not a song, e.g. an error page) */
function formatOf(bytes: Uint8Array): AudioFormat | null {
	if (bytes.byteLength < 4) return null;
	const text = String.fromCharCode(...bytes.subarray(0, 4));
	if (text.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
	if (text === 'OggS') return 'ogg';
	if (text === 'RIFF') return 'wav';
	return null;
}

/** A song coming in from the mirror: its parts so far, and the whole once it's there */
export interface Incoming {
	format: AudioFormat;
	/** The parts received so far, in order */
	chunks: Uint8Array[];
	/** All of it is there */
	complete: boolean;
	/** The whole song, or null if it broke off */
	bytes: Promise<Uint8Array | null>;
	/** Called with each new part (and once more, with null, when it's complete or broke off) */
	listen(onChunk: (chunk: Uint8Array | null) => void): () => void;
}

/** A request is done (its song read, or it failed): the next one may go */
function done() {
	running = Math.max(0, running - 1);
}

/**
 * A server's answer for a song, if it has it (its body not read yet; `done` is called once
 * it's read). 'busy' if the mirror asked for a break.
 */
async function answer(mirror: string, mapId: string, now: boolean) {
	if (!(await turn(now))) return 'busy' as const;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ANSWER_TIMEOUT);
	try {
		const response = await fetch(`${mirror}/preview/audio/${mapId}/full`, {
			signal: controller.signal
		});
		noteLimits(response);
		if (response.ok && response.body) return response;
		console.warn(`Could not stream ${mapId} from ${mirror}: HTTP ${response.status}`);
		response.body?.cancel().catch(() => {});
		done();
		return response.status === 429 ? ('busy' as const) : null;
	} catch (error) {
		console.warn('Could not stream from', mirror, error);
		done();
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** The main server's answer, else one region's after the other (not after a 429) */
async function connect(mapId: string, now: boolean) {
	for (const mirror of [MAIN, ...REGIONS]) {
		const response = await answer(mirror, mapId, now);
		if (response === 'busy') return null;
		if (response) return response;
	}
	return null;
}

/** Reads a song as it comes in; null if it isn't a song */
async function receive(response: Response): Promise<Incoming | null> {
	const reader = response.body!.getReader();
	const finished = done;
	const chunks: Uint8Array[] = [];
	const listeners = new Set<(chunk: Uint8Array | null) => void>();
	// The first bytes say whether it's a song at all
	let size = 0;
	while (size < 4) {
		const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
		if (done || !value) {
			reader.cancel().catch(() => {});
			finished();
			return null;
		}
		chunks.push(value);
		size += value.byteLength;
	}
	const head = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) head.set(chunk, (at += chunk.byteLength) - chunk.byteLength);
	const format = formatOf(head);
	if (!format) {
		reader.cancel().catch(() => {});
		finished();
		return null;
	}

	const incoming: Incoming = {
		format,
		chunks,
		complete: false,
		bytes: null!,
		listen(onChunk) {
			listeners.add(onChunk);
			return () => listeners.delete(onChunk);
		}
	};
	incoming.bytes = (async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				size += value.byteLength;
				for (const listener of listeners) listener(value);
			}
		} catch (error) {
			console.warn('A streamed song broke off:', error);
			for (const listener of listeners) listener(null);
			finished();
			return null;
		}
		finished();
		incoming.complete = true;
		for (const listener of listeners) listener(null);
		const whole = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			whole.set(chunk, offset);
			offset += chunk.byteLength;
		}
		// Too short for a song: an error the server sent as one
		return size < 20000 ? null : whole;
	})();
	return incoming;
}

const songs = new Map<string, Promise<Incoming | null>>();

function remember(key: string, loading: Promise<Incoming | null>) {
	songs.delete(key);
	songs.set(key, loading);
	while (songs.size > KEEP) songs.delete(songs.keys().next().value!);
}

/**
 * A song from the mirror as it comes in (or already there), or null if no server has it
 * (then the song is played the usual way). Asked for twice, it's fetched once.
 */
export function openStream(mapId: number | string, now = true): Promise<Incoming | null> {
	const key = String(mapId);
	const known = songs.get(key);
	if (known) {
		remember(key, known);
		return known;
	}
	const loading = connect(key, now)
		.then((response) => (response ? receive(response) : null))
		.then((incoming) => {
			// Not found or broken off: asked again next time (the mirror may have it then)
			if (!incoming) songs.delete(key);
			else
				incoming.bytes.then((bytes) => {
					if (!bytes && songs.get(key) === loading) songs.delete(key);
				});
			return incoming;
		});
	remember(key, loading);
	return loading;
}

/** The whole song from the mirror, or null */
export async function streamAudio(mapId: number | string, now = true) {
	return (await openStream(mapId, now))?.bytes ?? null;
}

// --- Loading ahead -------------------------------------------------------------------------

/** Songs to load ahead, one after the other (so they don't slow down the one that plays) */
let ahead: string[] = [];
let loadingAhead = false;

async function loadAhead() {
	if (loadingAhead) return;
	loadingAhead = true;
	while (ahead.length) {
		const mapId = ahead.shift()!;
		await streamAudio(mapId, false).catch(() => null);
	}
	loadingAhead = false;
}

/**
 * Loads songs in the background so they start right away when it's their turn (the first
 * first); songs that are downloaded or already here are left out
 */
export function prefetchStreams(
	list: (MapSet | null | undefined)[],
	downloaded: (song: MapSet) => boolean
) {
	if (!streamingOn()) return;
	const wanted = list
		.filter((song): song is MapSet => !!song && !downloaded(song))
		.map((song) => String(streamMapId(song) ?? ''))
		.filter((mapId) => mapId && !songs.has(mapId));
	if (!wanted.length) return;
	ahead = [...wanted, ...ahead.filter((mapId) => !wanted.includes(mapId))].slice(0, 2);
	loadAhead();
}

/** A song the pointer rests on: loaded right away, it's likely to be played */
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
export function prefetchOnHover(song: MapSet | null | undefined, downloaded: boolean) {
	clearTimeout(hoverTimer);
	if (!song || downloaded || !streamingOn()) return;
	const mapId = streamMapId(song);
	if (mapId == null || songs.has(String(mapId))) return;
	hoverTimer = setTimeout(() => openStream(mapId, false).catch(() => null), 400);
}

export function cancelHoverPrefetch() {
	clearTimeout(hoverTimer);
}

// --- What plays streamed -----------------------------------------------------------------

/**
 * The songs playing in full from the mirror (by set): the beat, the hitsounds and the
 * gameplay go by the whole song for them, not by a preview's cut
 */
const streamed = new Set<string>();

export function markStreamed(song: MapSet, on: boolean) {
	if (on) streamed.add(String(song.id));
	else streamed.delete(String(song.id));
}

export function isStreamed(song: MapSet | null | undefined) {
	return !!song && streamed.has(String(song.id));
}

/** The songs that couldn't be streamed and play the osu! preview instead (in any queue) */
const previewing = new Set<string>();

export function markPreviewing(song: MapSet, on: boolean) {
	if (on) previewing.add(String(song.id));
	else previewing.delete(String(song.id));
}

export function isPreviewing(song: MapSet | null | undefined) {
	return !!song && previewing.has(String(song.id));
}

/** Loudness measured of streamed songs (they aren't in the library to keep it) */
export const streamedLoudness = new Map<string, number>();
