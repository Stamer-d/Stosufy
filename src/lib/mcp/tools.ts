// What Claude can do with Stosufy (the tools of tools.json): look at the listening, the
// library and osu!, find songs, make and change playlists, play music. Each tool gets
// Claude's arguments and returns what it found; it runs here in the window, with the app's
// own data, and the Claude connection (src-tauri/src/mcp.rs) hands it over.

import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { keyStore } from '../stores/auth';
import { fetchMaps, librarySongs, mapDataStore } from '../stores/data';
import { history, counts, playCounts, type Play } from '../stores/history';
import { favourites, LIKED_ID, loadFavourites } from '../stores/favourites';
import {
	playlists,
	playlistSongsCache,
	savedPlaylists,
	createPlaylist,
	editPlaylist,
	addSongToPlaylist,
	removeSongFromPlaylist,
	getPlaylistSongs
} from '../stores/playlist';
import {
	smartPlaylists,
	createSmartPlaylist,
	updateSmartPlaylist,
	addSeed,
	removeSong,
	autofill,
	smartSongs,
	searchOnline,
	songFromSearch,
	toSmartSong,
	type SmartPlaylist
} from '../stores/smartPlaylists';
import {
	songQueue,
	currentSong,
	upNext,
	setSongQueue,
	queueSongs,
	startRadio,
	stopPlayback,
	togglePlayback,
	skipForward,
	skipBackward,
	focusMode
} from '../stores/audio';
import { fitTo, alikeReasons } from '../stores/radio';
import { loadList, type ProfileList } from '../stores/osuProfile';
import { queueDownloads } from '../stores/downloadQueue';
import { offline } from '../stores/network';
import { user, userSettings } from '../stores/user';
import { showToast } from '../stores/toast';
import { activeOverlay } from '../addons/store';
import { playingLive } from '../gameplay/play';
import * as api from '../api';
import { recap, type Period } from '../wrapped';
import { GENRES, LANGUAGES, tagList } from '../genres';
import { artistsOf, sameSong, songKey, songName } from '../tracks';
import {
	ToolError,
	DAYS,
	brief,
	day,
	describe,
	isDownloaded,
	lengthOf,
	moment,
	osuSet,
	parseSongId,
	remember,
	resolveSongs,
	songId,
	songOfKey,
	sourceOf,
	taste,
	tempoOf
} from './songs';
import type { MapSet, Playlist } from '../types';

type Args = Record<string, any>;
type Tool = (args: Args) => Promise<unknown>;

/** Claude's tools end before Claude stops waiting (about a minute): the rest goes on here */
const BUDGET = 45_000;

const now = () => Date.now() / 1000;
const clamp = (value: unknown, low: number, high: number, fallback: number) => {
	const number = Number(value);
	return Number.isFinite(number) ? Math.min(high, Math.max(low, Math.round(number))) : fallback;
};

function needLogin() {
	if (!get(keyStore).access_token) {
		throw new ToolError(
			"The user isn't logged in to Stosufy. Ask them to log in with their osu! account in the app."
		);
	}
}

function needOnline() {
	if (get(offline))
		throw new ToolError('Stosufy is offline right now, so osu! and playlists are out of reach.');
}

/** Resolves once `work` is done, or after `ms` with false (the work goes on) */
async function within(work: Promise<unknown>, ms = BUDGET) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const done = await Promise.race([
		work.then(() => true),
		new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)))
	]);
	clearTimeout(timer);
	return done;
}

/** Shows a page in the app, unless something covers it (an add-on like DJ or Dash, focus mode, playing) */
function show(path: string) {
	if (get(activeOverlay) || get(focusMode) || get(playingLive)) return;
	goto(path).catch(() => {});
}

