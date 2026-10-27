import { sameSong, trackOf } from '../tracks';
import { showToast } from './toast';
import { fetch } from '@tauri-apps/plugin-http';
import { get, writable } from 'svelte/store';
import { keyStore, freshToken } from './auth';
import { librarySongs, mapDataStore } from './data';
import * as api from '../api';
import { load } from '@tauri-apps/plugin-store';
import { offline, noteNetworkError } from './network';
import type { MapSet, Playlist, PlaylistId } from '../types';

export const playlists = writable<Playlist[]>([]);

export const playlistSongsCache = writable<Record<string, { songs: MapSet[] }>>({});
export const playlistLoadingStatus = writable<Record<string, boolean>>({});

const token = () => get(keyStore).access_token;

// --- A copy of the library on this computer, for when there's no connection --------------

type OfflineCopy = {
	playlists: Playlist[];
	songs: Record<string, { songs: MapSet[] }>;
	saved: Playlist[];
};
let offlineCopy: Promise<OfflineCopy | null> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Kept in a file for the list of playlists, one file for each playlist's songs and one for
// the beatmap sets they're of: a change writes just the playlist that changed (not the whole
// library: with thousands of songs that took the app a moment each time), and a set that's in
// several playlists is kept once

const INDEX_FILE = 'offline-library.json';
const SETS_FILE = 'offline-sets.json';
const songsFile = (playlistId: string) => `offline-playlist-${playlistId}.json`;

interface OfflineIndex {
	version: 2;
	playlists: Playlist[];
	saved: Playlist[];
	/** The playlists that have a file of songs */
	ids: string[];
}

/** What was written last: each playlist's songs (the very list of the cache) and the index */
const written = new Map<string, { songs: MapSet[] }>();
let writtenIndex = '';
/** The sets as written, and which of them each playlist's songs are of */
let sharedSets: Record<string, any> = {};
const setsOf = new Map<string, Set<string>>();
const setIds = (packed: PackedSongs) =>
	new Set<string>(
		packed.songs.filter((song) => song[SET] != null).map((song) => String(song[SET]))
	);

/** The library as it was the last time the app was online */
export function offlineLibrary() {
	offlineCopy ??= readOfflineCopy().catch(() => null);
	return offlineCopy;
}

async function readOfflineCopy(): Promise<OfflineCopy | null> {
	const kept = await (await load(INDEX_FILE)).get<any>('library');
	if (!kept) return null;
	// A copy from before, all in one (it's kept the new way the next time)
	if (kept.version !== 2) return unpackOld(kept);
	const index = kept as OfflineIndex;
	sharedSets = (await (await load(SETS_FILE)).get<Record<string, any>>('sets')) ?? {};
	const songs: OfflineCopy['songs'] = {};
	await Promise.all(
		index.ids.map(async (id) => {
			const one = await (await load(songsFile(id))).get<PackedSongs>('songs').catch(() => null);
			if (!one) return;
			songs[id] = { songs: unpackSongs({ sets: one.sets ?? sharedSets, songs: one.songs }) };
			// (the cache starts with this very list: unchanged, it isn't written again; one with
			// its own sets, from before they were shared, is written the new way once)
			if (one.sets) return;
			written.set(id, songs[id]);
			setsOf.set(id, setIds(one));
		})
	);
	writtenIndex = JSON.stringify({ playlists: index.playlists, saved: index.saved, ids: index.ids });
	return { playlists: index.playlists, songs, saved: index.saved };
}

// A playlist's songs as they're written: each beatmap set once, the songs and their
// difficulties pointing to it (from osu! every song and every difficulty of it came with the
// whole set, so a big playlist was mostly the same sets again and again)

interface PackedSongs {
	/** The sets the songs are of (written in the shared file: only in files from before) */
	sets?: Record<string, any>;
	songs: any[];
}
/** Where a song or difficulty points to its set */
const SET = '$set';
/** What osu! sends with each difficulty that isn't used (how far players got: 200 numbers) */
const UNUSED = new Set(['failtimes']);

const same = (a: unknown, b: unknown) =>
	a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));

