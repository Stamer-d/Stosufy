// Streaming: the whole song of a beatmap that isn't downloaded, without downloading the set.
// A beatmap mirror (catboy.best) hands out only a difficulty's audio, without an osu! session
// key. It's kept in memory for a few songs (not saved), so going back to one is instant.

import { get } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { userSettings } from './user';
import { offline } from './network';
import type { MapSet } from '../types';

/** The mirror's main server, and its regions (asked together when the main one fails) */
const MAIN = 'https://catboy.best';
const REGIONS = ['https://central.catboy.best', 'https://us.catboy.best', 'https://sg.catboy.best'];
/** How long a server gets to answer (ms); the song itself then takes as long as it takes */
const ANSWER_TIMEOUT = 8000;
/** How many songs stay in memory */
const KEEP = 6;

/** Whether songs that aren't downloaded play in full from the mirror */
export function streamingOn() {
	return (get(userSettings).settings?.stream ?? false) && !get(offline);
}

/** The difficulty a song plays: its first */
export const streamMapId = (song: MapSet) => song.beatmaps?.[0]?.id ?? null;

const cache = new Map<string, Promise<Uint8Array | null>>();

/** Whether bytes are a song (and not an error page): MP3 (ID3 or a frame), Ogg, WAV */
function isAudio(bytes: Uint8Array) {
	if (bytes.byteLength < 20000) return false;
	const text = String.fromCharCode(...bytes.subarray(0, 4));
	return (
		text.startsWith('ID3') ||
		text === 'OggS' ||
		text === 'RIFF' ||
		(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
	);
}

/** The song from one server, or null */
async function fromMirror(mirror: string, mapId: string) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ANSWER_TIMEOUT);
	try {
		const response = await fetch(`${mirror}/preview/audio/${mapId}/full`, {
			signal: controller.signal
		});
		clearTimeout(timer);
		if (!response.ok) return null;
		const bytes = new Uint8Array(await response.arrayBuffer());
		return isAudio(bytes) ? bytes : null;
	} catch (error) {
		console.warn('Could not stream from', mirror, error);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** The main server, else whichever region has it first */
async function fromMirrors(mapId: string) {
	const main = await fromMirror(MAIN, mapId);
	if (main) return main;
	return Promise.any(
		REGIONS.map((mirror) =>
			fromMirror(mirror, mapId).then((bytes) => bytes ?? Promise.reject(new Error('none')))
		)
	).catch(() => null);
}

/**
 * The whole song of a difficulty from the mirror, or null if no server has it (then the
 * song is played the usual way). Asked for twice, it's fetched once.
 */
export function streamAudio(mapId: number | string): Promise<Uint8Array | null> {
	const key = String(mapId);
	const known = cache.get(key);
	if (known) {
		// The most recent at the end
		cache.delete(key);
		cache.set(key, known);
		return known;
	}
	const loading = fromMirrors(key).then((bytes) => {
		// Not found: asked again next time (the mirror may have it then)
		if (!bytes) cache.delete(key);
		return bytes;
	});
	cache.set(key, loading);
	while (cache.size > KEEP) cache.delete(cache.keys().next().value!);
	return loading;
}

/** Loads a song in the background, so it starts right away when it's its turn */
export function prefetchStream(song: MapSet | null | undefined) {
	const mapId = song && streamMapId(song);
	if (mapId != null && streamingOn()) streamAudio(mapId).catch(() => {});
}

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

/** Loudness measured of streamed songs (they aren't in the library to keep it) */
export const streamedLoudness = new Map<string, number>();