const normal = (text: unknown) =>
	String(text ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim();

const idOfName = (names: Record<number, string>, name: unknown) =>
	name
		? (Object.entries(names).find(([, other]) => normal(other) === normal(name))?.[0] ?? '')
		: '';

function songIds(value: unknown, what = 'songs'): unknown[] {
	const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	if (!list.length) throw new ToolError(`Give ${what} as a list of song ids.`);
	return list;
}

// --- Now playing ------------------------------------------------------------------------------

function nowPlaying(upcoming = 10) {
	const { audio, queue = [], currentIndex = 0, type, playlistId } = get(songQueue);
	const { song, isPlaying } = get(currentSong);
	if (!song) return { playing: false, note: 'Nothing is playing.' };
	const known = taste();
	const settings = get(userSettings).settings ?? {};
	const from =
		type === 'radio'
			? 'a radio of similar songs'
			: playlistId != null
				? playlistTitle(playlistId)
				: 'songs picked one by one';
	const queued = get(upNext);
	return {
		song: describe(song, known),
		state: isPlaying ? 'playing' : 'paused',
		position: Math.round(audio?.currentTime ?? 0),
		duration: Math.round((audio?.duration || lengthOf(song)) ?? 0) || undefined,
		mod: settings.mod && settings.mod !== 'NM' ? settings.mod : undefined,
		playing_from: from,
		shuffle: settings.shuffle || undefined,
		repeat: settings.repeat && settings.repeat !== 'off' ? settings.repeat : undefined,
		queued_by_user: queued.slice(0, upcoming).map(brief),
		then: queue.slice(currentIndex + 1, currentIndex + 1 + upcoming).map(brief),
		songs_left: queued.length + Math.max(0, queue.length - currentIndex - 1)
	};
}

function playlistTitle(id: unknown) {
	if (id == -1) return 'Downloaded Songs';
	if (id == LIKED_ID) return 'Liked Songs';
	const own = get(playlists).find((p) => p.id == id) ?? get(savedPlaylists).find((p) => p.id == id);
	return own ? `the playlist "${own.title}"` : 'a playlist';
}

// --- Listening -----------------------------------------------------------------------------------

function periodOf(args: Args): { period: Period; from: number; label: string } {
	if (args.days != null) {
		const days = Math.max(1, Math.min(3650, Number(args.days) || 30));
		return { period: 'month', from: now() - days * DAYS, label: `the last ${days} days` };
	}
	const period: Period = ['week', 'month', 'year', 'all'].includes(args.period)
		? args.period
		: 'month';
	const label = {
		week: 'the last 7 days',
		month: 'the last 30 days',
		year: `${new Date().getFullYear()} so far`,
		all: 'all time'
	}[period];
	const from = period === 'all' ? 0 : recapStart(period);
	return { period, from, label };
}

function recapStart(period: Period) {
	const date = new Date();
	if (period === 'year') return new Date(date.getFullYear(), 0, 1).getTime() / 1000;
	return now() - (period === 'week' ? 7 : 30) * DAYS;
}

const minutes = (seconds: number) => Math.round(seconds / 60);
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const getListeningStats: Tool = async (args) => {
	const limit = clamp(args.limit, 3, 50, 15);
	const { period, from, label } = periodOf(args);
	const all = get(history);
	if (!all.plays.length) {
		return { note: 'There is no listening history yet: the user has not played songs in Stosufy.' };
	}
	const data = recap(all, period, new Date(), { from, limit });
	const known = taste();
	const song = (key: string) => songOfKey(key, all.songs[key]);
	const ranked = (list: { name: string; plays: number; seconds: number }[]) =>
		list.map(({ name, plays, seconds }) => ({ name, plays, minutes: minutes(seconds) }));

	// Skipped again and again (in this time), and loved once but not heard for a month
	const inPeriod = all.plays.filter(([, at]) => at >= from);
	const skipped = new Map<string, { skips: number; plays: number }>();
	for (const [key, , heard, length] of inPeriod) {
		const entry = skipped.get(key) ?? { skips: 0, plays: 0 };
		if (counts(heard, length)) entry.plays++;
		else entry.skips++;
		skipped.set(key, entry);
	}
	const oftenSkipped = [...skipped]
		.filter(([, { skips, plays }]) => skips >= 2 && skips >= plays * 2)
		.sort(([, a], [, b]) => b.skips - a.skips)
		.slice(0, limit)
		.flatMap(([key, { skips, plays }]) => {
			const one = song(key);
			return one ? [{ ...brief(one), skips, plays }] : [];
		});
	const month = now() - 30 * DAYS;
	const forgotten = [...known.plays]
		.filter(([key, entry]) => entry.last < month && (entry.plays >= 5 || known.liked.has(key)))
		.sort(([, a], [, b]) => b.plays - a.plays)
		.slice(0, limit)
		.flatMap(([key]) => {
			const one = song(key);
			return one ? [describe(one, known)] : [];
		});

	const peak = data.hours.indexOf(Math.max(...data.hours));
	return {
		period: `${label}${from > 0 ? ` (${day(from)} to ${day(now())})` : ''}`,
		totals: {
			plays: data.plays,
			minutes: minutes(data.seconds),
			songs: data.songs,
			artists: data.artists,
			days_with_music: data.days,
			longest_streak_days: data.streak,
			skips: data.skips,
			skip_rate:
				data.plays + data.skips
					? `${Math.round((data.skips / (data.plays + data.skips)) * 100)}%`
					: undefined
		},
		top_songs: data.topSongs.flatMap(({ key, plays, seconds }) => {
			const one = song(key);
			return one
				? [describe(one, known, { plays_in_period: plays, minutes_in_period: minutes(seconds) })]
				: [];
		}),
		top_artists: ranked(data.topArtists),
		top_sources: ranked(data.topSources),
		top_genres: ranked(data.topGenres),
		top_languages: ranked(data.topLanguages),
		top_mappers: ranked(data.topMappers),
		usual_bpm: data.bpm ?? undefined,
		minutes_by_hour: data.hours.map((value) => Math.round(value)),
		peak_hour: data.plays ? `${String(peak).padStart(2, '0')}:00` : undefined,
		minutes_by_weekday: Object.fromEntries(
			WEEKDAY_NAMES.map((name, i) => [name, Math.round(data.weekdays[i])])
		),
		busiest_day: data.busiestDay
			? {
					date: day(data.busiestDay.date.getTime() / 1000),
					minutes: minutes(data.busiestDay.seconds)
				}
			: undefined,
		on_repeat: data.onRepeat
			? {
					song: brief(fromKept(data.onRepeat.song)),
					plays: data.onRepeat.plays,
					date: day(data.onRepeat.date.getTime() / 1000)
				}
			: undefined,
		new_songs: data.newSongs || undefined,
		best_new_find: data.bestFind
			? { ...brief(fromKept(data.bestFind.song)), plays: data.bestFind.plays }
			: undefined,
		often_skipped: oftenSkipped,
		forgotten_favourites: forgotten,
		history_since: data.since ? day(data.since) : undefined
	};
};

/** A song the history kept, with the id the tools take */
const fromKept = (kept: {
	setId: number | string;
	track: number;
	title: string;
	artist: string;
}) => ({
	id: kept.setId,
	track: kept.track,
	title: kept.title,
	artist: kept.artist
});

function timeOf(text: unknown, fallback: number) {
	if (text == null || text === '') return fallback;
	const at = Date.parse(String(text));
	if (Number.isNaN(at)) throw new ToolError(`"${text}" isn't a date (use e.g. 2026-11-01).`);
	return at / 1000;
}

const getListeningHistory: Tool = async (args) => {
	const limit = clamp(args.limit, 1, 500, 50);
	const days = Math.max(0.01, Math.min(3650, Number(args.days) || 7));
	const from = timeOf(args.since, now() - days * DAYS);
	const until = timeOf(args.until, Infinity);
	const only = args.song ? parseSongId(args.song) : null;
	if (args.song && !only) throw new ToolError(`"${args.song}" isn't a song id.`);
	const { plays, songs } = get(history);
	const matching: Play[] = [];
	for (let i = plays.length - 1; i >= 0; i--) {
		const play = plays[i];
		const [key, at, heard, length] = play;
		if (at < from) break;
		if (at > until) continue;
		if (only && key !== `${only.set}:${only.track}`) continue;
		if (!args.include_skips && !counts(heard, length)) continue;
		matching.push(play);
	}
	return {
		from: moment(from),
		until: until === Infinity ? 'now' : moment(until),
		total: matching.length,
		plays: matching.slice(0, limit).map(([key, at, heard, length]) => {
			const kept = songs[key];
			return {
				at: moment(at),
				...(kept ? brief(fromKept(kept)) : { id: key }),
				heard: Math.round(heard),
				...(counts(heard, length) ? {} : { skipped: true })
			};
		}),
		more: matching.length > limit || undefined
	};
};

// --- The library ----------------------------------------------------------------------------------

function top(values: (string | null | undefined)[], count = 10) {
	const tally = new Map<string, number>();
	for (const value of values) if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
	return Object.fromEntries([...tally].sort((a, b) => b[1] - a[1]).slice(0, count));
}

function quartiles(values: number[]) {
	const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
	if (!sorted.length) return undefined;
	const at = (q: number) => Math.round(sorted[Math.floor((sorted.length - 1) * q)]);
	return {
		lowest: at(0),
		quarter: at(0.25),
		median: at(0.5),
		three_quarters: at(0.75),
		highest: at(1)
	};
}

const getLibraryOverview: Tool = async () => {
	const library = librarySongs();
	const all = get(history);
	const own = get(playlists).filter((p) => Number(p.id) > 0);
	const settings = get(userSettings).settings ?? {};
	return {
		user: get(user)?.username ?? undefined,
		logged_in: !!get(keyStore).access_token,
		downloaded_songs: library.length,
		playlists: own.length,
		smart_playlists: get(smartPlaylists).length,
		saved_playlists_of_others: get(savedPlaylists).length,
		liked_songs: get(favourites).length,
		plays_in_history: all.plays.filter(([, , heard, length]) => counts(heard, length)).length,
		history_since: all.plays[0] ? day(all.plays[0][1]) : undefined,
		streaming: settings.stream
			? "on: songs that aren't downloaded play in full"
			: "off: songs that aren't downloaded play a short preview until they're downloaded",
		can_download: get(keyStore).sessionKey
			? true
			: 'no: the osu! session key is missing (Settings → Library)',
		library: library.length
			? {
					top_artists: top(library.flatMap((song) => artistsOf(song.artist ?? ''))),
					top_sources: top(library.map(sourceOf)),
					genres: top(
						library.map((song) => (typeof song.genre === 'string' ? song.genre : null)),
						12
					),
					languages: top(
						library.map((song) => (typeof song.language === 'string' ? song.language : null)),
						13
					),
					bpm: quartiles(library.map((song) => tempoOf(song) ?? 0)),
					length_seconds: quartiles(library.map((song) => lengthOf(song) ?? 0))
				}
			: undefined
	};
};

const searchLibrary: Tool = async (args) => {
	const limit = clamp(args.limit, 1, 300, 50);
	const offset = clamp(args.offset, 0, 1e6, 0);
	const known = taste();
	const words = normal(args.query).split(/\s+/).filter(Boolean);
	const month = now() - 30 * DAYS;
	const matches: { song: MapSet; score: number }[] = [];
	for (const song of librarySongs().reverse()) {
		const fields = {
			title: normal(`${song.title} ${song.title_unicode ?? ''}`),
			artist: normal(`${song.artist} ${song.artist_unicode ?? ''}`),
			source: normal(sourceOf(song)),
			tags: normal(song.tags),
			mapper: normal(song.creator)
		};
		let score = 0;
		let all = true;
		for (const word of words) {
			const weight =
				(fields.title.includes(word) ? 3 : 0) +
				(fields.artist.includes(word) ? 3 : 0) +
				(fields.source.includes(word) ? 2 : 0) +
				(fields.tags.includes(word) ? 1 : 0) +
				(fields.mapper.includes(word) ? 1 : 0);
			if (!weight) {
				all = false;
				break;
			}
			score += weight;
		}
		if (!all) continue;
		if (args.artist && !fields.artist.includes(normal(args.artist))) continue;
		if (args.source && !fields.source.includes(normal(args.source))) continue;
		if (args.genre && normal(song.genre) !== normal(args.genre)) continue;
		if (args.language && normal(song.language) !== normal(args.language)) continue;
		const bpm = tempoOf(song);
		if (args.bpm_min != null && !(bpm && bpm >= args.bpm_min)) continue;
		if (args.bpm_max != null && !(bpm && bpm <= args.bpm_max)) continue;
		const length = lengthOf(song);
		if (args.length_min != null && !(length && length >= args.length_min)) continue;
		if (args.length_max != null && !(length && length <= args.length_max)) continue;
		const key = songKey(song);
		if (args.liked != null && known.liked.has(key) !== !!args.liked) continue;
		const entry = known.plays.get(key);
		const plays = entry?.plays ?? 0;
		if (args.played === 'never' && plays > 0) continue;
		if (args.played === 'ever' && plays < 1) continue;
		if (args.played === 'often' && plays < 5) continue;
		if (args.played === 'not_lately' && !(plays > 0 && (entry?.last ?? 0) < month)) continue;
		matches.push({ song, score });
	}
	const plays = (song: MapSet) => known.plays.get(songKey(song));
	const text = (value: unknown) => normal(value);
	const sorters: Record<string, (a: MapSet, b: MapSet) => number> = {
		most_played: (a, b) => (plays(b)?.plays ?? 0) - (plays(a)?.plays ?? 0),
		recently_played: (a, b) => (plays(b)?.last ?? 0) - (plays(a)?.last ?? 0),
		least_recently_played: (a, b) => (plays(a)?.last ?? 0) - (plays(b)?.last ?? 0),
		recently_added: (a, b) => Number(b.created_at || 0) - Number(a.created_at || 0),
		bpm: (a, b) => (tempoOf(b) ?? 0) - (tempoOf(a) ?? 0),
		length: (a, b) => (lengthOf(b) ?? 0) - (lengthOf(a) ?? 0),
		title: (a, b) => text(a.title).localeCompare(text(b.title)),
		artist: (a, b) => text(a.artist).localeCompare(text(b.artist))
	};
	const sort = String(args.sort ?? 'relevance');
	if (sort === 'random') {
		for (let i = matches.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[matches[i], matches[j]] = [matches[j], matches[i]];
		}
	} else if (sorters[sort]) {
		matches.sort((a, b) => sorters[sort](a.song, b.song));
	} else if (words.length) {
		matches.sort((a, b) => b.score - a.score);
	}
	return {
		total: matches.length,
		library_size: librarySongs().length,
		songs: matches.slice(offset, offset + limit).map(({ song }) => describe(song, known)),
		next_offset: offset + limit < matches.length ? offset + limit : undefined
	};
};

// --- osu! ---------------------------------------------------------------------------------------

const RANKED_LIKE = new Set(['ranked', 'loved', 'leaderboard', 'qualified']);

function osuSort(sort: string, status: string) {
	const ranked = RANKED_LIKE.has(status);
	return (
		{
			plays: 'plays_desc',
			favourites: 'favourites_desc',
			rating: 'rating_desc',
			newest: ranked ? 'ranked_desc' : 'updated_desc',
			oldest: ranked ? 'ranked_asc' : 'updated_asc',
			title: 'title_asc',
			artist: 'artist_asc',
			difficulty: 'difficulty_desc'
		}[sort] ?? ''
	);
}

const searchOsu: Tool = async (args) => {
	needLogin();
	needOnline();
	const limit = clamp(args.limit, 1, 50, 25);
	const status = String(args.status ?? 'any');
	// (a cursor of ours: osu!'s page and how far into it the results before went)
	const [pageCursor = '', skip = '0'] = String(args.cursor ?? '').split('~');
	const result = await fetchMaps(String(args.query ?? ''), pageCursor, {
		status,
		sort: osuSort(String(args.sort ?? 'relevance'), status),
		genre: idOfName(GENRES, args.genre),
		language: idOfName(LANGUAGES, args.language)
	});
	const sets: any[] = result?.beatmapsets ?? [];
	const start = Number(skip) || 0;
	const songs = sets.slice(start, start + limit).map(songFromSearch);
	remember(songs);
	const known = taste();
	const next =
		start + limit < sets.length
			? `${pageCursor}~${start + limit}`
			: result?.cursor_string
				? `${result.cursor_string}~0`
				: undefined;
	return {
		total: result?.total ?? songs.length,
		songs: songs.map((song) => describe(song, known, { osu: true })),
		next_cursor: next
	};
};

const getSongDetails: Tool = async (args) => {
	const ids = songIds(args.songs).slice(0, 20);
	const { songs, missing } = await resolveSongs(ids);
	const known = taste();
	const firstPlays = new Map<string, number>();
	for (const [key, at, heard, length] of get(history).plays) {
		if (!firstPlays.has(key) && counts(heard, length)) firstPlays.set(key, at);
	}
	const online = !!get(keyStore).access_token && !get(offline);
	const cache = get(playlistSongsCache);
	const inPlaylists = (song: MapSet) => [
		...get(playlists)
			.filter((p) => Number(p.id) > 0 || p.id == LIKED_ID)
			.filter((p) => cache[p.id]?.songs?.some((other) => sameSong(other, song)))
			.map((p) => p.title),
		...get(smartPlaylists)
			.filter((p) =>
				[...p.seeds, ...p.filled].some(
					(other) => `${other.id}:${other.track ?? 0}` === songKey(song)
				)
			)
			.map((p) => p.title)
	];
	const details = await Promise.all(
		songs.map(async (song) => {
			// osu!'s own view of the set: popularity, status, every difficulty
			const set = online && Number(song.id) > 0 ? await osuSet(String(song.id)) : null;
			const facts = set ? { ...song, ...pick(set, OSU_FIELDS), beatmaps: set.beatmaps } : song;
			const stored = get(mapDataStore)[String(song.id)];
			const maps = set?.beatmaps ?? Object.values(stored?.beatmaps ?? {});
			const key = songKey(song);
			return describe(
				{ ...facts, beatmaps: song.beatmaps?.length ? song.beatmaps : facts.beatmaps },
				known,
				{
					osu: true,
					title_unicode: set?.title_unicode !== song.title ? set?.title_unicode : undefined,
					artist_unicode: set?.artist_unicode !== song.artist ? set?.artist_unicode : undefined,
					tags:
						tagList(set?.tags ?? song.tags)
							.slice(0, 30)
							.join(' ') || undefined,
					difficulties: maps
						.map((map: any) => ({
							name: map.version,
							stars: Math.round(Number(map.difficulty_rating) * 100) / 100 || undefined,
							mode: map.mode && map.mode !== 'osu' ? map.mode : undefined
						}))
						.filter((map) => map.name)
						.sort((a, b) => (a.stars ?? 0) - (b.stars ?? 0))
						.slice(0, 20),
					first_played: firstPlays.has(key) ? day(firstPlays.get(key)!) : undefined,
					in_playlists: inPlaylists(song),
					link: Number(song.id) > 0 ? `https://osu.ppy.sh/beatmapsets/${song.id}` : undefined
				}
			);
		})
	);
	return { songs: details, not_found: missing.length ? missing : undefined };
};

const OSU_FIELDS = [
	'status',
	'play_count',
	'favourite_count',
	'ranked_date',
	'submitted_date',
	'genre',
	'language',
	'songSource',
	'tags',
	'bpm'
];
const pick = (from: any, keys: string[]) =>
	Object.fromEntries(
		keys.filter((key) => from?.[key] != null && from[key] !== '').map((key) => [key, from[key]])
	);

// --- Similar songs ----------------------------------------------------------------------------

/** The user's most played songs of the last 30 days (else of all time) */
function topSongs(count: number): MapSet[] {
	const all = get(history);
	for (const from of [now() - 30 * DAYS, 0]) {
		const data = recap(all, 'month', new Date(), { from, limit: count });
		const songs = data.topSongs.flatMap(({ key }) => songOfKey(key, all.songs[key]) ?? []);
		if (songs.length >= Math.min(3, count)) return songs;
	}
	return [];
}

const findSimilarSongs: Tool = async (args) => {
	const limit = clamp(args.limit, 1, 150, 40);
	let seeds: MapSet[];
	let basedOn: string;
	if (Array.isArray(args.seeds) && args.seeds.length) {
		const { songs, missing } = await resolveSongs(args.seeds.slice(0, 25));
		if (!songs.length)
			throw new ToolError(`None of these are songs Stosufy knows: ${missing.join(', ')}`);
		seeds = songs;
		basedOn = 'the given songs';
	} else {
		seeds = topSongs(8);
		if (!seeds.length) {
			throw new ToolError(
				'The user has no listening history yet: give seeds (song ids) to start from.'
			);
		}
		basedOn = "the user's most played songs lately";
	}
	const excluded = new Set([
		...seeds.map(songKey),
		...(Array.isArray(args.exclude) ? args.exclude : [])
			.map(parseSongId)
			.filter(Boolean)
			.map((id) => `${id!.set}:${id!.track}`)
	]);
	const names = new Set(seeds.map(songName));
	const known = taste();
	const fit = fitTo(seeds);
	const heard = (song: MapSet) => {
		const entry = known.plays.get(songKey(song));
		return !!entry && entry.plays + entry.skips > 0;
	};

	type Candidate = { song: MapSet; score: number; alike: number };
	const candidates: Candidate[] = [];
	for (const song of librarySongs()) {
		if (excluded.has(songKey(song)) || (args.only_new && heard(song))) continue;
		const { alike, taste: liking } = fit(song);
		candidates.push({ song, alike, score: alike + liking + 0.5 });
	}
	let osuNote: string | undefined;
	if (args.include_osu !== false) {
		if (!get(keyStore).access_token || get(offline)) {
			osuNote = 'osu! was left out: the user is offline or not logged in.';
		} else {
			const downloaded = get(mapDataStore);
			const found = await searchOnline(seeds);
			remember(found);
			for (const song of found) {
				if (downloaded[song.id] || excluded.has(songKey(song))) continue;
				if (args.only_new && heard(song)) continue;
				const { alike, taste: liking } = fit(song);
				const plays = Number(song.play_count) || 0;
				const popular = Math.max(0, Math.min(1.5, (Math.log10(plays + 1) - 4) * 0.75));
				candidates.push({ song, alike, score: alike + liking + popular });
			}
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	const picked: Candidate[] = [];
	for (const candidate of candidates) {
		if (picked.length >= limit) break;
		if (candidate.alike < 0.5) continue;
		const name = songName(candidate.song);
		// (one version of each song)
		if (names.has(name)) continue;
		names.add(name);
		picked.push(candidate);
	}
	return {
		based_on: basedOn,
		seeds: seeds.map(brief),
		songs: picked.map(({ song, score }) =>
			describe(song, known, {
				osu: !isDownloaded(song),
				match: Math.round(score * 10) / 10,
				why: alikeReasons(seeds, song).slice(0, 4).join('; ') || undefined
			})
		),
		note: osuNote
	};
};

const getOsuProfileSongs: Tool = async (args) => {
	needLogin();
	needOnline();
	const list = String(args.list) as ProfileList;
	if (!['favourite', 'most_played', 'best'].includes(list)) {
		throw new ToolError('list is one of favourite, most_played or best.');
	}
	const limit = clamp(args.limit, 1, 500, 50);
	if (!get(user)?.id)
		throw new ToolError("Stosufy doesn't know the user's osu! profile yet. Try again in a moment.");
	const songs = await loadList(list);
	remember(songs);
	const known = taste();
	return {
		list,
		total: songs.length,
		songs: songs.slice(0, limit).map((song) => describe(song, known, { osu: true }))
	};
};

// --- Playlists ------------------------------------------------------------------------------

type Found =
	| { kind: 'liked' }
	| { kind: 'downloaded' }
	| { kind: 'smart'; playlist: SmartPlaylist }
	| { kind: 'playlist'; playlist: Playlist }
	| { kind: 'saved'; playlist: Playlist };

function findPlaylist(value: unknown): Found {
	const id = String(value ?? '').trim();
	if (!id) throw new ToolError('Give a playlist id (from list_playlists).');
	const lower = id.toLowerCase();
	if (['liked', 'liked songs', String(LIKED_ID)].includes(lower)) return { kind: 'liked' };
	if (['downloaded', 'downloaded songs', '-1'].includes(lower)) return { kind: 'downloaded' };
	const smartId = lower.startsWith('smart:') ? id.slice(6) : id;
	const smart = get(smartPlaylists).find((p) => p.id === smartId);
	if (smart) return { kind: 'smart', playlist: smart };
	const own = get(playlists).find((p) => Number(p.id) > 0 && String(p.id) === id);
	if (own) return { kind: 'playlist', playlist: own };
	const saved = get(savedPlaylists).find((p) => String(p.id) === id);
	if (saved) return { kind: 'saved', playlist: saved };
	// (by its title, the way the user calls it)
	const byTitle = (p: { title: string }) => normal(p.title) === normal(id);
	const ownByTitle = get(playlists).find((p) => Number(p.id) > 0 && byTitle(p));
	if (ownByTitle) return { kind: 'playlist', playlist: ownByTitle };
	const smartByTitle = get(smartPlaylists).find(byTitle);
	if (smartByTitle) return { kind: 'smart', playlist: smartByTitle };
	throw new ToolError(`There's no playlist "${id}". list_playlists shows them.`);
}

const listPlaylists: Tool = async () => {
	const library = librarySongs().length;
	return {
		playlists: [
			{ id: 'liked', title: 'Liked Songs', kind: 'liked', songs: get(favourites).length },
			{ id: 'downloaded', title: 'Downloaded Songs', kind: 'downloaded', songs: library },
			...get(playlists)
				.filter((p) => Number(p.id) > 0)
				.map((p) => ({
					id: String(p.id),
					title: p.title,
					kind: 'playlist',
					songs: p.song_amount,
					description: p.description || undefined,
					public: p.public || undefined
				})),
			...get(smartPlaylists).map((p) => ({
				id: `smart:${p.id}`,
				title: p.title,
				kind: 'smart',
				songs: p.seeds.length + p.filled.length,
				based_on: p.seeds.length,
				fills_up_to: p.size
			})),
			...get(savedPlaylists).map((p) => ({
				id: String(p.id),
				title: p.title,
				kind: 'saved (of someone else)',
				by: p.creator?.username ?? undefined,
				songs: p.song_amount
			}))
		]
	};
};

async function songsOf(found: Found): Promise<MapSet[]> {
	switch (found.kind) {
		case 'downloaded':
			return librarySongs().reverse();
		case 'smart':
			return smartSongs(found.playlist);
		case 'liked': {
			needLogin();
			return (await getPlaylistSongs(LIKED_ID)).songs;
		}
		default: {
			needLogin();
			const { songs, error } = await getPlaylistSongs(found.playlist.id);
			if (error && !songs.length) throw new ToolError(`The playlist couldn't be loaded: ${error}`);
			return songs;
		}
	}
}

const titleOf = (found: Found) =>
	found.kind === 'liked'
		? 'Liked Songs'
		: found.kind === 'downloaded'
			? 'Downloaded Songs'
			: found.playlist.title;

const getPlaylistSongsTool: Tool = async (args) => {
	const found = findPlaylist(args.playlist);
	const limit = clamp(args.limit, 1, 1000, 200);
	const offset = clamp(args.offset, 0, 1e6, 0);
	const songs = await songsOf(found);
	const known = taste();
	return {
		playlist: { title: titleOf(found), kind: found.kind },
		total: songs.length,
		songs: songs.slice(offset, offset + limit).map((song) => describe(song, known)),
		next_offset: offset + limit < songs.length ? offset + limit : undefined
	};
};

/** Puts a new playlist in the list (after Downloaded and Liked Songs, like the app does) */
function listNewPlaylist(playlist: Playlist) {
	playlists.update((all) => {
		const virtual = all.filter((p) => Number(p.id) <= 0);
		return [...virtual, playlist, ...all.filter((p) => Number(p.id) > 0)];
	});
}

function setCount(id: Playlist['id'], count: number) {
	playlists.update((all) => all.map((p) => (p.id == id ? { ...p, song_amount: count } : p)));
}

/** Adds songs one after another (the playlist keeps their order); resolves once all are in */
function addAll(id: Playlist['id'], songs: MapSet[]) {
	let added = 0;
	let failed = 0;
	const work = (async () => {
		for (const song of songs) {
			if (await addSongToPlaylist(id, song)) added++;
			else failed++;
		}
	})();
	return { work, counts: () => ({ added, failed }) };
}

function download(songs: MapSet[]) {
	const missing = songs.filter((song) => !isDownloaded(song) && Number(song.id) > 0);
	if (!missing.length) return undefined;
	if (!get(keyStore).sessionKey) {
		return `${missing.length} songs aren't downloaded, and Stosufy can't download them: the osu! session key is missing (Settings → Library).`;
	}
	queueDownloads(missing.map((song) => ({ set: song, mapId: song.beatmaps?.[0]?.id ?? song.id })));
	return `Downloading ${missing.length} songs in the background.`;
}

const createPlaylistTool: Tool = async (args) => {
	needLogin();
	needOnline();
	const title = String(args.title ?? '')
		.trim()
		.slice(0, 100);
	if (!title) throw new ToolError('The playlist needs a title.');
	const { songs, missing } = await resolveSongs(songIds(args.songs).slice(0, 500));
	if (!songs.length)
		throw new ToolError(`None of these are songs Stosufy knows: ${missing.join(', ')}`);
	let playlist = await createPlaylist(title);
	listNewPlaylist(playlist);
	const description = String(args.description ?? '')
		.trim()
		.slice(0, 300);
	if (description || args.public) {
		playlist = await editPlaylist(playlist.id, title, description, !!args.public);
		playlists.update((all) => all.map((p) => (p.id == playlist.id ? { ...p, ...playlist } : p)));
	}
	// (shown filling up while the songs go in)
	playlistSongsCache.update((cache) => ({ ...cache, [playlist.id]: { songs: [] } }));
	if (args.open !== false) show(`/playlist/${playlist.id}`);
	const adding = addAll(playlist.id, songs);
	const done = await within(adding.work);
	const { added, failed } = adding.counts();
	if (done) setCount(playlist.id, added);
	showToast(`Claude made the playlist "${title}"`, 'icon-[mingcute--ai-line]', 4000);
	const downloading = args.download ? download(songs) : undefined;
	if (args.play) await setSongQueue(0, songs, 'playlist', playlist.id);
	return {
		id: String(playlist.id),
		title,
		songs: done ? added : songs.length,
		note:
			[
				done
					? undefined
					: `${added} songs are in so far; the other ${songs.length - added} are still being added in the background.`,
				failed ? `${failed} songs couldn't be added.` : undefined,
				downloading
			]
				.filter(Boolean)
				.join(' ') || undefined,
		not_found: missing.length ? missing : undefined
	};
};

async function setLikes(songs: MapSet[], liked: boolean) {
	needLogin();
	const known = taste();
	const changing = songs.filter((song) => known.liked.has(songKey(song)) !== liked);
	for (const song of changing) {
		const setId = Number(song.id);
		const mapId = Number(song.beatmaps?.[0]?.id);
		if (setId > 0 && mapId > 0)
			await api.setFavourite(get(keyStore).access_token, setId, mapId, liked);
	}
	await loadFavourites();
	await getPlaylistSongs(LIKED_ID, true);
	return changing.length;
}

const addToPlaylist: Tool = async (args) => {
	const found = findPlaylist(args.playlist);
	const { songs, missing } = await resolveSongs(songIds(args.songs).slice(0, 500));
	const notFound = missing.length ? missing : undefined;
	if (found.kind === 'downloaded' || found.kind === 'saved') {
		throw new ToolError(
			found.kind === 'saved'
				? "That's someone else's playlist; it can't be changed."
				: 'Songs get into Downloaded Songs by downloading them (create_playlist with download).'
		);
	}
	if (found.kind === 'liked') {
		const added = await setLikes(songs, true);
		if (added)
			showToast(
				`Claude liked ${added} ${added === 1 ? 'song' : 'songs'}`,
				'icon-[mingcute--heart-fill]'
			);
		return {
			playlist: 'Liked Songs',
			added,
			already_in: songs.length - added,
			not_found: notFound
		};
	}
	if (found.kind === 'smart') {
		let added = 0;
		for (const song of songs) if (addSeed(found.playlist.id, song)) added++;
		return {
			playlist: found.playlist.title,
			added,
			already_in: songs.length - added,
			not_found: notFound
		};
	}
	needLogin();
	needOnline();
	const { id, title } = found.playlist;
	const existing = (await getPlaylistSongs(id)).songs;
	const fresh = songs.filter((song) => !existing.some((other) => sameSong(other, song)));
	const adding = addAll(id, fresh);
	const done = await within(adding.work);
	const { added, failed } = adding.counts();
	if (done) setCount(id, existing.length + added);
	if (added)
		showToast(
			`Claude added ${added} ${added === 1 ? 'song' : 'songs'} to "${title}"`,
			'icon-[mingcute--ai-line]'
		);
	return {
		playlist: title,
		added: done ? added : fresh.length,
		already_in: songs.length - fresh.length,
		note: !done
			? `${added} are in so far, the rest is still being added.`
			: failed
				? `${failed} couldn't be added.`
				: undefined,
		not_found: notFound
	};
};

/** The song of a playlist that a song id means (a set's first song for a bare set id) */
function inList(list: MapSet[], id: { set: string; track: number }) {
	return (
		list.find((song) => String(song.id) === id.set && (song.track ?? 0) === id.track) ??
		(id.track === 0 ? list.find((song) => String(song.id) === id.set) : undefined)
	);
}

const removeFromPlaylist: Tool = async (args) => {
	const found = findPlaylist(args.playlist);
	const ids = songIds(args.songs)
		.map(parseSongId)
		.filter((id): id is { set: string; track: number } => !!id);
	if (found.kind === 'downloaded' || found.kind === 'saved') {
		throw new ToolError(
			found.kind === 'saved'
				? "That's someone else's playlist; it can't be changed."
				: "Downloaded songs aren't removed this way; the user deletes them in the app."
		);
	}
	const list = await songsOf(found);
	const songs = ids.map((id) => inList(list, id)).filter((song): song is MapSet => !!song);
	const notIn = ids.length - songs.length;
	if (found.kind === 'liked') {
		const removed = await setLikes(songs, false);
		return { playlist: 'Liked Songs', removed, not_in_playlist: notIn || undefined };
	}
	if (found.kind === 'smart') {
		for (const song of songs) removeSong(found.playlist.id, song);
		return {
			playlist: found.playlist.title,
			removed: songs.length,
			not_in_playlist: notIn || undefined
		};
	}
	needOnline();
	for (const song of songs) {
		if (song.songInfo?.id != null)
			await removeSongFromPlaylist(found.playlist.id, song.songInfo.id);
	}
	if (songs.length)
		showToast(
			`Claude took ${songs.length} ${songs.length === 1 ? 'song' : 'songs'} out of "${found.playlist.title}"`,
			'icon-[mingcute--ai-line]'
		);
	return {
		playlist: found.playlist.title,
		removed: songs.length,
		not_in_playlist: notIn || undefined
	};
};

const editPlaylistTool: Tool = async (args) => {
	const found = findPlaylist(args.playlist);
	const title = args.title != null ? String(args.title).trim().slice(0, 100) : undefined;
	if (title === '') throw new ToolError("The title can't be empty.");
	if (found.kind === 'smart') {
		const size = [25, 50, 100].includes(Number(args.size)) ? Number(args.size) : undefined;
		updateSmartPlaylist(found.playlist.id, { ...(title && { title }), ...(size && { size }) });
		if (size) await within(autofill(found.playlist.id));
		return { playlist: title ?? found.playlist.title, changed: true };
	}
	if (found.kind !== 'playlist') throw new ToolError(`"${titleOf(found)}" can't be edited.`);
	needLogin();
	needOnline();
	const { playlist } = found;
	const saved = await editPlaylist(
		playlist.id,
		title ?? playlist.title,
		args.description != null
			? String(args.description).slice(0, 300)
			: (playlist.description ?? ''),
		args.public != null ? !!args.public : !!playlist.public
	);
	playlists.update((all) => all.map((p) => (p.id == playlist.id ? { ...p, ...saved } : p)));
	return {
		playlist: saved.title,
		description: saved.description || undefined,
		public: !!saved.public
	};
};

const createSmartPlaylistTool: Tool = async (args) => {
	const title = String(args.title ?? '')
		.trim()
		.slice(0, 100);
	if (!title) throw new ToolError('The smart playlist needs a title.');
	const { songs, missing } = await resolveSongs(songIds(args.seeds, 'seeds').slice(0, 25));
	if (!songs.length)
		throw new ToolError(`None of these are songs Stosufy knows: ${missing.join(', ')}`);
	const size = [25, 50, 100].includes(Number(args.size)) ? Number(args.size) : 50;
	const { id } = createSmartPlaylist();
	updateSmartPlaylist(id, {
		title,
		seeds: songs.map((song) => toSmartSong(song, true)),
		size,
		online: args.include_osu !== false
	});
	if (args.open !== false) show(`/smart/${id}`);
	const done = await within(autofill(id));
	showToast(`Claude made the smart playlist "${title}"`, 'icon-[mingcute--ai-line]', 4000);
	const playlist = get(smartPlaylists).find((p) => p.id === id);
	const known = taste();
	return {
		id: `smart:${id}`,
		title,
		based_on: songs.length,
		songs: playlist ? smartSongs(playlist).map((song) => brief(song)) : [],
		note: done ? undefined : 'Stosufy is still filling it.',
		not_found: missing.length ? missing : undefined,
		liked_among_them: playlist
			? smartSongs(playlist).filter((song) => known.liked.has(songKey(song))).length || undefined
			: undefined
	};
};

// --- Playing ---------------------------------------------------------------------------------

function shuffled<T>(items: T[]) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

const play: Tool = async (args) => {
	let songs: MapSet[] = [];
	let playlistId: Playlist['id'] | null = null;
	let missing: string[] = [];
	if (args.playlist != null && args.playlist !== '') {
		const found = findPlaylist(args.playlist);
		songs = await songsOf(found);
		playlistId =
			found.kind === 'liked'
				? LIKED_ID
				: found.kind === 'downloaded'
					? -1
					: found.kind === 'smart'
						? null
						: found.playlist.id;
	} else {
		({ songs, missing } = await resolveSongs(songIds(args.songs).slice(0, 500)));
	}
	if (!songs.length) throw new ToolError('There are no songs to play.');
	if (args.shuffle) songs = shuffled(songs);
	const mode = String(args.mode ?? 'now');
	const before = get(currentSong).song;
	if (mode === 'radio') await startRadio(songs[0]);
	else if (mode === 'next' && get(songQueue).queue?.length)
		upNext.update((queued) => [...songs, ...queued]);
	else if (mode === 'queue') await queueSongs(songs, playlistId);
	else await setSongQueue(0, songs, 'playlist', playlistId);
	await settle();
	const song = get(currentSong).song;
	if (
		(mode === 'now' || mode === 'radio') &&
		song &&
		before &&
		sameSong(song, before) &&
		!sameSong(song, songs[0])
	) {
		throw new ToolError(
			"Stosufy didn't start these songs: they couldn't be loaded right now, or the user is listening along with a friend (who picks the songs then)."
		);
	}
	return {
		...nowPlaying(5),
		queued: mode === 'next' || mode === 'queue' ? songs.length : undefined,
		not_found: missing.length ? missing : undefined
	};
};

const controlPlayback: Tool = async (args) => {
	const { audio } = get(songQueue);
	if (!audio) throw new ToolError('Nothing is loaded to play.');
	switch (args.action) {
		case 'pause':
			if (!audio.paused) stopPlayback();
			break;
		case 'resume':
			if (audio.paused) togglePlayback();
			break;
		case 'toggle':
			togglePlayback();
			break;
		case 'next':
			await skipForward();
			break;
		case 'previous':
			await skipBackward();
			break;
		default:
			throw new ToolError('action is one of pause, resume, toggle, next or previous.');
	}
	await settle();
	return nowPlaying(3);
};

export const TOOLS: Record<string, Tool> = {
	get_now_playing: async (args) => nowPlaying(clamp(args.upcoming, 0, 50, 10)),
	get_listening_stats: getListeningStats,
	get_listening_history: getListeningHistory,
	get_library_overview: getLibraryOverview,
	search_library: searchLibrary,
	search_osu: searchOsu,
	get_song_details: getSongDetails,
	find_similar_songs: findSimilarSongs,
	get_osu_profile_songs: getOsuProfileSongs,
	list_playlists: listPlaylists,
	get_playlist_songs: getPlaylistSongsTool,
	create_playlist: createPlaylistTool,
	add_to_playlist: addToPlaylist,
	remove_from_playlist: removeFromPlaylist,
	edit_playlist: editPlaylistTool,
	create_smart_playlist: createSmartPlaylistTool,
	play,
	control_playback: controlPlayback
};

// (for the tests: what describes the songs and finds playlists, without the app around it)
export { findPlaylist, songIds, osuSort, periodOf, songId, playCounts };