function packSongs(list: MapSet[]): PackedSongs {
	const sets: Record<string, any> = {};
	const packMap = (map: any) => {
		const kept: any = {};
		for (const [key, value] of Object.entries<any>(map)) {
			if (UNUSED.has(key)) continue;
			if (key === 'beatmapset') {
				sets[value.id] ??= value;
				kept[SET] = value.id;
			} else kept[key] = value;
		}
		return kept;
	};
	const songs = list.map((song) => {
		// (a song added from the library or the search has no set with it: kept as it is)
		const set = song.beatmaps?.find((map) => map?.beatmapset)?.beatmapset;
		if (!set) return song;
		const kept: any = {};
		for (const [key, value] of Object.entries(song)) {
			if (key === 'beatmaps')
				kept.beatmaps = value.map((map: any) => (map?.beatmapset ? packMap(map) : map));
			// (copies from before had the beatmap in there again)
			else if (key === 'songInfo') kept.songInfo = { ...value, beatmap: undefined };
			// (what the song has of its set is the set's, unless the song has its own, e.g. title)
			else if (!(key in set) || !same(value, set[key])) kept[key] = value;
		}
		kept[SET] = set.id;
		return kept;
	});
	return { sets, songs };
}

function unpackSongs({ sets = {}, songs }: PackedSongs): MapSet[] {
	const unpackMap = (map: any) => {
		if (map?.[SET] == null) return map;
		const { [SET]: setId, ...rest } = map;
		return { ...rest, beatmapset: sets[setId] };
	};
	return (songs ?? []).map((song: any) => {
		if (song[SET] == null) return song;
		const { [SET]: setId, ...rest } = song;
		return { ...sets[setId], ...rest, beatmaps: (rest.beatmaps ?? []).map(unpackMap) };
	});
}

/** A copy from before: all playlists in one, the sets once for all of them (or not at all) */
function unpackOld(kept: OfflineCopy & { sets?: Record<string, any> }): OfflineCopy {
	if (!kept.sets) return kept;
	const songs: OfflineCopy['songs'] = {};
	for (const [id, list] of Object.entries(kept.songs ?? {})) {
		songs[id] = { songs: unpackSongs({ sets: kept.sets, songs: list?.songs ?? [] }) };
	}
	return { playlists: kept.playlists, songs, saved: kept.saved };
}

/** Keeps the playlists and their songs on this computer (a moment after they change) */
function keepOffline() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(async () => {
		const cache = get(playlistSongsCache);
		// (the downloaded songs are on this computer anyway)
		const ids = Object.keys(cache).filter((id) => id !== '-1');
		const copy: OfflineCopy = {
			playlists: get(playlists).filter((p) => Number(p.id) > 0 || p.id == -2),
			songs: Object.fromEntries(ids.map((id) => [id, cache[id]])),
			saved: get(savedPlaylists)
		};
		offlineCopy = Promise.resolve(copy);
		try {
			// Only the playlists that changed (a changed one is a new list in the cache)
			const changed = ids
				.filter((id) => written.get(id) !== cache[id])
				.map((id) => ({ id, entry: cache[id], packed: packSongs(cache[id].songs ?? []) }));
			for (const { id, packed } of changed) setsOf.set(id, setIds(packed));
			for (const id of [...setsOf.keys()]) if (!ids.includes(id)) setsOf.delete(id);
			// The sets first (a playlist written before its sets would point to nothing): the
			// new ones in, the ones no playlist has anymore out
			const used = new Set([...setsOf.values()].flatMap((sets) => [...sets]));
			let setsChanged = false;
			for (const { packed } of changed) {
				for (const [setId, set] of Object.entries(packed.sets ?? {})) {
					if (!sharedSets[setId]) {
						sharedSets[setId] = set;
						setsChanged = true;
					}
				}
			}
			for (const setId of Object.keys(sharedSets)) {
				if (!used.has(setId)) {
					delete sharedSets[setId];
					setsChanged = true;
				}
			}
			if (setsChanged) {
				const store = await load(SETS_FILE);
				await store.set('sets', sharedSets);
				await store.save();
			}
			for (const { id, entry, packed } of changed) {
				const store = await load(songsFile(id));
				await store.set('songs', { songs: packed.songs } satisfies PackedSongs);
				await store.save();
				written.set(id, entry);
			}
			const index = { playlists: copy.playlists, saved: copy.saved, ids };
			const indexText = JSON.stringify(index);
			if (indexText !== writtenIndex) {
				const store = await load(INDEX_FILE);
				await store.set('library', { version: 2, ...index } satisfies OfflineIndex);
				await store.save();
				writtenIndex = indexText;
			}
			// The songs of playlists that are gone
			for (const id of [...written.keys()]) {
				if (ids.includes(id)) continue;
				const store = await load(songsFile(id));
				await store.clear();
				await store.save();
				written.delete(id);
			}
		} catch (error) {
			console.warn('Could not keep the library for offline use:', error);
		}
	}, 3000);
}

