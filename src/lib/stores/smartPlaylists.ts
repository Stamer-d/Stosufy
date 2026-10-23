// Smart playlists: playlists that fill themselves from the library by rules ("170–190 BPM",
// "liked, but not heard for 30 days", "from Demon Slayer"…). They're kept in the settings,
// so they follow the user to every device; their songs are worked out where they're shown.

import { derived, get } from 'svelte/store';
import { userSettings, updateUserSettings } from './user';
import { formatSongData, mapDataStore } from './data';
import { favourites } from './favourites';
import { counts, history, songKey } from './history';
import { songBpm } from '../dj/library';
import { artistsOf } from '../tracks';
import type { MapSet } from '../types';

export type RuleField =
	| 'bpm'
	| 'genre'
	| 'language'
	| 'artist'
	| 'mapper'
	| 'title'
	| 'from'
	| 'liked'
	| 'plays'
	| 'lastPlayed'
	| 'added'
	| 'length'
	| 'stars';

export type RuleOp =
	'between' | 'atLeast' | 'atMost' | 'contains' | 'is' | 'isNot' | 'within' | 'notWithin';

export interface SmartRule {
	field: RuleField;
	op: RuleOp;
	value?: string | number | null;
	/** The upper end of "between" */
	value2?: number | null;
}

export type SmartSort = 'random' | 'added' | 'plays' | 'lastPlayed' | 'title' | 'bpm';

export interface SmartPlaylist {
	id: string;
	title: string;
	/** Songs matching all the rules, or any of them */
	match: 'all' | 'any';
	rules: SmartRule[];
	sort: SmartSort;
	/** At most this many songs (null: all) */
	limit: number | null;
}

/** What a rule can ask about a song */
interface SongFacts {
	song: MapSet;
	bpm: number;
	liked: boolean;
	plays: number;
	/** When it was last heard (Unix time, s; 0: never) */
	last: number;
	/** When it was downloaded (Unix time, s) */
	added: number;
	/** Its length (min) and the hardest difficulty's stars */
	minutes: number;
	stars: number;
}

type Input = 'number' | 'text' | 'choice' | 'none';

export const FIELDS: Record<
	RuleField,
	{ label: string; ops: RuleOp[]; input: Input; unit?: string; choices?: 'genre' | 'language' }
> = {
	bpm: { label: 'BPM', ops: ['between', 'atLeast', 'atMost'], input: 'number' },
	genre: { label: 'Genre', ops: ['is', 'isNot'], input: 'choice', choices: 'genre' },
	language: { label: 'Language', ops: ['is', 'isNot'], input: 'choice', choices: 'language' },
	artist: { label: 'Artist', ops: ['contains', 'isNot'], input: 'text' },
	mapper: { label: 'Mapper', ops: ['contains', 'isNot'], input: 'text' },
	title: { label: 'Title', ops: ['contains', 'isNot'], input: 'text' },
	from: { label: 'From (anime, game…)', ops: ['contains', 'isNot'], input: 'text' },
	liked: { label: 'Liked', ops: ['is', 'isNot'], input: 'none' },
	plays: { label: 'Plays', ops: ['atLeast', 'atMost', 'between'], input: 'number' },
	lastPlayed: {
		label: 'Last played',
		ops: ['notWithin', 'within'],
		input: 'number',
		unit: 'days'
	},
	added: { label: 'Downloaded', ops: ['within', 'notWithin'], input: 'number', unit: 'days' },
	length: { label: 'Length', ops: ['atMost', 'atLeast', 'between'], input: 'number', unit: 'min' },
	stars: { label: 'Stars', ops: ['atLeast', 'atMost', 'between'], input: 'number', unit: '★' }
};

export const OP_LABELS: Record<RuleOp, string> = {
	between: 'between',
	atLeast: 'at least',
	atMost: 'at most',
	contains: 'contains',
	is: 'is',
	isNot: 'is not',
	within: 'in the last',
	notWithin: 'not in the last'
};

export const SORTS: { value: SmartSort; label: string }[] = [
	{ value: 'random', label: 'Random' },
	{ value: 'added', label: 'Newest downloads' },
	{ value: 'plays', label: 'Most played' },
	{ value: 'lastPlayed', label: 'Heard longest ago' },
	{ value: 'title', label: 'Title' },
	{ value: 'bpm', label: 'BPM' }
];

/** A new rule for a field, with its first operator and an example value */
export function newRule(field: RuleField): SmartRule {
	const op = FIELDS[field].ops[0];
	const examples: Partial<Record<RuleField, [number, number?]>> = {
		bpm: [170, 190],
		plays: [5],
		lastPlayed: [30],
		added: [14],
		length: [3],
		stars: [5]
	};
	const choices: Partial<Record<RuleField, string>> = { genre: 'Anime', language: 'Japanese' };
	const [value, value2] = examples[field] ?? [];
	return { field, op, value: value ?? choices[field] ?? '', value2: value2 ?? null };
}

const DAY = 86400;
const text = (value: unknown) =>
	String(value ?? '')
		.trim()
		.toLowerCase();

