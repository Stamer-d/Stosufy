// Song lyrics from LRCLIB (lrclib.net), a free database of lyrics, most of them synced
// line by line. osu! titles are often romanized and the songs shortened (TV size), so the
// search also tries the original-language title from osu! and prefers the same length.

import { derived, get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { freshToken } from './auth';
import { currentSong, songQueue } from './audio';
import { userSettings, updateUserSettings } from './user';
import type { MapSet } from '../types';
import { hasJapanese, romanize } from '../romaji';

const API = 'https://lrclib.net/api';
const HEADERS = { 'Lrclib-Client': 'Stosufy (https://github.com/Stamer-d/Stosufy)' };
/** Synced lyrics of a song this much longer or shorter count as another version */
const SAME_LENGTH = 4;
const MAX_CACHED = 200;

export interface LyricLine {
	/** Seconds into the song */
	time: number;
	text: string;
}

export interface Lyrics {
	/** Synced lines, or null for plain lyrics only */
	lines: LyricLine[] | null;
	plain: string | null;
	instrumental: boolean;
	/** The synced lyrics are of a version with another length, e.g. the full song */
	otherVersion: boolean;
	source: { track: string; artist: string };
}

export interface LyricsState {
	key: string | null;
	status: 'idle' | 'loading' | 'found' | 'none' | 'error';
	lyrics: Lyrics | null;
}

export const lyrics = writable<LyricsState>({ key: null, status: 'idle', lyrics: null });

/** Whether lyrics are wanted (the lyrics page or the focus view shows them) */
export const lyricsWanted = writable(0);

const cache = new Map<string, Lyrics | null>();

/** Parses LRC: "[01:02.34] text", several timestamps per line possible */
export function parseLrc(lrc: string): LyricLine[] {
	const lines: LyricLine[] = [];
	for (const raw of lrc.split(/\r?\n/)) {
		const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
		if (!stamps.length) continue;
		const text = raw.replace(/\[[^\]]*\]/g, '').trim();
		for (const stamp of stamps) {
			lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text });
		}
	}
	return lines.sort((a, b) => a.time - b.time);
}

/** Drops what osu! adds to titles: (TV Size), (Short Ver.), (Cut Ver.), [Extended] … */
export function cleanTitle(title: string) {
	return title
		.replace(
			/\s*[([](?:[^)\]]*\b(?:tv|size|ver\.?|version|cut|short|edit|extended|full|game|sped up|nightcore)\b[^)\]]*)[)\]]/gi,
			''
		)
		.trim();
}

const TIMEOUT = 10_000;
const ATTEMPTS = 3;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A request to LRCLIB; it's often slow or briefly down, so it's tried a few times */
async function lrclib(path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		if (attempt) await wait(attempt * 1000);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT);
		try {
			const response = await fetch(`${API}/${path}`, {
				headers: HEADERS,
				signal: controller.signal
			});
			if (response.status === 404) return null;
			if (response.ok) return await response.json();
			lastError = new Error(`LRCLIB answered with HTTP ${response.status}`);
			// Only busy or broken servers are worth asking again
			if (response.status !== 429 && response.status < 500) break;
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError;
}