// --- Changes to a playlist: one after another, tried again, and checked with the server ----

const queues = new Map<string, Promise<unknown>>();
const pending = new Map<string, number>();
/** How many changes each playlist has had (a load that began before one is out of date) */
const edits = new Map<string, number>();
const RETRIES = 3;

/** Errors trying again won't fix */
const final = (error: unknown) =>
	/not found|already in playlist|not owned/i.test(error instanceof Error ? error.message : '');

/**
 * Runs a change of a playlist after the ones before it (quick clicks stay in order), tries
 * it again if the connection hiccups, and once the playlist's changes are done, takes its
 * songs and count from the server, so what's shown is what's saved
 */
function change<T>(playlistId: PlaylistId, run: () => Promise<T>, what: string): Promise<T | null> {
	const key = String(playlistId);
	pending.set(key, (pending.get(key) ?? 0) + 1);
	edits.set(key, (edits.get(key) ?? 0) + 1);
	const job = (queues.get(key) ?? Promise.resolve()).then(async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await run();
			} catch (error) {
				if (final(error) || attempt >= RETRIES - 1) {
					console.error(`Could not ${what}:`, error);
					showToast(
						`Couldn't ${what}. The playlist shows what's saved.`,
						'icon-[mingcute--warning-line]'
					);
					failed.add(key);
					return null;
				}
				await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
			}
		}
	});
	queues.set(
		key,
		job.catch(() => null)
	);
	job.finally(() => {
		const left = (pending.get(key) ?? 1) - 1;
		pending.set(key, left);
		if (left === 0) {
			queues.delete(key);
			refreshFromServer(playlistId);
		}
	});
	return job;
}

const failed = new Set<string>();

/** After changes: the playlist's count (and after a failure its songs) from the server */
async function refreshFromServer(playlistId: PlaylistId) {
	const key = String(playlistId);
	try {
		const saved = (await api.getPlaylists(token())).find((p) => p.id == playlistId);
		if (saved) {
			playlists.update((list) =>
				list.map((p) => (p.id == playlistId ? { ...p, song_amount: saved.song_amount } : p))
			);
		}
		if (failed.delete(key)) await getPlaylistSongs(playlistId, true);
	} catch (error) {
		console.warn('Could not check the playlist with the server:', error);
	}
}

export async function getPlaylists(accessToken: string): Promise<Playlist[]> {
	return api.getPlaylists(accessToken);
}

export async function createPlaylist(title: string): Promise<Playlist> {
	return api.createPlaylist(token(), title);
}

export async function deletePlaylist(id: PlaylistId) {
	await api.deletePlaylist(token(), Number(id));
}

export async function editPlaylist(
	id: PlaylistId,
	title: string,
	description: string,
	isPublic: boolean,
	imageFile: File | null = null
): Promise<Playlist> {
	return api.editPlaylist(
		token(),
		{ id: Number(id), title, description, public: isPublic },
		imageFile
	);
}

export async function addSongToPlaylist(playlistId: PlaylistId, mapSetData: MapSet) {
	const setId = mapSetData.id;
	const mapId = mapSetData.beatmaps[0].id;

	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}
		const newSong = {
			...mapSetData,
			songInfo: {
				id: null,
				set_id: setId,
				map_id: mapId,
				created_at: new Date().toISOString()
			},
			created_at: new Date().toISOString()
		};
		let updatedSongs = [...cache[playlistId].songs, newSong];
		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});

	const songInfo = await change(
		playlistId,
		() => api.addSongToPlaylist(token(), Number(playlistId), Number(setId), Number(mapId)),
		`add "${mapSetData.title}" to the playlist`
	);
	if (!songInfo) return null;

	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}

		const updatedSongs = cache[playlistId].songs.map((song, index) => {
			if (index === cache[playlistId].songs.length - 1 && sameSong(song, mapSetData)) {
				return {
					...song,
					songInfo
				};
			}
			return song;
		});

		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});

	return songInfo;
}

