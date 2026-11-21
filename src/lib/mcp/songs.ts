// Songs as Claude sees them: a short description each, with an id the other tools take,
// and from those ids back to songs that play (the library's, or osu!'s).

import { get } from 'svelte/store';
import { fetchBeatmapset, libraryByKey, librarySetSongs, mapDataStore } from '../stores/data';
import { favourites } from '../stores/favourites';
import { history, playCounts, type HistorySong, type SongPlays } from '../stores/history';
import { songFromSearch } from '../stores/smartPlaylists';
import { songBpm } from '../songBpm';
import { GENRES, LANGUAGES, englishName } from '../genres';
import { songKey, trackOf } from '../tracks';
import type { MapSet } from '../types';

/** A tool was asked for something it can't do: Claude reads the message */
export class ToolError extends Error {}

// --- Ids -------------------------------------------------------------------------------------

/** The id of a song for Claude: the set id, with ":track" for the further songs of a set */
export const songId = (song: { id: number | string; track?: number }) =>
	song.track ? `${song.id}:${song.track}` : String(song.id);

/** A song id (or an osu! link) as set id and track; null if it's none */
export function parseSongId(value: unknown): { set: string; track: number } | null {
	const text = String(value ?? '').trim();
	const link = text.match(/beatmapsets\/(\d+)/);
	if (link) return { set: link[1], track: 0 };
	const id = text.match(/^(\d+)(?::(\d+))?$/);
	return id ? { set: id[1], track: Number(id[2] ?? 0) } : null;
}

// --- What the user thinks of songs -------------------------------------------------------------

export interface Taste {
	plays: Map<string, SongPlays>;
	/** Liked songs, by key */
	liked: Set<string>;
}

export function taste(): Taste {
	const data = get(mapDataStore);
	return {
		plays: playCounts(),
		liked: new Set(get(favourites).map((f) => `${f.setId}:${trackOf(data[f.setId], f.mapId)}`))
	};
}

// --- Describing ------------------------------------------------------------------------------

const DAY = 86400;
const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A date of the user's (local) calendar, like 2026-11-21 */
export function day(seconds: number) {
	const date = new Date(seconds * 1000);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A moment in local time with its weekday, like "Sat 2026-11-21 22:15" */
export function moment(seconds: number) {
	const date = new Date(seconds * 1000);
	return `${WEEKDAYS[date.getDay()]} ${day(seconds)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * osu!'s genre or language as its English name (the library keeps names, maybe in the user's
 * language, osu!'s API objects or ids)
 */
export function named(value: any, names: Record<number, string>, id?: unknown) {
	const name = typeof value === 'string' ? value : (value?.name ?? names[Number(id)] ?? null);
	return name && !/^(unspecified|any)$/i.test(name) ? englishName(name) : null;
}

/** Where a song is from (an anime, a game…): songs imported from osu! have 'osu' as source */
export const sourceOf = (song: MapSet) =>
	song.songSource || (song.source && song.source !== 'osu' ? song.source : '') || null;

export const isDownloaded = (song: MapSet) => !!get(mapDataStore)[String(song.id)];

/** The song's tempo: from the timing of a downloaded one, else what osu! says */
export function tempoOf(song: MapSet) {
	const data = get(mapDataStore);
	const own = data[String(song.id)] ? songBpm(song, data) : 0;
	const bpm = Number(own || song.bpm) || 0;
	// (joke maps have 6 billion BPM, or 1)
	return bpm >= 20 && bpm <= 1000 ? Math.round(bpm) : null;
}

export const lengthOf = (song: MapSet) =>
	Math.round(Number(song.beatmaps?.[0]?.total_length) || 0) || null;

/** What osu! says about a set (search results, details): status, popularity, stars */
function osuFacts(song: MapSet) {
	const facts: Record<string, unknown> = {};
	if (song.status && song.source !== 'osu') facts.status = song.status;
	if (Number(song.play_count) > 0) facts.osu_plays = Number(song.play_count);
	if (Number(song.favourite_count) > 0) facts.favourites = Number(song.favourite_count);
	const stars = (song.beatmaps ?? [])
		.map((map) => Number(map.difficulty_rating))
		.filter((rating) => rating > 0);
	if (stars.length) {
		const low = Math.min(...stars).toFixed(1);
		const high = Math.max(...stars).toFixed(1);
		facts.stars = low === high ? Number(low) : `${low}-${high}`;
	}
	const modes = [...new Set((song.beatmaps ?? []).map((map) => map.mode).filter(Boolean))];
	if (modes.some((mode) => mode !== 'osu')) facts.modes = modes;
	const year = String(song.ranked_date ?? song.submitted_date ?? '').slice(0, 4);
	if (/^\d{4}$/.test(year)) facts.year = Number(year);
	return facts;
}

/**
 * A song as Claude sees it: what it is, whether it's downloaded and what the user thinks of
 * it. Empty and unknown things are left out (they'd only cost Claude reading).
 */
export function describe(
	song: MapSet,
	known: Taste,
	{ osu = false, ...extra }: { osu?: boolean } & Record<string, unknown> = {}
) {
	const key = songKey(song);
	const out: Record<string, unknown> = {
		id: songId(song),
		title: song.title ?? '',
		artist: song.artist ?? ''
	};
	const add = (name: string, value: unknown) => {
		if (value !== null && value !== undefined && value !== '' && value !== false) out[name] = value;
	};
	add('source', sourceOf(song));
	add('genre', named(song.genre, GENRES, song.genre_id));
	add('language', named(song.language, LANGUAGES, song.language_id));
	add('bpm', tempoOf(song));
	add('length', lengthOf(song));
	add('mapper', song.creator);
	out.downloaded = isDownloaded(song);
	const entry = known.plays.get(key);
	if (entry) {
		add('plays', entry.plays || null);
		add('skips', entry.skips || null);
		add('last_played', entry.last ? day(entry.last) : null);
	}
	add('liked', known.liked.has(key));
	if (osu) Object.assign(out, osuFacts(song));
	for (const [name, value] of Object.entries(extra)) add(name, value);
	return out;
}

/** Just enough to know a song again (in long lists like the history) */
export const brief = (song: {
	id: number | string;
	track?: number;
	title?: string;
	artist?: string;
}) => ({
	id: songId(song),
	title: song.title ?? '',
	artist: song.artist ?? ''
});

// --- From ids back to songs ------------------------------------------------------------------

/** Songs the tools found on osu! lately, by key: asked about again, they're known already */
const seen = new Map<string, MapSet>();
const SEEN_KEPT = 5000;

export function remember(songs: MapSet[]) {
	for (const song of songs) {
		const key = songKey(song);
		seen.delete(key);
		seen.set(key, song);
	}
	// (the oldest go)
	for (const key of seen.keys()) {
		if (seen.size <= SEEN_KEPT) break;
		seen.delete(key);
	}
}

/** A song from what the history kept of it (when osu! can't be asked) */
export function fromHistory(key: string, kept: HistorySong): MapSet {
	return {
		id: kept.setId,
		track: kept.track || undefined,
		title: kept.title,
		artist: kept.artist,
		creator: kept.creator,
		genre: kept.genre,
		language: kept.language,
		songSource: kept.source ?? '',
		bpm: kept.bpm ?? undefined,
		preview_url: `//b.ppy.sh/preview/${kept.setId}.mp3`,
		beatmaps: kept.mapId != null ? [{ id: kept.mapId }] : []
	};
}

