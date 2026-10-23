// Wrapped: what the listening history says about a time (the last week, month, this year or
// all of it): the top songs, artists, mappers and genres, when the user listens, and a few
// facts (the longest streak, the song on repeat, the new finds).

import { counts, type History, type HistorySong } from './stores/history';

export type Period = 'week' | 'month' | 'year' | 'all';

const DAY = 86400;

export const PERIODS: { id: Period; label: string }[] = [
	{ id: 'week', label: 'Last 7 days' },
	{ id: 'month', label: 'Last 30 days' },
	{ id: 'year', label: String(new Date().getFullYear()) },
	{ id: 'all', label: 'All time' }
];

/** When a period starts (Unix time, s) */
export function periodStart(period: Period, now = new Date()) {
	const seconds = Math.floor(now.getTime() / 1000);
	if (period === 'week') return seconds - 7 * DAY;
	if (period === 'month') return seconds - 30 * DAY;
	if (period === 'year') return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
	return 0;
}

export interface Ranked {
	name: string;
	plays: number;
	/** Heard for (s) */
	seconds: number;
	/** The song of it heard most (for its cover) */
	top: HistorySong;
}

export interface TopSong {
	key: string;
	song: HistorySong;
	plays: number;
	seconds: number;
}

export interface Recap {
	plays: number;
	/** Heard for (s) */
	seconds: number;
	songs: number;
	artists: number;
	/** Days with music, and the most in a row */
	days: number;
	streak: number;
	topSongs: TopSong[];
	topArtists: Ranked[];
	topMappers: Ranked[];
	topGenres: Ranked[];
	topLanguages: Ranked[];
	/** Where the songs are from (anime, games…) */
	topSources: Ranked[];
	/** Minutes per hour of the day (0–23) and per day of the week (Monday first) */
	hours: number[];
	weekdays: number[];
	busiestDay: { date: Date; seconds: number } | null;
	/** The song played most often in one day (from 3 plays on) */
	onRepeat: { song: HistorySong; plays: number; date: Date } | null;
	/** Songs first heard in this time, and the one of them played most */
	newSongs: number;
	bestFind: TopSong | null;
	/** The tempo of most of the songs (BPM, the median of the plays) */
	bpm: number | null;
	/** Songs left within their first seconds */
	skips: number;
	/** When the history begins (Unix time, s) */
	since: number | null;
}

/** The artists of a song: collaborations ("feat.", "vs.", "×") count for each of them */
export function artistsOf(artist: string) {
	return artist
		.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|×)\s+/i)
		.map((name) => name.trim())
		.filter(Boolean);
}