export async function removeSongFromPlaylist(playlistId: PlaylistId, songId: number) {
	const updatedPlaylists = get(playlists).map((p) => {
		if (p.id == playlistId) {
			return { ...p, song_amount: Math.max(0, p.song_amount - 1) };
		}
		return p;
	});

	playlists.set(updatedPlaylists);
	playlistSongsCache.update((cache) => {
		if (!cache[playlistId] || !cache[playlistId].songs) {
			return cache;
		}

		const updatedSongs = cache[playlistId].songs.filter((song) => song.songInfo?.id !== songId);

		return {
			...cache,
			[playlistId]: { songs: updatedSongs }
		};
	});
	await change(
		playlistId,
		() => api.removeSongFromPlaylist(token(), Number(playlistId), songId),
		'remove the song'
	);
}

/** Moves the song at index `from` of a playlist to index `to` (drag and drop) */
export async function moveSongInPlaylist(playlistId: PlaylistId, from: number, to: number) {
	const songs = get(playlistSongsCache)[playlistId]?.songs;
	if (!songs || from === to || !songs[from] || !songs[to]) return;
	const moved = songs[from];
	const target = songs[to].songInfo.position;
	// Show the new order right away; the songs keep the positions of their new places
	const positions = songs.map((song) => song.songInfo.position);
	const reordered = [...songs];
	reordered.splice(to, 0, ...reordered.splice(from, 1));
	playlistSongsCache.update((cache) => ({
		...cache,
		[playlistId]: {
			songs: reordered.map((song, i) => ({
				...song,
				songInfo: { ...song.songInfo, position: positions[i] }
			}))
		}
	}));
	await change(
		playlistId,
		() => api.moveSongInPlaylist(token(), Number(playlistId), moved.songInfo.id, target),
		'save the new order'
	);
}

/**
 * The osu! beatmaps (each with its set) of the songs of all playlists known on this computer,
 * by id: from the copy kept from before, and what was asked for since
 */
let beatmapIndex: Promise<Map<string, any>> | null = null;
function knownBeatmaps() {
	beatmapIndex ??= offlineLibrary().then((kept) => {
		const known = new Map<string, any>();
		for (const { songs } of Object.values(kept?.songs ?? {})) {
			for (const song of songs ?? []) {
				// (a song added from the library or the search has no set with it: asked for)
				for (const map of song.beatmaps ?? []) if (map?.beatmapset) known.set(String(map.id), map);
			}
		}
		return known;
	});
	return beatmapIndex;
}

/**
 * Beatmaps osu! didn't have (deleted, or hidden), by id with when: not asked for again at
 * each start, only once a week (one might be back)
 */
const MISSING_FILE = 'offline-missing.json';
const ASK_AGAIN_AFTER = 7 * 24 * 3600 * 1000;
let missingBeatmaps: Promise<Record<string, number>> | null = null;
function missingMaps() {
	missingBeatmaps ??= load(MISSING_FILE)
		.then((store) => store.get<Record<string, number>>('missing'))
		.then((missing) => missing ?? {})
		.catch(() => ({}));
	return missingBeatmaps;
}

/** What osu! answered for these ids: the ones it didn't have are noted, the ones back aren't */
async function noteMissing(asked: string[], found: Set<string>) {
	const missing = await missingMaps();
	let changed = false;
	for (const id of asked) {
		if (!found.has(id)) {
			missing[id] = Date.now();
			changed = true;
		} else if (id in missing) {
			delete missing[id];
			changed = true;
		}
	}
	if (!changed) return;
	try {
		const store = await load(MISSING_FILE);
		await store.set('missing', missing);
		await store.save();
	} catch (error) {
		console.warn('Could not keep the missing beatmaps:', error);
	}
}

/** At most this many beatmaps per request (osu!'s limit), and this many requests at a time */
const BEATMAPS_PER_REQUEST = 50;
const REQUESTS_AT_ONCE = 4;

