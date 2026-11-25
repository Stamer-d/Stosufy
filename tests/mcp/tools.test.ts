// The tools Claude uses, with the app's own stores: a small library, a history and likes,
// and stand-ins for osu! and the Stamer API (playlists, likes) that keep what they're sent.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { TOOLS } from '../../src/lib/mcp/tools.ts';
import { parseSongId } from '../../src/lib/mcp/songs.ts';
import { mapDataStore } from '../../src/lib/stores/data.ts';
import { history } from '../../src/lib/stores/history.ts';
import { favourites } from '../../src/lib/stores/favourites.ts';
import { keyStore } from '../../src/lib/stores/auth.ts';
import { offline } from '../../src/lib/stores/network.ts';
import { user } from '../../src/lib/stores/user.ts';
import { playlists, playlistSongsCache } from '../../src/lib/stores/playlist.ts';
import { smartPlaylists } from '../../src/lib/stores/smartPlaylists.ts';
import { librarySongs } from '../../src/lib/stores/data.ts';
import { userSettings } from '../../src/lib/stores/user.ts';
import { cancelDownloads } from '../../src/lib/stores/downloadQueue.ts';
import { songQueue, currentSong, upNext } from '../../src/lib/stores/audio.ts';

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

// --- The library and the history ------------------------------------------------------------

function stored(id: number, title: string, artist: string, more: Record<string, any> = {}) {
	return {
		id,
		title,
		artist,
		creator: more.creator ?? 'Mapper',
		tags: more.tags ?? '',
		genre: more.genre ?? 'Anime',
		language: more.language ?? 'Japanese',
		songSource: more.source ?? '',
		bpm: more.bpm ?? 180,
		created_at: more.created ?? id,
		beatmaps: {
			[id * 10]: {
				id: id * 10,
				version: 'Insane',
				difficulty_rating: 5.2,
				mode: 'osu',
				total_length: more.length ?? 200,
				audioFile: `/songs/${id}/audio.mp3`
			}
		}
	};
}

const LIBRARY = {
	1001: stored(1001, 'Ghost Rule', 'DECO*27', {
		tags: 'vocaloid hatsune miku',
		genre: 'Electronic',
		bpm: 210
	}),
	1002: stored(1002, 'Vampire', 'DECO*27', {
		tags: 'vocaloid hatsune miku',
		genre: 'Electronic',
		bpm: 154
	}),
	1003: stored(1003, 'Bad Apple!!', 'Alstroemeria Records', {
		source: 'Touhou',
		genre: 'Video Game',
		bpm: 138
	}),
	1004: stored(1004, 'Night of Nights', 'COOL&CREATE', {
		source: 'Touhou',
		genre: 'Videospiel',
		language: 'Japanisch',
		bpm: 180
	}),
	1005: stored(1005, 'Unravel', 'TK from Ling tosite sigure', {
		source: 'Tokyo Ghoul',
		bpm: 135,
		length: 240
	}),
	1006: stored(1006, 'Blue Zenith', 'xi', {
		genre: 'Electronic',
		language: 'Instrumental',
		bpm: 200,
		length: 210
	})
};

const kept = (id: number) => {
	const set = LIBRARY[id as keyof typeof LIBRARY];
	return {
		setId: id,
		track: 0,
		mapId: id * 10,
		title: set.title,
		artist: set.artist,
		creator: set.creator,
		genre: set.genre,
		language: set.language,
		source: set.songSource || null,
		bpm: set.bpm
	};
};

/** Plays of a song: `times` plays (or skips) from `daysAgo` on, an hour apart */
const plays = (id: number, times: number, daysAgo: number, skip = false) =>
	Array.from(
		{ length: times },
		(_, i) =>
			[`${id}:0`, now - daysAgo * DAY + i * 3600, skip ? 3 + i : 190, 200] as [
				string,
				number,
				number,
				number
			]
	);

// --- osu! and the Stamer API ------------------------------------------------------------------