/** Title and artist in the original language, from osu! */
async function unicodeNames(setId: number | string) {
	if (!(Number(setId) > 0)) return null;
	try {
		const response = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${setId}`, {
			headers: { Authorization: `Bearer ${await freshToken()}` }
		});
		if (!response.ok) return null;
		const set = await response.json();
		return { title: set.title_unicode as string, artist: set.artist_unicode as string };
	} catch {
		return null;
	}
}

type Record = {
	trackName: string;
	artistName: string;
	duration: number;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
};

/** The best of the found lyrics: synced and the same length first */
function best(records: Record[], duration: number): Record | null {
	const score = (record: Record) => {
		const sameLength = Math.abs(record.duration - duration) <= SAME_LENGTH;
		return (
			(record.syncedLyrics ? 4 : record.plainLyrics ? 1 : 0) +
			(sameLength ? 2 : 0) -
			Math.min(1, Math.abs(record.duration - duration) / 600)
		);
	};
	const usable = records.filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental);
	return usable.sort((a, b) => score(b) - score(a))[0] ?? null;
}

async function search(song: MapSet, duration: number): Promise<Lyrics | null> {
	const names = [{ title: cleanTitle(song.title ?? ''), artist: song.artist ?? '' }];
	const records: Record[] = [];
	// A failed lookup only counts when none found anything
	let failure: unknown = null;
	const lookup = async (path: string) => {
		try {
			records.push(...((await lrclib(path)) ?? []));
		} catch (error) {
			failure ??= error;
		}
	};
	const find = async ({ title, artist }: { title: string; artist: string }) => {
		if (!title) return;
		await lookup(`search?${new URLSearchParams({ track_name: title, artist_name: artist })}`);
		if (!records.length) await lookup(`search?${new URLSearchParams({ q: `${artist} ${title}` })}`);
	};
	await find(names[0]);
	// Romanized titles often aren't found: try the original ones
	if (!best(records, duration)?.syncedLyrics) {
		const unicode = await unicodeNames(song.id);
		if (unicode && (unicode.title !== song.title || unicode.artist !== song.artist)) {
			await find({ title: cleanTitle(unicode.title ?? ''), artist: unicode.artist ?? '' });
		}
	}
	const found = best(records, duration);
	if (!found) {
		if (failure) throw failure;
		return null;
	}
	const lines = found.syncedLyrics ? parseLrc(found.syncedLyrics) : null;
	return {
		lines: lines?.length ? lines : null,
		plain: found.plainLyrics,
		instrumental: found.instrumental,
		otherVersion: !!lines?.length && Math.abs(found.duration - duration) > SAME_LENGTH,
		source: { track: found.trackName, artist: found.artistName }
	};
}

export function lyricsKey(song: MapSet | null | undefined) {
	return song ? `${song.id}:${song.beatmaps?.[0]?.id ?? ''}` : null;
}

let loadingKey: string | null = null;

/** Loads the lyrics of the current song */
export async function loadLyrics() {
	const song = get(currentSong).song;
	const key = lyricsKey(song);
	if (!song || !key) {
		lyrics.set({ key: null, status: 'idle', lyrics: null });
		return;
	}
	if (cache.has(key)) {
		const cached = cache.get(key)!;
		lyrics.set({ key, status: cached ? 'found' : 'none', lyrics: cached });
		return;
	}
	if (loadingKey === key) return;
	loadingKey = key;
	lyrics.set({ key, status: 'loading', lyrics: null });
	try {
		const audio = get(songQueue).audio;
		const duration =
			(audio?.duration && isFinite(audio.duration) ? audio.duration : 0) ||
			Number(song.beatmaps?.[0]?.total_length) ||
			0;
		const found = await search(song, duration);
		if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
		cache.set(key, found);
		if (lyricsKey(get(currentSong).song) === key) {
			lyrics.set({ key, status: found ? 'found' : 'none', lyrics: found });
		}
	} catch (error) {
		console.error('Could not load the lyrics:', error);
		if (lyricsKey(get(currentSong).song) === key) {
			lyrics.set({ key, status: 'error', lyrics: null });
			// Try once more by itself a bit later, while the song still plays
			if (!retried.has(key)) {
				retried.add(key);
				setTimeout(() => {
					if (lyricsKey(get(currentSong).song) === key && get(lyrics).status === 'error')
						loadLyrics();
				}, 8000);
			}
		}
	} finally {
		loadingKey = null;
	}
}

const retried = new Set<string>();

// --- Romaji -------------------------------------------------------------------------

export interface ShownLyrics {
	key: string | null;
	/** The synced lines' texts as shown (romaji if turned on), by index */
	lines: string[] | null;
	plain: string | null;
	/** The lyrics have Japanese in them */
	japanese: boolean;
	/** Loading the dictionary or converting */
	converting: boolean;
	error: boolean;
}

/** The lyrics' text as shown: in romaji when that's turned on and they have Japanese */
export const shownLyrics = writable<ShownLyrics>({
	key: null,
	lines: null,
	plain: null,
	japanese: false,
	converting: false,
	error: false
});

export function setLyricsRomaji(on: boolean) {
	updateUserSettings({ lyricsRomaji: on });
}

let converting = '';

async function updateShown() {
	const state = get(lyrics);
	const found = state.status === 'found' ? state.lyrics : null;
	const original = {
		key: state.key,
		lines: found?.lines?.map((line) => line.text) ?? null,
		plain: found?.plain ?? null
	};
	const japanese = hasJapanese(original.lines?.join('\n') ?? original.plain);
	const romaji = japanese && (get(userSettings).settings?.lyricsRomaji ?? false);
	const job = `${state.key}:${state.status}:${romaji}`;
	if (job === converting) return;
	converting = job;
	if (!romaji) {
		shownLyrics.set({ ...original, japanese, converting: false, error: false });
		return;
	}
	shownLyrics.set({ ...original, japanese, converting: true, error: false });
	try {
		const [lines, plain] = await Promise.all([
			original.lines ? romanize(original.lines) : null,
			original.plain ? romanize(original.plain.split('\n')).then((l) => l.join('\n')) : null
		]);
		if (converting === job)
			shownLyrics.set({ key: state.key, lines, plain, japanese, converting: false, error: false });
	} catch (error) {
		console.error('Could not convert the lyrics to romaji:', error);
		if (converting === job)
			shownLyrics.set({ ...original, japanese, converting: false, error: true });
	}
}

if (typeof window !== 'undefined') {
	lyrics.subscribe(updateShown);
	let lastRomaji: boolean | undefined;
	userSettings.subscribe(({ settings }) => {
		if (settings?.lyricsRomaji === lastRomaji) return;
		lastRomaji = settings?.lyricsRomaji;
		updateShown();
	});
}

// --- Timing -------------------------------------------------------------------------

/** How much earlier the lyrics of the song come (seconds), for versions that are off */
export const lyricsOffset = derived([userSettings, lyrics], ([settings, state]) =>
	state.key ? (settings.settings?.lyricsOffsets?.[state.key] ?? 0) : 0
);

/** Moves the lyrics later (positive seconds) or earlier (negative) */
export function nudgeLyrics(seconds: number) {
	const key = get(lyrics).key;
	if (!key) return;
	const offsets = { ...get(userSettings).settings?.lyricsOffsets };
	const next = Math.round(((offsets[key] ?? 0) - seconds) * 10) / 10;
	if (next) offsets[key] = next;
	else delete offsets[key];
	updateUserSettings({ lyricsOffsets: offsets });
}

/** The index of the line being sung at a time, or -1 before the first */
export function lineAt(lines: LyricLine[], time: number) {
	let low = 0;
	let high = lines.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lines[mid].time <= time) {
			found = mid;
			low = mid + 1;
		} else high = mid - 1;
	}
	return found;
}

if (typeof window !== 'undefined') {
	// Load the lyrics of each new song while they're shown
	let lastKey: string | null = null;
	const update = () => {
		const key = lyricsKey(get(currentSong).song);
		if (!get(lyricsWanted) || key === lastKey) return;
		lastKey = key;
		loadLyrics();
	};
	currentSong.subscribe(update);
	lyricsWanted.subscribe((wanted) => {
		if (!wanted) lastKey = null;
		update();
	});
}
