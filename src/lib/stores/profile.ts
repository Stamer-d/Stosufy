// Profiles: a user's osu! profile, their public playlists and (for the user themselves) what
// their library is made of.

import { fetch } from '@tauri-apps/plugin-http';
import { freshToken } from './auth';
import * as api from '../api';
import { trackGroups } from '../tracks';
import type { MapSet, Playlist, StoredMapSet } from '../types';

export interface OsuProfile {
	id: number;
	username: string;
	avatarUrl: string | null;
	coverUrl: string | null;
	country: { code: string; name: string } | null;
	online: boolean;
	globalRank: number | null;
	pp: number | null;
	playCount: number | null;
	joined: string | null;
	accuracy: number | null;
	/** Global rank each day of the last 90 (oldest first) */
	rankHistory: number[];
	title: string | null;
	/** The colour of the user's group or the one they chose, like #ff66aa */
	colour: string | null;
	supporter: number;
	countryRank: number | null;
	highestRank: { rank: number; at: string } | null;
	rankedScore: number | null;
	totalScore: number | null;
	totalHits: number | null;
	maxCombo: number | null;
	/** Seconds played */
	playTime: number | null;
	replaysWatched: number | null;
	level: { current: number; progress: number } | null;
	grades: { ssh: number; ss: number; sh: number; s: number; a: number };
	followers: number;
	mappingFollowers: number;
	medals: number;
	kudosu: number;
	badges: { image: string; description: string; awarded: string }[];
	groups: { name: string; short: string; colour: string | null }[];
	previousNames: string[];
	lastVisit: string | null;
	location: string | null;
	interests: string | null;
	occupation: string | null;
	website: string | null;
	twitter: string | null;
	discord: string | null;
	/** How many beatmap sets are in each list (see BEATMAP_LISTS) */
	counts: Record<BeatmapList, number> & { firsts: number; best: number };
}

export type BeatmapList =
	| 'ranked'
	| 'loved'
	| 'guest'
	| 'pending'
	| 'graveyard'
	| 'nominated'
	| 'favourite'
	| 'most_played';

export const BEATMAP_LISTS: { id: BeatmapList; label: string }[] = [
	{ id: 'ranked', label: 'Ranked' },
	{ id: 'loved', label: 'Loved' },
	{ id: 'guest', label: 'Guest' },
	{ id: 'pending', label: 'Pending' },
	{ id: 'graveyard', label: 'Graveyarded' },
	{ id: 'nominated', label: 'Nominated' },
	{ id: 'favourite', label: 'Favourites' },
	{ id: 'most_played', label: 'Most played' }
];