function osuSet(id: number, title: string, artist: string, more: Record<string, any> = {}) {
	return {
		id,
		title,
		artist,
		creator: more.creator ?? 'Someone',
		user_id: 1,
		status: more.status ?? 'ranked',
		tags: more.tags ?? '',
		bpm: more.bpm ?? 180,
		genre: { id: more.genreId ?? 3, name: more.genre ?? 'Anime' },
		language: { id: 3, name: 'Japanese' },
		source: more.source ?? '',
		preview_url: `//b.ppy.sh/preview/${id}.mp3`,
		play_count: more.plays ?? 500000,
		favourite_count: more.favourites ?? 900,
		ranked_date: '2024-05-01T00:00:00Z',
		beatmaps: [
			{ id: id * 10, version: 'Easy', difficulty_rating: 1.9, mode: 'osu', total_length: 220 },
			{ id: id * 10 + 1, version: 'Extra', difficulty_rating: 6.4, mode: 'osu', total_length: 220 }
		]
	};
}

const OSU = [
	osuSet(2001, 'Hibana', 'DECO*27', {
		tags: 'vocaloid hatsune miku',
		genre: 'Electronic',
		bpm: 200
	}),
	osuSet(2002, 'Ghost Rule (TV Size)', 'DECO*27', {
		tags: 'vocaloid',
		genre: 'Electronic',
		bpm: 210
	}),
	osuSet(2003, 'Necrofantasia', 'Demetori', { source: 'Touhou', genre: 'Video Game', bpm: 150 }),
	osuSet(2004, 'Freedom Dive', 'xi', { genre: 'Electronic', bpm: 222, plays: 9000000 }),
	osuSet(2005, 'Cirno no Perfect Sansuu Kyoushitsu', 'IOSYS', {
		source: 'Touhou',
		genre: 'Video Game',
		bpm: 175
	}),
	osuSet(2006, 'Aspire joke', 'Someone', { genre: 'Novelty', bpm: 6000000000, plays: 10 })
];

/** What the fake osu! search finds for a query (artist and source searches, else everything) */
function search(q: string) {
	const artist = q.match(/artist="([^"]+)"/)?.[1];
	const source = q.match(/source="([^"]+)"/)?.[1];
	if (artist) return OSU.filter((set) => set.artist === artist);
	if (source) return OSU.filter((set) => set.source === source);
	return OSU;
}

/** The Stamer API's playlists and likes */
const server = {
	playlists: [] as { id: number; title: string; description: string; public: boolean }[],
	songs: new Map<number, { id: number; setId: number; mapId: number; position: number }[]>(),
	favourites: [{ setId: 1003, mapId: 10030 }],
	nextId: 500,
	/** Public playlists of others, and which of them the user saved */
	community: [
		{ id: 900, title: 'Touhou classics', description: 'The best of Touhou', public: true }
	],
	saved: new Set<number>()
};
server.songs.set(900, [
	{ id: 9001, setId: 1003, mapId: 10030, position: 1 },
	{ id: 9002, setId: 2003, mapId: 20030, position: 2 }
]);

const allSets = () => [
	...OSU,
	...Object.values(LIBRARY).map((set) => ({ ...set, beatmaps: Object.values(set.beatmaps) }))
];

