// What the home page shows and the radio: the listening history (the desktop app's, synced
// through the Stosufy API both ways) and a radio from the songs of the user's playlists.

import { derived, get } from 'svelte/store';
import { history, playCounts, songKey, syncHistory, type HistorySong } from '../lib/stores/history';
import { radioSongs } from '../lib/stores/radio';
import { playlists, playlistSongsCache, loadAllPlaylistSongs } from '../lib/stores/playlist';
import { libraryPool, libraryByKey, libraryReady } from './shims/data';
import { allMixes } from '../lib/stores/mixes';
import { offline } from '../lib/stores/network';
import { keyStore } from './shims/auth';
import { downloadedSongs } from './downloads';
import { play, setSimilarSongs, setSimilarOnOsu } from './player';
import { searchOnline } from '../lib/stores/smartPlaylists';
import { normalized } from './songs';
import type { MapSet } from '../lib/types';

/** A song of the history as a song to play */
function fromHistory(song: HistorySong): MapSet {
	return {
		id: song.setId,
		track: song.track,
		title: song.title,
		artist: song.artist,
		creator: song.creator,
		genre: song.genre,
		language: song.language,
		songSource: song.source ?? '',
		bpm: song.bpm,
		beatmaps: song.mapId ? [{ id: song.mapId }] : []
	} as MapSet;
}

/** The playlists' song of a history entry (it has the length), else the entry */
export const known = (song: HistorySong) => libraryByKey().get(songKey(song)) ?? fromHistory(song);

/** The songs heard last, the newest first, each once */
export const recentSongs = derived([history, libraryPool], ([{ songs, plays }]) => {
	const seen = new Set<string>();
	const recent: MapSet[] = [];
	for (let i = plays.length - 1; i >= 0 && recent.length < 30; i--) {
		const key = plays[i][0];
		if (seen.has(key) || !songs[key]) continue;
		seen.add(key);
		recent.push(known(songs[key]));
	}
	return recent;
});

const DAY = 24 * 3600;

/** The songs played most in the last 30 days */
export const topSongs = derived([history, libraryPool], ([{ songs, plays }]) => {
	const since = Date.now() / 1000 - 30 * DAY;
	return [...playCounts(plays.filter(([, at]) => at >= since))]
		.filter(([key, entry]) => songs[key] && entry.plays > 0)
		.sort((a, b) => b[1].plays - a[1].plays)
		.slice(0, 50)
		.map(([key]) => known(songs[key]));
});

// The radio's songs: the playlists' and the kept ones, each once. Made a moment after they
// change, when nothing moves: thousands of songs, put together while a page opens, stutter.
const keyOfSong = (song: MapSet) => `${song.id}:${song.track ?? 0}`;
let poolTimer: ReturnType<typeof setTimeout> | null = null;
function makePool() {
	poolTimer = null;
	const all = new Map<string, MapSet>();
	for (const { songs } of Object.values(get(playlistSongsCache)))
		for (const song of songs ?? []) all.set(keyOfSong(song), normalized(song));
	for (const song of get(downloadedSongs))
		if (!all.has(keyOfSong(song))) all.set(keyOfSong(song), song);
	libraryPool.set([...all.values()]);
}
const poolLater = () => {
	if (poolTimer) clearTimeout(poolTimer);
	poolTimer = setTimeout(() => {
		const idle = (window as { requestIdleCallback?: (run: () => void) => void })
			.requestIdleCallback;
		if (idle) idle(makePool);
		else makePool();
	}, 800);
};
if (typeof window !== 'undefined') {
	playlistSongsCache.subscribe(poolLater);
	downloadedSongs.subscribe(poolLater);
}

// Autoplay: songs like the last ones of the queue
setSimilarSongs((seeds, exclude) =>
	radioSongs(
		seeds.map((song) => libraryByKey().get(keyOfSong(song)) ?? normalized(song)),
		exclude,
		{ length: 20 }
	)
);

// …and from all of osu! when the playlists have too few like them: the most played songs of
// the same artists, anime or games, genre and language (as the smart playlists' autofill
// finds them), each song once (osu! has several sets of many), a little at random so it isn't
// the same every time
setSimilarOnOsu(async (seeds, exclude) => {
	const like = seeds.map((song) => libraryByKey().get(keyOfSong(song)) ?? normalized(song));
	const found = await searchOnline(like);
	const name = (song: MapSet) => `${song.title}|${song.artist}`.toLowerCase();
	const seen = new Set(exclude.map(name));
	const once: MapSet[] = [];
	for (const song of found) {
		if (seen.has(name(song)) || !song.beatmaps?.length) continue;
		seen.add(name(song));
		once.push(song);
	}
	return once
		.map((song, i) => ({ song, order: i + Math.random() * 12 }))
		.sort((a, b) => a.order - b.order)
		.map(({ song }) => song);
});

let allLoaded: Promise<unknown> | null = null;

/** All playlists' songs (once): the radio and the daily mixes are made of them */
export function loadAllSongs() {
	allLoaded ??= loadAllPlaylistSongs()
		.then(() => libraryReady())
		.catch(() => (allLoaded = null));
	return allLoaded;
}

/** Today's mixes (as in the desktop app), made of your playlists' songs */
export const mixes = derived(allMixes, (all) => [...all.values()]);

// Once the playlists are there, all their songs in the background
if (typeof window !== 'undefined') {
	let waiting: ReturnType<typeof setTimeout> | null = null;
	playlists.subscribe((list) => {
		if (allLoaded || waiting || list.length < 2) return;
		waiting = setTimeout(() => {
			waiting = null;
			if (get(keyStore).access_token && !get(offline)) loadAllSongs();
		}, 3000);
	});
}

/** A radio from a song: songs like it from your playlists (all of them loaded first) */
export async function startRadio(song: MapSet) {
	if (get(libraryPool).length < 200) await loadAllSongs();
	const seed = libraryByKey().get(keyOfSong(song)) ?? normalized(song);
	const songs = radioSongs([seed]);
	play([seed, ...songs], 0);
	return songs.length;
}

// The plays counted go to the server when the app leaves the screen (it may not come back;
// the song playing counts once it's over, also with the screen locked)
if (typeof document !== 'undefined') {
	document.addEventListener('visibilitychange', () => syncHistory());
}