/** The osu! API; `latest` asks for the newer formats (only the scores need that) */
async function osuApi(path: string, { latest = false } = {}) {
	let response!: Response;
	for (let attempt = 0; attempt < 3; attempt++) {
		const token = await freshToken(attempt > 0 && response?.status === 401);
		response = await fetch(`https://osu.ppy.sh/api/v2/${path}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				...(latest ? { 'x-api-version': '20240529' } : {})
			}
		});
		if (response.ok || (response.status < 500 && response.status !== 401)) break;
		await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
	}
	if (!response.ok) throw new Error(`osu! answered with HTTP ${response.status}`);
	return response.json();
}

const profiles = new Map<number | string, Promise<OsuProfile>>();

/** A user's osu! profile by id or by name (kept for the session) */
export function osuProfile(osuId: number | string): Promise<OsuProfile> {
	if (!profiles.has(osuId)) {
		const loading = (async () => {
			const byName = typeof osuId === 'string' && !/^\d+$/.test(osuId);
			const user = await osuApi(
				`users/${encodeURIComponent(osuId)}/osu?key=${byName ? 'username' : 'id'}`
			);
			const stats = user.statistics ?? {};
			const grades = stats.grade_counts ?? {};
			return {
				id: user.id,
				username: user.username,
				avatarUrl: user.avatar_url ?? null,
				coverUrl: user.cover?.custom_url ?? user.cover?.url ?? user.cover_url ?? null,
				country: user.country ?? null,
				online: !!user.is_online,
				globalRank: user.statistics?.global_rank ?? null,
				pp: user.statistics?.pp ?? null,
				playCount: user.statistics?.play_count ?? null,
				joined: user.join_date ?? null,
				accuracy: user.statistics?.hit_accuracy ?? null,
				rankHistory: user.rank_history?.data ?? user.rankHistory?.data ?? [],
				title: user.title ?? null,
				colour: user.profile_colour ?? null,
				supporter: user.is_supporter ? (user.support_level ?? 1) : 0,
				countryRank: stats.country_rank ?? null,
				highestRank: user.rank_highest
					? { rank: user.rank_highest.rank, at: user.rank_highest.updated_at }
					: null,
				rankedScore: stats.ranked_score ?? null,
				totalScore: stats.total_score ?? null,
				totalHits: stats.total_hits ?? null,
				maxCombo: stats.maximum_combo ?? null,
				playTime: stats.play_time ?? null,
				replaysWatched: stats.replays_watched_by_others ?? null,
				level: stats.level ?? null,
				grades: {
					ssh: grades.ssh ?? 0,
					ss: grades.ss ?? 0,
					sh: grades.sh ?? 0,
					s: grades.s ?? 0,
					a: grades.a ?? 0
				},
				followers: user.follower_count ?? 0,
				mappingFollowers: user.mapping_follower_count ?? 0,
				medals: user.user_achievements?.length ?? 0,
				kudosu: user.kudosu?.total ?? 0,
				badges: (user.badges ?? []).map((badge: any) => ({
					image: badge['image@2x_url'] ?? badge.image_url,
					description: badge.description ?? '',
					awarded: badge.awarded_at
				})),
				groups: (user.groups ?? [])
					.filter((group: any) => !group.is_probationary)
					.map((group: any) => ({
						name: group.name,
						short: group.short_name,
						colour: group.colour ?? null
					})),
				previousNames: user.previous_usernames ?? [],
				lastVisit: user.last_visit ?? null,
				location: user.location || null,
				interests: user.interests || null,
				occupation: user.occupation || null,
				website: user.website || null,
				twitter: user.twitter || null,
				discord: user.discord || null,
				counts: {
					ranked: user.ranked_beatmapset_count ?? user.ranked_and_approved_beatmapset_count ?? 0,
					loved: user.loved_beatmapset_count ?? 0,
					guest: user.guest_beatmapset_count ?? 0,
					pending: user.pending_beatmapset_count ?? 0,
					graveyard: user.graveyard_beatmapset_count ?? 0,
					nominated: user.nominated_beatmapset_count ?? 0,
					favourite: user.favourite_beatmapset_count ?? 0,
					most_played: user.beatmap_playcounts_count ?? 0,
					firsts: user.scores_first_count ?? 0,
					best: user.scores_best_count ?? 0
				}
			} as OsuProfile;
		})();
		loading.catch(() => profiles.delete(osuId));
		profiles.set(osuId, loading);
	}
	return profiles.get(osuId)!;
}

/**
 * A page of a user's beatmap sets in one of their lists, in the shape of a search result
 * (most played gives the sets of the beatmaps, with how often they were played)
 */
export async function userBeatmapsets(
	osuId: number,
	list: BeatmapList,
	offset = 0,
	limit = 24
): Promise<(MapSet & { playcount?: number })[]> {
	const result = await osuApi(`users/${osuId}/beatmapsets/${list}?limit=${limit}&offset=${offset}`);
	if (list !== 'most_played') return result;
	return result.map((entry: any) => ({
		...entry.beatmapset,
		beatmaps: entry.beatmap ? [{ ...entry.beatmap }] : [],
		playcount: entry.count
	}));
}

export interface UserScore {
	id: number;
	pp: number | null;
	accuracy: number;
	rank: string;
	mods: string[];
	at: string;
	/** How much the score counts towards the user's pp (best plays) */
	weight: number | null;
	beatmap: { id: number; version: string; stars: number };
	set: { id: number; title: string; artist: string; creator: string };
}

/** A page of a user's best, first place or recent plays */
export async function userScores(
	osuId: number,
	kind: 'best' | 'firsts' | 'recent',
	offset = 0,
	limit = 10
): Promise<UserScore[]> {
	const result = await osuApi(
		`users/${osuId}/scores/${kind}?mode=osu&limit=${limit}&offset=${offset}`,
		{ latest: true }
	);
	return result.map((score: any) => ({
		id: score.id,
		pp: score.pp ?? null,
		accuracy: score.accuracy ?? 0,
		rank: score.rank ?? 'F',
		mods: (score.mods ?? [])
			.map((mod: any) => (typeof mod === 'string' ? mod : mod.acronym))
			.filter((mod: string) => mod && mod !== 'CL'),
		at: score.ended_at ?? score.created_at,
		weight: score.weight?.percentage ?? null,
		beatmap: {
			id: score.beatmap?.id,
			version: score.beatmap?.version ?? '',
			stars: score.beatmap?.difficulty_rating ?? 0
		},
		set: {
			id: score.beatmapset?.id ?? score.beatmap?.beatmapset_id,
			title: score.beatmapset?.title ?? '',
			artist: score.beatmapset?.artist ?? '',
			creator: score.beatmapset?.creator ?? ''
		}
	}));
}

/** A whole beatmap set from osu!, with its difficulties (to download it) */
export function beatmapset(setId: number | string): Promise<MapSet> {
	return osuApi(`beatmapsets/${setId}`);
}

export async function userPlaylists(osuId: number): Promise<Playlist[]> {
	return api.getUserPlaylists(await freshToken(), osuId);
}

/** A country's flag as an emoji */
export function flag(code: string | undefined | null) {
	if (!code || code.length !== 2) return '';
	return String.fromCodePoint(
		...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
	);
}

export interface LibraryStats {
	songs: number;
	/** Total length of the songs (s) */
	seconds: number;
	genres: [string, number][];
	languages: [string, number][];
	artists: [string, number][];
	mappers: [string, number][];
}

/** The most common values and how often each is there */
function top(values: (string | null | undefined)[], count: number): [string, number][] {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (!value || !value.trim()) continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
}

/** What the downloaded songs are: how many, how long, the top genres, artists and mappers */
export function libraryStats(data: Record<string, StoredMapSet>): LibraryStats {
	const sets = Object.values(data);
	const songs = sets.flatMap((set) =>
		trackGroups(set).map((maps) => ({
			set,
			artist: maps[0]?.artist || set.artist,
			length: Math.max(0, ...maps.map((map) => Number(map.total_length) || 0))
		}))
	);
	return {
		songs: songs.length,
		seconds: songs.reduce((sum, song) => sum + song.length, 0),
		genres: top(
			songs.map((song) => song.set.genre),
			8
		),
		languages: top(
			songs.map((song) => song.set.language),
			6
		),
		artists: top(
			songs.map((song) => song.artist),
			6
		),
		mappers: top(
			songs.map((song) => song.set.creator),
			6
		)
	};
}