/** A request osu! turned down is tried again this often */
const BEATMAP_RETRIES = 3;
/** Waited at most this long before trying again (ms) */
const LONGEST_WAIT = 30_000;

/**
 * One request for osu!'s beatmaps: tried again when osu! has too much to do (429), hiccups
 * (5xx) or the token ran out (401), after as long as it asks for. Without a connection it
 * fails right away (the playlist then shows its songs from before).
 */
async function fetchBeatmapChunk(mapIds: string[]): Promise<any[]> {
	const url = `https://osu.ppy.sh/api/v2/beatmaps?ids[]=${mapIds.join('&ids[]=')}`;
	let status = 0;
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${await freshToken(status === 401)}`,
				'Content-Type': 'application/json'
			}
		});
		if (response.ok) return (await response.json()).beatmaps ?? [];
		status = response.status;
		const worthAgain = status === 401 || status === 429 || status >= 500;
		if (!worthAgain || attempt >= BEATMAP_RETRIES) {
			throw new Error(`OSU API error! status: ${status}`);
		}
		const asked = Number(response.headers.get('retry-after')) * 1000;
		const wait = asked > 0 ? asked : 1000 * 2 ** attempt;
		await new Promise((resolve) => setTimeout(resolve, Math.min(wait, LONGEST_WAIT)));
	}
}

/** osu!'s beatmaps (each with its set) of these ids */
async function fetchBeatmaps(mapIds: string[]): Promise<any[]> {
	const chunks: string[][] = [];
	for (let i = 0; i < mapIds.length; i += BEATMAPS_PER_REQUEST) {
		chunks.push(mapIds.slice(i, i + BEATMAPS_PER_REQUEST));
	}
	const found: any[] = [];
	for (let i = 0; i < chunks.length; i += REQUESTS_AT_ONCE) {
		const results = await Promise.all(chunks.slice(i, i + REQUESTS_AT_ONCE).map(fetchBeatmapChunk));
		for (const beatmaps of results) {
			for (const beatmap of beatmaps) for (const key of UNUSED) delete beatmap[key];
			found.push(...beatmaps);
		}
	}
	return found;
}

const songSignature = (song: MapSet) =>
	`${song.songInfo?.id ?? ''}:${song.id}:${song.track ?? 0}:${song.title}:${song.beatmaps?.length}`;
const sameSongs = (a: MapSet[], b: MapSet[]) =>
	a.length === b.length && a.every((song, i) => songSignature(song) === songSignature(b[i]));

/**
 * A playlist's songs as the server has them, into the cache. Not over changes made since the
 * load began (they'd be undone on screen; the playlist is checked with the server once they
 * are done), and unchanged it stays the very same list: nothing to show or keep again.
 */
function storeSongs(playlistId: PlaylistId, songs: MapSet[], editsBefore: number) {
	const key = String(playlistId);
	const cache = get(playlistSongsCache);
	const before = cache[playlistId];
	if (before) {
		const changedSince = (edits.get(key) ?? 0) !== editsBefore || (pending.get(key) ?? 0) > 0;
		if (changedSince || sameSongs(before.songs ?? [], songs)) return before;
	}
	const entry = { songs };
	playlistSongsCache.set({ ...cache, [playlistId]: entry });
	return entry;
}

export async function getPlaylistSongs(
	playlistId: PlaylistId,
	forceRefresh = false
): Promise<{ songs: MapSet[]; error?: string }> {
	if (!forceRefresh && get(playlistSongsCache)[playlistId]) {
		return get(playlistSongsCache)[playlistId];
	}
	const editsBefore = edits.get(String(playlistId)) ?? 0;
	playlistLoadingStatus.update((status) => ({
		...status,
		[playlistId]: true
	}));

	try {
		if (playlistId == -1) {
			const songs = librarySongs();

			playlistSongsCache.update((cache) => ({
				...cache,
				[playlistId]: { songs }
			}));

			return { songs };
		}

		// Liked Songs (-2): the favourites, newest first
		const playlistSongs =
			playlistId == -2
				? (await api.getFavourites(token())).map((song, index) => ({ ...song, position: index }))
				: await api.getPlaylistSongs(token(), Number(playlistId));

		if (playlistSongs.length === 0) return storeSongs(playlistId, [], editsBefore);

		// What osu! knows about the songs: asked only for the ones no playlist knew yet (one
		// unchanged since the last time asks for none)
		const known = await knownBeatmaps();
		const missing = await missingMaps();
		const beatmapsById = new Map<string, any>();
		const unknown: string[] = [];
		for (const mapId of new Set(playlistSongs.map((song) => String(song.map_id)))) {
			const beatmap = known.get(mapId);
			if (beatmap) beatmapsById.set(mapId, beatmap);
			// (one osu! didn't have a moment ago isn't asked for again yet)
			else if (Date.now() - (missing[mapId] ?? 0) >= ASK_AGAIN_AFTER) unknown.push(mapId);
		}
		const fetched = await fetchBeatmaps(unknown);
		for (const beatmap of fetched) {
			beatmapsById.set(String(beatmap.id), beatmap);
			known.set(String(beatmap.id), beatmap);
		}
		if (unknown.length) noteMissing(unknown, new Set(fetched.map((map) => String(map.id))));

		const enhancedSongs = playlistSongs.map((song) => {
			const beatmap = beatmapsById.get(String(song.map_id));

			return {
				id: song.id,
				set_id: song.set_id,
				map_id: song.map_id,
				position: song.position,
				created_at: song.created_at,
				updated_at: song.updated_at,
				beatmap: beatmap || null
			};
		});

		const beatmapsetGroups: Record<string, MapSet> = {};

		const downloaded = get(mapDataStore);
		// Sets that are in the playlist with several of their difficulties (sets with several
		// songs): not downloaded, each is its own song, named with its difficulty
		const mapsOfSet = new Map<string, Set<string>>();
		for (const song of enhancedSongs) {
			const setId = String(song.beatmap?.beatmapset?.id ?? '');
			if (!setId || downloaded[setId]) continue;
			mapsOfSet.set(setId, (mapsOfSet.get(setId) ?? new Set()).add(String(song.beatmap.id)));
		}
		enhancedSongs.forEach((song) => {
			if (!song.beatmap || !song.beatmap.beatmapset) return;

			const beatmapsetId = song.beatmap.beatmapset.id;
			// Sets with several songs: each song of the set is its own entry
			const stored = downloaded[beatmapsetId];
			const several = [...(mapsOfSet.get(String(beatmapsetId)) ?? [])];
			const guessed = several.length > 1 ? several.indexOf(String(song.beatmap.id)) : -1;
			const track = stored ? trackOf(stored, song.beatmap.id) : Math.max(0, guessed);
			const key = `${beatmapsetId}:${track}`;
			const local = stored?.beatmaps?.[song.beatmap.id];
			const named = stored
				? track
					? {
							// The track's own name; the set's where the difficulty has none (an
							// undefined one would replace the set's and leave the row empty)
							title: local?.title || song.beatmap.beatmapset.title,
							artist: local?.artist || song.beatmap.beatmapset.artist,
							track
						}
					: {}
				: guessed >= 0
					? {
							title: `${song.beatmap.beatmapset.title} (${song.beatmap.version})`,
							track
						}
					: {};

			if (!beatmapsetGroups[key]) {
				beatmapsetGroups[key] = {
					...song.beatmap.beatmapset,
					...named,
					// (without its beatmap: the song has it already, it would be every set twice)
					songInfo: { ...song, beatmap: undefined },
					beatmaps: [],
					// Store the position for sorting
					position: song.position
				};
			}
			beatmapsetGroups[key].beatmaps.push({
				...song.beatmap
			});
		});

		const structuredSongs = Object.values(beatmapsetGroups);

		// The playlist's own order (positions can be changed by dragging songs)
		structuredSongs.sort((a, b) => (a.songInfo.position ?? 0) - (b.songInfo.position ?? 0));

		return storeSongs(playlistId, structuredSongs, editsBefore);
	} catch (error) {
		noteNetworkError(error);
		// Offline: what's shown already, else the songs as they were the last time
		const shown = get(playlistSongsCache)[playlistId];
		if (shown) return shown;
		const kept = (await offlineLibrary())?.songs[String(playlistId)];
		if (kept) {
			playlistSongsCache.update((cache) => ({ ...cache, [playlistId]: kept }));
			return kept;
		}
		if (!get(offline)) console.error(`Error loading playlist ${playlistId}:`, error);
		return { songs: [], error: error instanceof Error ? error.message : String(error) };
	} finally {
		playlistLoadingStatus.update((status) => ({
			...status,
			[playlistId]: false
		}));
	}
}

export async function loadAllPlaylistSongs() {
	const allPlaylists = get(playlists);

	const concurrencyLimit = 3;
	const playlistIds = allPlaylists.map((playlist) => playlist.id);

	// Right away the songs as they were the last time, then each playlist's songs from the
	// server (osu! is only asked about the songs that are new)
	const kept = (await offlineLibrary())?.songs ?? {};
	playlistSongsCache.update((cache) => {
		const next = { ...cache };
		for (const id of playlistIds) if (!next[id] && kept[String(id)]) next[id] = kept[String(id)];
		return next;
	});

	for (let i = 0; i < playlistIds.length; i += concurrencyLimit) {
		const batch = playlistIds.slice(i, i + concurrencyLimit);
		await Promise.all(batch.map((id) => getPlaylistSongs(id, true)));
	}

	return true;
}

// --- Public playlists of others -------------------------------------------------------------

/** Public playlists of others the user saved to their library */
export const savedPlaylists = writable<Playlist[]>([]);

export async function loadSavedPlaylists() {
	savedPlaylists.set(await api.getSavedPlaylists(token()));
}

/** Playlists of others opened (not in the library), by id */
export const otherPlaylists = writable<Record<string, Playlist>>({});

/** A playlist that's not the user's own: from the saved ones, else from the API */
export async function loadOtherPlaylist(id: PlaylistId) {
	const known = get(savedPlaylists).find((p) => p.id == id) ?? get(otherPlaylists)[id];
	if (known) return known;
	const playlist = await api.getPlaylist(token(), Number(id));
	otherPlaylists.update((all) => ({ ...all, [id]: playlist }));
	return playlist;
}

/**
 * Loads a public playlist of someone else again (its details and songs), so changes its
 * owner made show up right away
 */
export async function refreshOtherPlaylist(id: PlaylistId) {
	const [playlist] = await Promise.all([
		api.getPlaylist(token(), Number(id)).catch(() => null),
		getPlaylistSongs(id, true)
	]);
	if (!playlist) return;
	otherPlaylists.update((all) => ({ ...all, [id]: playlist }));
	savedPlaylists.update((list) => list.map((p) => (p.id == id ? { ...p, ...playlist } : p)));
}

/** Saves a public playlist of someone else to the library, or removes it */
export async function toggleSavedPlaylist(playlist: Playlist) {
	const saved = !get(savedPlaylists).some((p) => p.id == playlist.id);
	const updated = {
		...playlist,
		saved,
		saves: Math.max(0, (playlist.saves ?? 0) + (saved ? 1 : -1))
	};
	const before = get(savedPlaylists);
	savedPlaylists.set(saved ? [updated, ...before] : before.filter((p) => p.id != playlist.id));
	otherPlaylists.update((all) => ({ ...all, [playlist.id]: updated }));
	showToast(
		saved
			? `Saved "${playlist.title}" to your library`
			: `Removed "${playlist.title}" from your library`,
		saved ? 'icon-[mingcute--bookmark-fill]' : 'icon-[mingcute--bookmark-line]'
	);
	try {
		await api.savePlaylist(token(), Number(playlist.id), saved);
	} catch (error) {
		console.error('Could not save the playlist:', error);
		savedPlaylists.set(before);
		otherPlaylists.update((all) => ({ ...all, [playlist.id]: playlist }));
		showToast("Couldn't save that, try again", 'icon-[mingcute--warning-line]');
	}
}

if (typeof window !== 'undefined') {
	// Whatever the library loads online is kept for offline use (offline it isn't replaced)
	const keep = () => {
		if (!get(offline)) keepOffline();
	};
	setTimeout(() => {
		playlists.subscribe(keep);
		playlistSongsCache.subscribe(keep);
		savedPlaylists.subscribe(keep);
	});
}