const dayOf = (at: number) => {
	const date = new Date(at * 1000);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Ranks names by plays (then by time heard), the top `limit` */
function rank(
	entries: Iterable<[string, { plays: number; seconds: number; top: HistorySong; best: number }]>,
	limit: number
): Ranked[] {
	return [...entries]
		.sort(([, a], [, b]) => b.plays - a.plays || b.seconds - a.seconds)
		.slice(0, limit)
		.map(([name, { plays, seconds, top }]) => ({ name, plays, seconds, top }));
}

export function recap(history: History, period: Period, now = new Date()): Recap {
	const from = periodStart(period, now);
	const { songs } = history;
	const firstHeard = new Map<string, number>();
	for (const [key, at, heard, length] of history.plays)
		if (counts(heard, length) && !firstHeard.has(key)) firstHeard.set(key, at);

	const inPeriod = history.plays.filter(([key, at]) => at >= from && songs[key]);
	const played = inPeriod.filter(([, , heard, length]) => counts(heard, length));

	const bySong = new Map<string, { plays: number; seconds: number }>();
	const hours = Array(24).fill(0);
	const weekdays = Array(7).fill(0);
	const byDay = new Map<string, { date: Date; seconds: number; songs: Map<string, number> }>();
	type Tally = { plays: number; seconds: number; top: HistorySong; best: number };
	const tallies = {
		artists: new Map<string, Tally>(),
		mappers: new Map<string, Tally>(),
		genres: new Map<string, Tally>(),
		languages: new Map<string, Tally>(),
		sources: new Map<string, Tally>()
	};
	let seconds = 0;
	const bpms: number[] = [];

	for (const [key, at, heard] of played) {
		const song = songs[key];
		seconds += heard;
		const entry = bySong.get(key) ?? { plays: 0, seconds: 0 };
		entry.plays++;
		entry.seconds += heard;
		bySong.set(key, entry);

		const date = new Date(at * 1000);
		hours[date.getHours()] += heard / 60;
		weekdays[(date.getDay() + 6) % 7] += heard / 60;
		const day = dayOf(at);
		const today = byDay.get(dayKey(day)) ?? { date: day, seconds: 0, songs: new Map() };
		today.seconds += heard;
		today.songs.set(key, (today.songs.get(key) ?? 0) + 1);
		byDay.set(dayKey(day), today);

		const add = (tally: Map<string, Tally>, name: string | null | undefined) => {
			if (!name) return;
			const t = tally.get(name) ?? { plays: 0, seconds: 0, top: song, best: 0 };
			t.plays++;
			t.seconds += heard;
			if (entry.seconds > t.best) {
				t.best = entry.seconds;
				t.top = song;
			}
			tally.set(name, t);
		};
		for (const artist of artistsOf(song.artist)) add(tallies.artists, artist);
		add(tallies.mappers, song.creator);
		// (osu!'s "Unspecified" and "Other" say nothing)
		if (song.genre && !/^(unspecified|other|any)$/i.test(song.genre))
			add(tallies.genres, song.genre);
		if (song.language && !/^(unspecified|other|any)$/i.test(song.language))
			add(tallies.languages, song.language);
		add(tallies.sources, song.source);
		if (song.bpm) bpms.push(song.bpm);
	}

	const topSongs = [...bySong]
		.sort(([, a], [, b]) => b.plays - a.plays || b.seconds - a.seconds)
		.map(([key, { plays, seconds }]) => ({ key, song: songs[key], plays, seconds }));

	// The most days in a row with music
	const days = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
	let streak = 0;
	let run = 0;
	let previous: Date | null = null;
	for (const { date } of days) {
		const next = previous && new Date(previous);
		next?.setDate(next.getDate() + 1);
		run = next && dayKey(next) === dayKey(date) ? run + 1 : 1;
		streak = Math.max(streak, run);
		previous = date;
	}

	let busiestDay: Recap['busiestDay'] = null;
	let onRepeat: Recap['onRepeat'] = null;
	for (const day of days) {
		if (!busiestDay || day.seconds > busiestDay.seconds)
			busiestDay = { date: day.date, seconds: day.seconds };
		for (const [key, plays] of day.songs)
			if (plays >= 3 && (!onRepeat || plays > onRepeat.plays))
				onRepeat = { song: songs[key], plays, date: day.date };
	}

	const found = topSongs.filter(({ key }) => (firstHeard.get(key) ?? 0) >= from);
	bpms.sort((a, b) => a - b);

	return {
		plays: played.length,
		seconds,
		songs: bySong.size,
		artists: tallies.artists.size,
		days: days.length,
		streak,
		topSongs: topSongs.slice(0, 10),
		topArtists: rank(tallies.artists, 8),
		topMappers: rank(tallies.mappers, 8),
		topGenres: rank(tallies.genres, 6),
		topLanguages: rank(tallies.languages, 6),
		topSources: rank(tallies.sources, 6),
		hours,
		weekdays,
		busiestDay,
		onRepeat,
		newSongs: period === 'all' ? 0 : found.length,
		bestFind: period === 'all' ? null : (found[0] ?? null),
		bpm: bpms.length ? Math.round(bpms[Math.floor(bpms.length / 2)]) : null,
		skips: inPeriod.length - played.length,
		since: history.plays[0]?.[1] ?? null
	};
}