function graphql(query: string, variables: any) {
	const playlistOut = (p: (typeof server.playlists)[number]) => {
		const theirs = server.community.some((other) => other.id === p.id);
		return {
			...p,
			imageUrl: null,
			createdBy: theirs ? 99 : 7,
			songAmount: server.songs.get(p.id)?.length ?? 0,
			createdAt: '2026-11-21',
			updatedAt: '2026-11-21',
			saves: theirs ? 12 : 0,
			saved: server.saved.has(p.id),
			creator: theirs ? { osuId: 99, username: 'someone', avatarUrl: null } : null
		};
	};
	if (query.includes('moveSongInStosufyPlaylist')) {
		const list = server.songs.get(variables.playlistId)!;
		const [song] = list.splice(
			list.findIndex((other) => other.id === variables.songId),
			1
		);
		list.splice(variables.position - 1, 0, song);
		list.forEach((other, i) => (other.position = i + 1));
		return { moveSongInStosufyPlaylist: true };
	}
	if (query.includes('deleteStosufyPlaylist')) {
		server.playlists = server.playlists.filter((p) => p.id !== variables.id);
		server.songs.delete(variables.id);
		return { deleteStosufyPlaylist: true };
	}
	if (query.includes('getPublicStosufyPlaylists')) {
		const words = String(variables.search ?? '').toLowerCase();
		return {
			getPublicStosufyPlaylists: server.community
				.filter((p) => p.title.toLowerCase().includes(words))
				.map(playlistOut)
		};
	}
	if (query.includes('getStosufyPlaylist(')) {
		const playlist = [...server.playlists, ...server.community].find((p) => p.id === variables.id);
		if (!playlist) throw new Error('Playlist not found');
		return { getStosufyPlaylist: playlistOut(playlist) };
	}
	if (query.includes('saveStosufyPlaylist')) {
		if (variables.saved) server.saved.add(variables.id);
		else server.saved.delete(variables.id);
		return { saveStosufyPlaylist: true };
	}
	if (query.includes('createStosufyPlaylist')) {
		const playlist = {
			id: server.nextId++,
			title: variables.title,
			description: '',
			public: false
		};
		server.playlists.push(playlist);
		server.songs.set(playlist.id, []);
		return { createStosufyPlaylist: playlistOut(playlist) };
	}
	if (query.includes('editStosufyPlaylist')) {
		const playlist = server.playlists.find((p) => p.id === variables.id)!;
		Object.assign(playlist, {
			title: variables.title,
			description: variables.description,
			public: variables.public
		});
		return { editStosufyPlaylist: playlistOut(playlist) };
	}
	if (query.includes('addSongToStosufyPlaylist')) {
		const list = server.songs.get(variables.playlistId)!;
		if (list.some((song) => song.mapId === variables.mapId))
			throw new Error('Song already in playlist');
		const song = {
			id: server.nextId++,
			setId: variables.setId,
			mapId: variables.mapId,
			position: list.length + 1
		};
		list.push(song);
		return { addSongToStosufyPlaylist: { ...song, createdAt: '2026-11-21' } };
	}
	if (query.includes('removeSongFromStosufyPlaylist')) {
		const list = server.songs.get(variables.playlistId)!;
		server.songs.set(
			variables.playlistId,
			list.filter((song) => song.id !== variables.songId)
		);
		return { removeSongFromStosufyPlaylist: true };
	}
	if (query.includes('getStosufyPlaylistSongs')) {
		return {
			getStosufyPlaylistSongs: (server.songs.get(variables.playlistId) ?? []).map((song) => ({
				...song,
				createdAt: '2026-11-21',
				updatedAt: '2026-11-21'
			}))
		};
	}
	if (query.includes('getStosufyPlaylists'))
		return { getStosufyPlaylists: server.playlists.map(playlistOut) };
	if (query.includes('getStosufyFavourites')) {
		return {
			getStosufyFavourites: server.favourites.map((f, i) => ({
				id: i + 1,
				...f,
				createdAt: '2026-11-21'
			}))
		};
	}
	if (query.includes('setStosufyFavourite')) {
		server.favourites = server.favourites.filter((f) => f.mapId !== variables.mapId);
		if (variables.favourite)
			server.favourites.unshift({ setId: variables.setId, mapId: variables.mapId });
		return { setStosufyFavourite: true };
	}
	throw new Error(`The test's API doesn't know ${query.slice(0, 60)}`);
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

(globalThis as any).fakeFetch = async (url: string, init?: any) => {
	if (url.startsWith('https://api.stamer-d.de/')) {
		const { query, variables } = JSON.parse(init.body);
		try {
			return json({ data: graphql(query, variables) });
		} catch (error) {
			return json({ errors: [{ message: (error as Error).message }] });
		}
	}
	const parsed = new URL(url);
	if (parsed.pathname === '/api/v2/beatmapsets/search') {
		const found = search(parsed.searchParams.get('q') ?? '');
		return json({ beatmapsets: found, total: found.length, cursor_string: null });
	}
	const set = parsed.pathname.match(/^\/api\/v2\/beatmapsets\/(\d+)$/);
	if (set) {
		const found = allSets().find((other) => other.id === Number(set[1]));
		return found ? json(found) : json({ error: 'not found' }, 404);
	}
	if (parsed.pathname === '/api/v2/beatmaps') {
		const ids = parsed.searchParams.getAll('ids[]').map(Number);
		const beatmaps = allSets().flatMap((other) =>
			other.beatmaps
				.filter((map: any) => ids.includes(map.id))
				.map((map: any) => ({ ...map, beatmapset: other }))
		);
		return json({ beatmaps });
	}
	return json({}, 404);
};

const call = async (name: string, args: Record<string, unknown> = {}) =>
	(await TOOLS[name](args)) as any;

before(() => {
	offline.set(false);
	keyStore.set({
		access_token: 'token',
		refresh_token: '',
		expiry_time: Date.now() + 3600e3,
		sessionKey: ''
	});
	user.set({ id: 7, username: 'Tester' });
	mapDataStore.set(LIBRARY as any);
	history.set({
		songs: Object.fromEntries(Object.keys(LIBRARY).map((id) => [`${id}:0`, kept(Number(id))])),
		plays: [
			...plays(1004, 6, 60),
			...plays(1001, 8, 10),
			...plays(1003, 5, 8),
			...plays(1006, 4, 5),
			...plays(1005, 3, 3, true),
			...plays(1002, 1, 2)
		].sort((a, b) => a[1] - b[1])
	});
	favourites.set([{ setId: 1003, mapId: 10030, createdAt: null }]);
	playlists.set([
		{ id: -1, title: 'Downloaded Songs', song_amount: 6 },
		{ id: -2, title: 'Liked Songs', song_amount: 1 }
	]);
});

// (the library's background work would keep the test running)
after(() => setTimeout(() => process.exit(), 50));

test('every tool Claude is told about is there, and only those', () => {
	const listed = JSON.parse(
		readFileSync(new URL('../../src/lib/mcp/tools.json', import.meta.url), 'utf8')
	);
	assert.deepEqual(listed.map((tool: any) => tool.name).sort(), Object.keys(TOOLS).sort());
});

test('song ids: set ids, tracks and osu! links', () => {
	assert.deepEqual(parseSongId('1234'), { set: '1234', track: 0 });
	assert.deepEqual(parseSongId('1234:2'), { set: '1234', track: 2 });
	assert.deepEqual(parseSongId(1234), { set: '1234', track: 0 });
	assert.deepEqual(parseSongId('https://osu.ppy.sh/beatmapsets/773801#osu/1636225'), {
		set: '773801',
		track: 0
	});
	assert.equal(parseSongId('Ghost Rule'), null);
});

test('the stats: top songs and artists, what is skipped and what is forgotten', async () => {
	const stats = await call('get_listening_stats', { period: 'month' });
	assert.equal(stats.top_songs[0].id, '1001');
	assert.equal(stats.top_songs[0].plays_in_period, 8);
	assert.equal(stats.top_artists[0].name, 'DECO*27');
	assert.ok(stats.top_sources.some((source: any) => source.name === 'Touhou'));
	assert.equal(stats.often_skipped[0].id, '1005');
	assert.equal(stats.forgotten_favourites[0].id, '1004');
	assert.equal(stats.totals.plays, 18);
	assert.equal(stats.totals.skips, 3);
	const week = await call('get_listening_stats', { days: 7 });
	assert.equal(week.top_songs.length, 2);
});

test('the history: newest first, skips only when asked for', async () => {
	const recent = await call('get_listening_history', { days: 4 });
	assert.equal(recent.plays[0].id, '1002');
	assert.ok(recent.plays.every((play: any) => !play.skipped));
	const withSkips = await call('get_listening_history', { days: 4, include_skips: true });
	assert.equal(withSkips.total, 4);
	const one = await call('get_listening_history', { days: 30, song: '1003' });
	assert.equal(one.total, 5);
	assert.match(one.plays[0].at, /^\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('the library: words, filters and orders', async () => {
	const touhou = await call('search_library', { query: 'touhou' });
	assert.deepEqual(touhou.songs.map((song: any) => song.id).sort(), ['1003', '1004']);
	const fast = await call('search_library', { bpm_min: 190, sort: 'bpm' });
	assert.deepEqual(
		fast.songs.map((song: any) => song.id),
		['1001', '1006']
	);
	// (only skipped, so never played)
	const never = await call('search_library', { played: 'never' });
	assert.deepEqual(
		never.songs.map((song: any) => song.id),
		['1005']
	);
	const liked = await call('search_library', { liked: true });
	assert.deepEqual(
		liked.songs.map((song: any) => song.id),
		['1003']
	);
	assert.equal(liked.songs[0].liked, true);
	const most = await call('search_library', { sort: 'most_played', limit: 1 });
	assert.equal(most.songs[0].id, '1001');
	assert.equal(most.next_offset, 1);
	const overview = await call('get_library_overview');
	assert.equal(overview.downloaded_songs, 6);
	assert.equal(overview.library.top_artists['DECO*27'], 2);
});

test('osu!: songs with their popularity, paged by a cursor', async () => {
	const result = await call('search_osu', { query: 'artist="DECO*27"', limit: 1 });
	assert.equal(result.songs.length, 1);
	assert.equal(result.songs[0].downloaded, false);
	assert.equal(result.songs[0].stars, '1.9-6.4');
	assert.equal(result.songs[0].osu_plays, 500000);
	const next = await call('search_osu', {
		query: 'artist="DECO*27"',
		limit: 1,
		cursor: result.next_cursor
	});
	assert.equal(next.songs[0].id, '2002');
	assert.equal(next.next_cursor, undefined);
});

test('similar songs: from the library and osu!, one version each, with reasons', async () => {
	const similar = await call('find_similar_songs', { seeds: ['1001'] });
	const ids = similar.songs.map((song: any) => song.id);
	assert.ok(ids.includes('1002'), 'the same artist from the library');
	assert.ok(ids.includes('2001'), 'the same artist from osu!');
	assert.ok(!ids.includes('2002'), 'not another version of a seed');
	assert.ok(!ids.includes('1001'), 'not the seed itself');
	const vampire = similar.songs.find((song: any) => song.id === '1002');
	assert.match(vampire.why, /by DECO\*27/);
	const fromHistory = await call('find_similar_songs', { include_osu: false });
	assert.equal(fromHistory.based_on, "the user's most played songs lately");
	assert.ok(fromHistory.songs.every((song: any) => song.downloaded));
});

test('a playlist: made with its songs in order, shown in the library', async () => {
	const made = await call('create_playlist', {
		title: 'Vocaloid & Touhou',
		description: 'Fast ones',
		songs: ['1001', '2001', '1003', '1001', 'nonsense'],
		open: true
	});
	assert.equal(made.songs, 3);
	assert.deepEqual(made.not_found, ['nonsense']);
	const saved = server.songs.get(Number(made.id))!;
	assert.deepEqual(
		saved.map((song) => song.setId),
		[1001, 2001, 1003]
	);
	assert.equal(server.playlists.at(-1)!.description, 'Fast ones');
	assert.ok(get(playlists).some((p) => String(p.id) === made.id));
	assert.equal((globalThis as any).wentTo, `/playlist/${made.id}`);

	const added = await call('add_to_playlist', { playlist: made.id, songs: ['1003', '2003'] });
	assert.equal(added.added, 1);
	assert.equal(added.already_in, 1);
	const removed = await call('remove_from_playlist', {
		playlist: 'Vocaloid & Touhou',
		songs: ['2001']
	});
	assert.equal(removed.removed, 1);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(
		server.songs.get(Number(made.id))!.map((song) => song.setId),
		[1001, 1003, 2003]
	);

	const listed = await call('list_playlists');
	assert.ok(listed.playlists.some((p: any) => p.id === made.id && p.kind === 'playlist'));
	const edited = await call('edit_playlist', { playlist: made.id, title: 'Fast & loud' });
	assert.equal(edited.playlist, 'Fast & loud');
	playlistSongsCache.update((cache) => ({ ...cache, [made.id]: undefined as any }));
	const songs = await call('get_playlist_songs', { playlist: made.id });
	assert.deepEqual(
		songs.songs.map((song: any) => song.id),
		['1001', '1003', '2003']
	);
});

test('likes through the "liked" playlist', async () => {
	const liked = await call('add_to_playlist', { playlist: 'liked', songs: ['1001', '1003'] });
	assert.equal(liked.added, 1);
	assert.equal(liked.already_in, 1);
	assert.ok(server.favourites.some((f) => f.setId === 1001));
	const unliked = await call('remove_from_playlist', { playlist: 'liked', songs: ['1001'] });
	assert.equal(unliked.removed, 1);
	assert.ok(!server.favourites.some((f) => f.setId === 1001));
});

test('a smart playlist: filled with songs like the seeds', async () => {
	const smart = await call('create_smart_playlist', {
		title: 'Touhou mix',
		seeds: ['1003', '1004'],
		size: 25
	});
	assert.match(smart.id, /^smart:/);
	assert.equal(smart.based_on, 2);
	const ids = smart.songs.map((song: any) => song.id);
	assert.ok(ids.includes('2003') || ids.includes('2005'), 'Touhou songs from osu!');
	assert.ok(get(smartPlaylists).some((p) => `smart:${p.id}` === smart.id));
	const songs = await call('get_playlist_songs', { playlist: smart.id });
	assert.equal(songs.total, smart.songs.length);
});

test("details: osu!'s view and the user's own", async () => {
	const { songs } = await call('get_song_details', { songs: ['1003', '2004'] });
	assert.equal(songs[0].liked, true);
	assert.equal(songs[0].plays, 5);
	assert.ok(songs[0].first_played);
	assert.equal(songs[1].osu_plays, 9000000);
	assert.equal(songs[1].difficulties.length, 2);
	assert.equal(songs[1].link, 'https://osu.ppy.sh/beatmapsets/2004');
});

test("what Claude is told when it can't", async () => {
	keyStore.update((keys) => ({ ...keys, access_token: '' }));
	await assert.rejects(call('search_osu', { query: 'x' }), /isn't logged in/);
	keyStore.update((keys) => ({ ...keys, access_token: 'token' }));
	await assert.rejects(call('get_playlist_songs', { playlist: 'nope' }), /no playlist "nope"/);
	await assert.rejects(
		call('add_to_playlist', { playlist: 'downloaded', songs: ['1'] }),
		/downloading/
	);
	await assert.rejects(call('create_playlist', { title: 'x', songs: [] }), /list of song ids/);
});

test("genres and languages in the user's language count as osu!'s", async () => {
	const english = await call('search_library', { genre: 'Video Game' });
	assert.deepEqual(english.songs.map((song: any) => song.id).sort(), ['1003', '1004']);
	const german = await call('search_library', { genre: 'Videospiel' });
	assert.equal(german.total, 2);
	assert.equal(english.songs.find((song: any) => song.id === '1004').genre, 'Video Game');
	const overview = await call('get_library_overview');
	assert.equal(overview.library.genres['Video Game'], 2);
	assert.equal(overview.library.genres['Videospiel'], undefined);
	assert.equal(overview.library.languages['Japanese'], 5);
	const all = await call('get_listening_stats', { period: 'all' });
	assert.equal(all.top_genres.find((genre: any) => genre.name === 'Video Game').plays, 11);
	assert.ok(!all.top_genres.some((genre: any) => genre.name === 'Videospiel'));
	const joke = (await call('search_osu', { query: '' })).songs.find(
		(song: any) => song.id === '2006'
	);
	assert.equal(joke.bpm, undefined);
});

test("downloads: only what isn't downloaded, and how far they are", async () => {
	await assert.rejects(call('download_songs', { songs: ['2001'] }), /session key is missing/);
	const none = await call('download_songs', { songs: ['1001'] });
	assert.equal(none.queued, 0);
	keyStore.update((keys) => ({ ...keys, sessionKey: 'session' }));
	const queued = await call('download_songs', { songs: ['2001', '2003', '1001'] });
	assert.equal(queued.queued, 2);
	assert.equal(queued.already_downloaded, 1);
	const status = await call('get_downloads');
	assert.equal((status.downloading ? 1 : 0) + status.waiting, 2);
	cancelDownloads();
	keyStore.update((keys) => ({ ...keys, sessionKey: '' }));
});

test('the queue: reorder, remove and clear what comes next, and how it plays', async () => {
	const song = (id: string) => librarySongs().find((one) => String(one.id) === id)!;
	const audio = { currentTime: 10, duration: 200, paused: false, playbackRate: 1 } as any;
	songQueue.set({
		queue: ['1001', '1002', '1003', '1006'].map(song),
		currentIndex: 0,
		audio,
		type: 'playlist',
		playlistId: null
	});
	currentSong.set({ song: song('1001'), isPlaying: true });
	upNext.set([song('1004')]);
	const ids = (now: any) => now.up_next.map((one: any) => one.id);
	assert.deepEqual(ids(await call('get_now_playing')), ['1004', '1002', '1003', '1006']);
	let now = await call('edit_queue', { action: 'reorder', songs: ['1006', '1004'] });
	assert.deepEqual(ids(now), ['1006', '1004', '1002', '1003']);
	now = await call('edit_queue', { action: 'remove', songs: ['1002'] });
	assert.deepEqual(ids(now), ['1006', '1004', '1003']);

	now = await call('set_playback', {
		volume: 50,
		repeat: 'one',
		sleep_minutes: 30,
		autoplay: false
	});
	assert.equal(now.volume, 50);
	assert.equal(get(userSettings).settings.volume, 0.1);
	assert.equal(now.repeat, 'one');
	assert.equal(now.sleep_timer, 'in 30 min');
	assert.equal(now.autoplay, false);
	now = await call('set_playback', { seek: 60, sleep_minutes: 0 });
	assert.equal(now.position, 60);
	assert.equal(now.sleep_timer, undefined);
	await assert.rejects(call('set_playback', { mod: 'XX' }), /mod is one of/);
	await assert.rejects(call('set_playback', {}), /Nothing to change/);

	now = await call('edit_queue', { action: 'clear' });
	assert.deepEqual(now.up_next, []);
	songQueue.set({});
	currentSong.set({ song: null, isPlaying: false });
});

test('a playlist in a new order, then deleted', async () => {
	const made = await call('create_playlist', {
		title: 'To sort',
		songs: ['1006', '1003', '1001'],
		open: false
	});
	const order = () => server.songs.get(Number(made.id))!.map((song) => song.setId);
	const sorted = await call('reorder_playlist', { playlist: made.id, sort: 'bpm' });
	assert.ok(sorted.moved > 0);
	assert.deepEqual(order(), [1003, 1006, 1001]);
	await call('reorder_playlist', { playlist: made.id, songs: ['1001'] });
	assert.deepEqual(order(), [1001, 1003, 1006]);
	await assert.rejects(call('reorder_playlist', { playlist: 'liked', sort: 'bpm' }), /own order/);

	const gone = await call('delete_playlist', { playlist: made.id });
	assert.equal(gone.deleted, 'To sort');
	assert.ok(!server.playlists.some((p) => p.id === Number(made.id)));
	assert.ok(!get(playlists).some((p) => String(p.id) === made.id));
	await assert.rejects(call('delete_playlist', { playlist: 'downloaded' }), /deleted|removed/);
});

test('mixes and the playlists of others', async () => {
	const { mixes } = await call('get_mixes');
	const recent = mixes.find((mix: any) => mix.id === 'mix:recent');
	assert.ok(recent.songs > 0);
	const songs = await call('get_playlist_songs', { playlist: 'mix:recent' });
	assert.equal(songs.total, recent.songs);
	await assert.rejects(
		call('add_to_playlist', { playlist: 'mix:recent', songs: ['1001'] }),
		/mixes/
	);

	const found = await call('search_community_playlists', { query: 'touhou' });
	assert.equal(found.playlists[0].id, '900');
	assert.equal(found.playlists[0].by, 'someone');
	const theirs = await call('get_playlist_songs', { playlist: '900' });
	assert.deepEqual(
		theirs.songs.map((one: any) => one.id),
		['1003', '2003']
	);
	await assert.rejects(
		call('add_to_playlist', { playlist: '900', songs: ['1001'] }),
		/someone else/
	);
	const saved = await call('save_playlist', { playlist: '900' });
	assert.equal(saved.saved, true);
	assert.ok(server.saved.has(900));
	await assert.rejects(call('save_playlist', { playlist: 'liked' }), /own/);
});