/** The library's song of a key, else what the history kept of it */
export function songOfKey(key: string, kept?: HistorySong): MapSet | null {
	const own = libraryByKey().get(key);
	if (own) return own;
	const known = seen.get(key);
	if (known) return known;
	const fromKept = kept ?? get(history).songs[key];
	return fromKept ? fromHistory(key, fromKept) : null;
}

/** osu!'s sets asked for lately, by id */
const fetched = new Map<string, Promise<MapSet | null>>();

/** A set from osu! with all its difficulties (once; null if osu! doesn't have it) */
export function osuSet(setId: string): Promise<MapSet | null> {
	let set = fetched.get(setId);
	if (!set) {
		set = fetchBeatmapset(setId)
			.then((raw) => {
				const song = songFromSearch(raw);
				remember([song]);
				return song;
			})
			.catch(() => {
				// (tried again the next time it's asked for)
				fetched.delete(setId);
				return null;
			});
		fetched.set(setId, set);
	}
	return set;
}

/** At most this many sets are asked for at once */
const AT_ONCE = 6;

/**
 * The songs of these ids, in their order, each once: downloaded ones from the library, others
 * as osu! has them. `missing` are the ids that aren't songs (or osu! doesn't know).
 */
export async function resolveSongs(
	ids: unknown[]
): Promise<{ songs: MapSet[]; missing: string[] }> {
	const library = libraryByKey();
	const kept = get(history).songs;
	const found: (MapSet | null)[] = [];
	const missing: string[] = [];
	const ask = new Map<string, number[]>();
	/** The key of each found song */
	const keys: string[] = [];
	(Array.isArray(ids) ? ids : [ids]).forEach((raw) => {
		const id = parseSongId(raw);
		if (!id) {
			missing.push(String(raw));
			return;
		}
		const key = `${id.set}:${id.track}`;
		if (keys.includes(key)) return;
		keys.push(key);
		const index = found.length;
		const own =
			library.get(key) ??
			(id.track === 0 ? librarySetSongs(id.set)[0] : undefined) ??
			seen.get(key) ??
			(id.track === 0 ? seen.get(`${id.set}:0`) : undefined);
		found.push(own ?? null);
		if (!own) ask.set(id.set, [...(ask.get(id.set) ?? []), index]);
	});
	const sets = [...ask.keys()];
	for (let i = 0; i < sets.length; i += AT_ONCE) {
		const batch = sets.slice(i, i + AT_ONCE);
		const answers = await Promise.all(batch.map(osuSet));
		batch.forEach((setId, j) => {
			for (const index of ask.get(setId) ?? []) {
				const key = keys[index];
				found[index] = answers[j] ?? (kept[key] ? fromHistory(key, kept[key]) : null);
			}
		});
	}
	// (without a difficulty a song can't play nor go into a playlist)
	found.forEach((song, index) => {
		if (!song?.beatmaps?.[0]?.id) {
			found[index] = null;
			missing.push(songIdOfKey(keys[index]));
		}
	});
	return { songs: found.filter((song): song is MapSet => !!song), missing };
}

const songIdOfKey = (key: string) => {
	const [set, track] = key.split(':');
	return Number(track) ? key : set;
};

/** The days in seconds, for the tools' time spans */
export const DAYS = DAY;
