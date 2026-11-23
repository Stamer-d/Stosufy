// A song's audio as a whole, in the phone's memory. The mirror sends a song in one piece (no
// byte ranges): played straight from it, a browser can't jump to a part that hasn't come in
// yet (Chrome goes back to the start, Safari stays where it is), may not know how long the
// song is, and the lock screen has no line to drag. And with the screen locked a song has to
// start the moment the one before ends: one that first has to come from the network may
// never start.
// So songs are read whole and played from memory, as the downloaded ones are: the next song
// while this one plays, the one playing a few seconds in (it started straight from the
// mirror, right away), and the last few stay for going back. The downloaded ones come from
// the phone the same way.
//
// The mirror limits how much each user asks for: two songs at a time are read ahead at most
// (the one playing and the next), a song that failed isn't asked for again for a while, and
// when the mirror asks for a break (429) nothing is read ahead until it's over.

import { get } from 'svelte/store';
import { downloaded, localBlob } from './downloads';
import { keyOf, streamUrl } from './songs';
import { offline } from '../lib/stores/network';
import { log } from './log';
import type { MapSet } from '../lib/types';

/** How many songs stay in memory, and how much they may take together (bytes) */
const MOST = 6;
const MOST_BYTES = 120 * 1024 * 1024;
/** A song bigger than this isn't kept in memory (an hour-long mix): it plays from the mirror */
const BIGGEST = 48 * 1024 * 1024;
/** Songs read ahead at once */
const AT_ONCE = 2;
/** How long a song gets to come in (ms) */
const TIMEOUT = 90_000;
/** A song that couldn't be read isn't asked for again this long (ms) */
const AGAIN_AFTER = 60_000;

type Held = { key: string; blob: Blob; url: string };

/** The songs in memory, the one used longest ago first */
const held = new Map<string, Held>();
const reading = new Map<string, Promise<Held | null>>();
/** Songs that couldn't be read, and when (their key) */
const failed = new Map<string, number>();
/** Songs the browser can't play from memory (its format): they aren't kept again */
const unplayable = new Set<string>();
/** Until when the mirror asked to be left alone */
let restUntil = 0;
/** The songs that stay whatever else comes (the player's: playing, next, the one before) */
let keeper: () => (MapSet | null | undefined)[] = () => [];
export function setKeeper(songs: typeof keeper) {
	keeper = songs;
}

/** What kind of audio the first bytes are (the mirror says "mp3" for Ogg too) */
function typeOf(bytes: Uint8Array, said: string) {
	const text = String.fromCharCode(...bytes.subarray(0, 4));
	if (text === 'OggS') return 'audio/ogg';
	if (text === 'RIFF') return 'audio/wav';
	if (text.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
		return 'audio/mpeg';
	if (text === 'fLaC') return 'audio/flac';
	return said.startsWith('audio/') ? said : 'audio/mpeg';
}

/** The answer's body, whole, as it comes in; null when it's bigger than a song is */
async function whole(response: Response) {
	if (Number(response.headers.get('content-length')) > BIGGEST) {
		await response.body?.cancel().catch(() => {});
		return null;
	}
	const said = response.headers.get('content-type') ?? '';
	const reader = response.body?.getReader();
	if (!reader) {
		const blob = await response.blob();
		if (blob.size > BIGGEST) return null;
		const first = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
		return blob.slice(0, blob.size, typeOf(first, said));
	}
	const parts: Uint8Array<ArrayBuffer>[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > BIGGEST) {
			await reader.cancel().catch(() => {});
			return null;
		}
		parts.push(value as Uint8Array<ArrayBuffer>);
	}
	if (!size) throw new Error('empty');
	return new Blob(parts, { type: typeOf(parts[0], said) });
}

function keep(key: string, blob: Blob): Held {
	const entry = { key, blob, url: URL.createObjectURL(blob) };
	held.set(key, entry);
	// The ones used longest ago go, but for the player's
	const staying = new Set(
		keeper()
			.filter((song): song is MapSet => !!song)
			.map(keyOf)
	);
	staying.add(key);
	let bytes = 0;
	for (const other of held.values()) bytes += other.blob.size;
	for (const other of [...held.values()]) {
		if (held.size <= MOST && bytes <= MOST_BYTES) break;
		if (staying.has(other.key)) continue;
		held.delete(other.key);
		bytes -= other.blob.size;
		URL.revokeObjectURL(other.url);
	}
	return entry;
}

async function read(song: MapSet, key: string): Promise<Held | null> {
	try {
		if (get(downloaded).has(key)) {
			const blob = await localBlob(song);
			if (blob) return keep(key, blob);
		}
		if (get(offline)) return null;
		const response = await fetch(streamUrl(song), { signal: AbortSignal.timeout(TIMEOUT) });
		if (response.status === 429) {
			// (as long as it says, a minute if it doesn't; ten at most)
			const wait = Number(response.headers.get('retry-after'));
			restUntil = Date.now() + Math.min(600, wait > 0 ? wait : 60) * 1000;
			log('the mirror asks for a break: no songs read ahead for now');
		}
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const blob = await whole(response);
		if (!blob) {
			log(`${song.title}: too big to keep in memory, it plays from the mirror`);
			failed.set(key, Infinity);
			return null;
		}
		log(`in memory: ${song.title} (${(blob.size / 1e6).toFixed(1)} MB)`);
		return keep(key, blob);
	} catch (error) {
		failed.set(key, Date.now());
		log(`${song.title} couldn't be read ahead (${(error as Error)?.message ?? error})`);
		return null;
	}
}

/** The song's audio in memory, to play (null: not there) */
export function heldUrl(song: MapSet | null | undefined) {
	const entry = song ? held.get(keyOf(song)) : undefined;
	if (!entry) return null;
	// (used just now: the last to go)
	held.delete(entry.key);
	held.set(entry.key, entry);
	return entry.url;
}

/** The song is on its way into memory */
export const isReading = (song: MapSet) => reading.has(keyOf(song));

/**
 * Reads the song into memory (from the phone if it's downloaded, else from the mirror) and
 * says where it plays from; null if it can't be had. `now`: it's needed to play right now
 * (asked for even if the mirror wants a break, or it failed a moment ago); else it's read
 * ahead, two songs at a time at most.
 */
export function hold(song: MapSet, now = false): Promise<string | null> {
	const key = keyOf(song);
	const there = heldUrl(song);
	if (there) return Promise.resolve(there);
	if (unplayable.has(key)) return Promise.resolve(null);
	const going = reading.get(key);
	if (going) return going.then((entry) => entry?.url ?? null);
	const local = get(downloaded).has(key);
	if (!local) {
		const last = failed.get(key) ?? 0;
		if (last === Infinity || get(offline)) return Promise.resolve(null);
		if (
			!now &&
			(Date.now() < restUntil || Date.now() - last < AGAIN_AFTER || reading.size >= AT_ONCE)
		)
			return Promise.resolve(null);
	}
	const promise = read(song, key).finally(() => reading.delete(key));
	reading.set(key, promise);
	return promise.then((entry) => entry?.url ?? null);
}

/** The browser couldn't play the song from memory: let go of it, and not kept again */
export function cantPlayHeld(song: MapSet) {
	const key = keyOf(song);
	unplayable.add(key);
	const entry = held.get(key);
	if (!entry) return;
	held.delete(key);
	URL.revokeObjectURL(entry.url);
}

/** The bytes of a song in memory (null: not there) */
export async function heldAudio(song: MapSet): Promise<ArrayBuffer | null> {
	const entry = held.get(keyOf(song));
	return entry ? entry.blob.arrayBuffer().catch(() => null) : null;
}