function matches(rule: SmartRule, facts: SongFacts, now: number) {
	const number = Number(rule.value);
	const compare = (actual: number) => {
		if (rule.op === 'atLeast') return actual >= number;
		if (rule.op === 'atMost') return actual <= number;
		if (rule.op === 'between') {
			const low = Math.min(number, Number(rule.value2 ?? number));
			const high = Math.max(number, Number(rule.value2 ?? number));
			return actual >= low && actual <= high;
		}
		return true;
	};
	const has = (haystack: string[]) => {
		const needle = text(rule.value);
		if (!needle) return true;
		const found = haystack.some((value) => text(value).includes(needle));
		return rule.op === 'isNot' ? !found : found;
	};
	const { song } = facts;
	switch (rule.field) {
		case 'bpm':
			return facts.bpm > 0 && compare(facts.bpm);
		case 'plays':
			return compare(facts.plays);
		case 'length':
			return facts.minutes > 0 && compare(facts.minutes);
		case 'stars':
			return facts.stars > 0 && compare(facts.stars);
		case 'genre':
		case 'language': {
			const same = text(rule.field === 'genre' ? song.genre : song.language) === text(rule.value);
			return rule.op === 'isNot' ? !same : same;
		}
		case 'artist':
			return has([song.artist ?? '', ...artistsOf(song.artist ?? '')]);
		case 'mapper':
			return has([song.creator ?? '']);
		case 'title':
			return has([song.title ?? '']);
		case 'from':
			return has([song.songSource ?? '']);
		case 'liked':
			return rule.op === 'isNot' ? !facts.liked : facts.liked;
		case 'lastPlayed': {
			const recent = facts.last > 0 && now - facts.last <= number * DAY;
			return rule.op === 'within' ? recent : !recent;
		}
		case 'added': {
			const recent = now - facts.added <= number * DAY;
			return rule.op === 'within' ? recent : !recent;
		}
	}
	return true;
}

/** The library with what the rules ask about each song */
function libraryFacts(): SongFacts[] {
	const data = get(mapDataStore);
	const plays = new Map<string, { plays: number; last: number }>();
	for (const [key, at, heard, length] of get(history).plays) {
		const entry = plays.get(key) ?? { plays: 0, last: 0 };
		if (counts(heard, length)) {
			entry.plays++;
			entry.last = Math.max(entry.last, at);
		}
		plays.set(key, entry);
	}
	const liked = get(favourites);
	return formatSongData(data).map((song) => {
		const key = songKey(song);
		const created = Number(song.created_at) || 0;
		const maps = song.beatmaps ?? [];
		return {
			song,
			bpm: songBpm(song, data) || song.bpm || 0,
			liked: liked.some((f) => f.setId == song.id && maps.some((map) => map.id == f.mapId)),
			plays: plays.get(key)?.plays ?? 0,
			last: plays.get(key)?.last ?? 0,
			added: created > 1e12 ? created / 1000 : created,
			minutes: (Number(maps[0]?.total_length) || 0) / 60,
			stars: Math.max(0, ...maps.map((map) => Number(map.difficulty_rating) || 0))
		};
	});
}

/** The songs of a smart playlist, as its rules and order say */
export function smartSongs(playlist: SmartPlaylist): MapSet[] {
	const now = Date.now() / 1000;
	const rules = playlist.rules.filter((rule) => FIELDS[rule.field]);
	const found = libraryFacts().filter((facts) =>
		!rules.length
			? true
			: playlist.match === 'any'
				? rules.some((rule) => matches(rule, facts, now))
				: rules.every((rule) => matches(rule, facts, now))
	);
	const sorters: Record<Exclude<SmartSort, 'random'>, (a: SongFacts, b: SongFacts) => number> = {
		added: (a, b) => b.added - a.added,
		plays: (a, b) => b.plays - a.plays,
		lastPlayed: (a, b) => a.last - b.last,
		title: (a, b) => (a.song.title ?? '').localeCompare(b.song.title ?? ''),
		bpm: (a, b) => a.bpm - b.bpm
	};
	// (random: shuffled again each time it's opened)
	if (playlist.sort === 'random') {
		for (let i = found.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[found[i], found[j]] = [found[j], found[i]];
		}
	} else found.sort(sorters[playlist.sort] ?? sorters.added);
	const songs = found.map(({ song }) => song);
	return playlist.limit ? songs.slice(0, playlist.limit) : songs;
}

/** The user's smart playlists */
export const smartPlaylists = derived(
	userSettings,
	($settings) => ($settings.settings?.smartPlaylists ?? []) as SmartPlaylist[]
);

function save(list: SmartPlaylist[]) {
	updateUserSettings({ smartPlaylists: list });
}

/** Makes a new smart playlist (liked songs not heard for a month, to start from); returns it */
export function createSmartPlaylist(): SmartPlaylist {
	const playlist: SmartPlaylist = {
		id: Math.random().toString(36).slice(2, 10),
		title: 'New smart playlist',
		match: 'all',
		rules: [newRule('liked'), newRule('lastPlayed')],
		sort: 'random',
		limit: null
	};
	save([...get(smartPlaylists), playlist]);
	return playlist;
}

export function updateSmartPlaylist(id: string, change: Partial<SmartPlaylist>) {
	save(get(smartPlaylists).map((p) => (p.id === id ? { ...p, ...change } : p)));
}

export function deleteSmartPlaylist(id: string) {
	save(get(smartPlaylists).filter((p) => p.id !== id));
}
