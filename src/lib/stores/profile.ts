// Profiles: a user's osu! profile, their public playlists and (for the user themselves) what
// their library is made of.

import { fetch } from '@tauri-apps/plugin-http';
import { freshToken } from './auth';
import * as api from '../api';
import { trackGroups } from '../tracks';
import type { Playlist, StoredMapSet } from '../types';

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
}

const profiles = new Map<number, Promise<OsuProfile>>();

/** A user's osu! profile (kept for the session) */
export function osuProfile(osuId: number): Promise<OsuProfile> {
	if (!profiles.has(osuId)) {
		const loading = (async () => {
			const response = await fetch(`https://osu.ppy.sh/api/v2/users/${osuId}/osu?key=id`, {
				headers: { Authorization: `Bearer ${await freshToken()}` }
			});
			if (!response.ok) throw new Error(`osu! answered with HTTP ${response.status}`);
			const user = await response.json();
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
				joined: user.join_date ?? null
			};
		})();
		loading.catch(() => profiles.delete(osuId));
		profiles.set(osuId, loading);
	}
	return profiles.get(osuId)!;
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

const top = (values: (string | null | undefined)[], count: number) =>
	Object.entries(
		values
			.filter((v): v is string => !!v && v.trim().length > 0)
			.reduce<Record<string, number>>((all, v) => ({ ...all, [v]: (all[v] ?? 0) + 1 }), {})
	)
		.sort((a, b) => b[1] - a[1])
		.slice(0, count);

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
