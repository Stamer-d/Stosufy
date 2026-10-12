// What the gameplay view shows: autoplay, a replay of one of the top 50 scores, or the
// user playing it themselves; and which difficulty of the song (also for the hitsounds).

import { derived, get, writable } from 'svelte/store';
import { readFile, writeFile, mkdir, exists, readTextFile } from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';
import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from '../stores/auth';
import { userSettings, updateUserSettings } from '../stores/user';
import { mapDataStore } from '../stores/data';
import { currentSong, setPlaybackMod, skipForward, withoutPlaybackLock } from '../stores/audio';
import { currentMod } from '../stores/mods';
import { MOD } from './beatmap';
import type { PlaybackMod } from '../types';
import { parseReplay, type Replay } from './replay';
import type { Judge } from './judge';
import type { MapSet, StoredMapSet } from '../types';

// --- Difficulties -----------------------------------------------------------------------

export interface Difficulty {
	id: string;
	version: string;
	stars: number | null;
	mode: string;
}

/** The difficulty the gameplay and hitsounds use: the chosen one, else the song's own */
/** The hardest osu!standard difficulty of a song: what the gameplay shows unless one is chosen */
function hardestMapId(song: MapSet): string | null {
	const maps = (song.beatmaps ?? []).filter(
		(map: any) => map.mode == null || map.mode === 'osu' || map.mode_int === 0
	);
	let hardest = maps[0] ?? song.beatmaps?.[0];
	for (const map of maps)
		if ((Number(map.difficulty_rating) || 0) > (Number(hardest?.difficulty_rating) || 0))
			hardest = map;
	return hardest?.id != null ? String(hardest.id) : null;
}

export function chosenMapId(song: MapSet | null | undefined): string | null {
	if (!song) return null;
	const chosen = get(userSettings).settings?.gameplayDifficulty?.[String(song.id)];
	return chosen ?? hardestMapId(song);
}

export function chooseDifficulty(song: MapSet, mapId: string | null) {
	const all = { ...get(userSettings).settings?.gameplayDifficulty };
	if (mapId === null || mapId === hardestMapId(song)) delete all[String(song.id)];
	else all[String(song.id)] = mapId;
	updateUserSettings({ gameplayDifficulty: all });
}

/** The key of the song and difficulty the gameplay shows */
export function playKey(song: MapSet | null | undefined) {
	return song ? `${song.id}:${chosenMapId(song)}` : null;
}

const header = (content: string, key: string) =>
	content.match(new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`, 'm'))?.[1];

/** The osu!standard difficulties of a song (with the same audio, so they line up) */
export async function difficulties(song: MapSet): Promise<Difficulty[]> {
	const stored = get(mapDataStore)[song.id] as StoredMapSet | undefined;
	const found = new Map<string, Difficulty & { audio?: string | null }>();
	for (const map of song.beatmaps ?? []) {
		found.set(String(map.id), {
			id: String(map.id),
			version: map.version ?? '',
			stars: map.difficulty_rating ?? null,
			mode: map.mode ?? 'osu',
			audio: map.audioFile ?? null
		});
	}
	for (const [id, map] of Object.entries(stored?.beatmaps ?? {})) {
		const known = found.get(id);
		let version = map.version ?? known?.version ?? '';
		let mode = map.mode ?? known?.mode ?? 'osu';
		// Downloaded sets know their difficulties from the .osu files
		if (!version && (map.chartFile || map.osuFile)) {
			const content = await readTextFile(map.chartFile ?? map.osuFile).catch(() => '');
			version = header(content, 'Version') ?? '';
			const number = Number(header(content, 'Mode') ?? 0);
			mode = ['osu', 'taiko', 'fruits', 'mania'][number] ?? 'osu';
		}
		found.set(id, {
			id,
			version: version || `Difficulty ${id}`,
			stars: map.difficulty_rating ?? known?.stars ?? null,
			mode,
			audio: map.audioFile ?? known?.audio ?? null
		});
	}
	const current = found.get(String(song.beatmaps?.[0]?.id));
	return [...found.values()]
		.filter((d) => d.mode === 'osu' && /^\d+$/.test(d.id))
		.filter((d) => !current?.audio || !d.audio || d.audio === current.audio)
		.sort((a, b) => (a.stars ?? 0) - (b.stars ?? 0) || a.version.localeCompare(b.version))
		.map(({ id, version, stars, mode }) => ({ id, version, stars, mode }));
}

// --- What's shown --------------------------------------------------------------------------

export interface LeaderboardScore {
	id: number;
	/** The score's place on the leaderboard (1–50) */
	position: number;
	player: string;
	avatar: string | null;
	country: string | null;
	mods: string[];
	accuracy: number;
	maxCombo: number;
	score: number;
	pp: number | null;
	rank: string;
	misses: number;
	hasReplay: boolean;
	date: string | null;
}

export type GameplayMode =
	| { kind: 'auto' }
	| { kind: 'replay'; score: LeaderboardScore; replay: Replay }
	| { kind: 'live'; mods: number };

/** What the gameplay view shows, for which song and difficulty */
export const gameplayMode = writable<{ key: string | null; mode: GameplayMode }>({
	key: null,
	mode: { kind: 'auto' }
});

export function setGameplayMode(song: MapSet | null, mode: GameplayMode) {
	gameplayMode.set({ key: playKey(song), mode });
}

/** The judged play the view shows (for the hitsounds to follow it) */
export const activePlay = writable<{
	key: string;
	judge: Judge;
	kind: GameplayMode['kind'];
} | null>(null);

// --- The leaderboard and replays ----------------------------------------------------------

const API = 'https://osu.ppy.sh/api/v2';

function authorization() {
	return { Authorization: `Bearer ${get(keyStore).access_token}` };
}

function apiError(status: number, what: string) {
	if (status === 401 || status === 403)
		return `osu! didn't allow loading ${what} (HTTP ${status}). Log in again and retry.`;
	if (status === 429)
		return `osu! limits how many replays can be downloaded. Try again in a while.`;
	if (status === 404) return `osu! doesn't have ${what}.`;
	return `Couldn't load ${what} (HTTP ${status}).`;
}

const leaderboards = new Map<string, Promise<LeaderboardScore[]>>();

/** The top 50 scores of a difficulty */
export function leaderboard(mapId: string): Promise<LeaderboardScore[]> {
	if (!leaderboards.has(mapId)) {
		const request = (async () => {
			const response = await fetch(`${API}/beatmaps/${mapId}/scores?mode=osu&limit=50`, {
				headers: { ...authorization(), 'x-api-version': '20240529', Accept: 'application/json' }
			});
			if (!response.ok) throw new Error(apiError(response.status, 'the leaderboard'));
			const { scores } = (await response.json()) as { scores: any[] };
			return scores.map((s, i): LeaderboardScore => ({
				id: s.id,
				position: i + 1,
				player: s.user?.username ?? 'Unknown',
				avatar: s.user?.avatar_url ?? null,
				country: s.user?.country_code ?? null,
				mods: (s.mods ?? [])
					.map((m: any) => (typeof m === 'string' ? m : m.acronym))
					.filter((m: string) => m !== 'CL'),
				accuracy: s.accuracy ?? 0,
				maxCombo: s.max_combo ?? 0,
				score: s.legacy_total_score || s.total_score || s.score || 0,
				pp: s.pp ?? null,
				rank: s.rank ?? '',
				misses: s.statistics?.miss ?? s.statistics?.count_miss ?? 0,
				hasReplay: !!(s.has_replay ?? s.replay),
				date: s.ended_at ?? s.created_at ?? null
			}));
		})();
		request.catch(() => leaderboards.delete(mapId));
		leaderboards.set(mapId, request);
	}
	return leaderboards.get(mapId)!;
}

async function replaysDir() {
	return path.join(await path.homeDir(), 'Stosufy', 'Replays');
}

/** A score's replay: from the disk if downloaded before, else from osu! (kept for next time) */
export async function downloadReplay(score: LeaderboardScore): Promise<Replay> {
	const dir = await replaysDir();
	const file = await path.join(dir, `${score.id}.osr`);
	if (await exists(file).catch(() => false)) {
		try {
			return parseReplay(await readFile(file));
		} catch {
			// Broken: download it again
		}
	}
	const response = await fetch(`${API}/scores/${score.id}/download`, {
		headers: { ...authorization(), 'x-api-version': '20240529' }
	});
	if (!response.ok) throw new Error(apiError(response.status, 'this replay'));
	const data = new Uint8Array(await response.arrayBuffer());
	const replay = parseReplay(data);
	if (replay.mode !== 0) throw new Error('This replay is not for osu!standard.');
	await mkdir(dir, { recursive: true }).catch(() => {});
	await writeFile(file, data).catch(() => {});
	return replay;
}

/** osu!'s mod bits as letters */
export function modNames(mods: number) {
	const names: [number, string][] = [
		[1, 'NF'],
		[2, 'EZ'],
		[8, 'HD'],
		[16, 'HR'],
		[32, 'SD'],
		[512, 'NC'],
		[64, 'DT'],
		[128, 'RX'],
		[256, 'HT'],
		[1024, 'FL'],
		[4096, 'SO'],
		[8192, 'AP'],
		[16384, 'PF']
	];
	const result: string[] = [];
	for (const [bit, name] of names) {
		if (!(mods & bit)) continue;
		if (name === 'DT' && mods & 512) continue;
		if (name === 'SD' && mods & 16384) continue;
		result.push(name);
	}
	return result;
}

/** Set while going on to the next song to play it too (the playing view stays open) */
const carryingOn = writable<PlayModName[] | null>(null);

/** The user is playing the song themselves (the gameplay then fills the window) */
export const playingLive = derived(
	[gameplayMode, currentSong, carryingOn],
	([$mode, $song, $carrying]) =>
		!!$carrying || ($mode.mode.kind === 'live' && $mode.key === playKey($song.song))
);

// --- Playing it yourself with mods --------------------------------------------------------

/** The mods to play with, as osu! names them */
export const PLAY_MODS = ['EZ', 'HD', 'HR', 'HT', 'DT', 'NC', 'RX'] as const;
export type PlayModName = (typeof PLAY_MODS)[number];

const MOD_BITS: Record<PlayModName, number> = {
	EZ: MOD.Easy,
	HD: MOD.Hidden,
	HR: MOD.HardRock,
	HT: MOD.HalfTime,
	DT: MOD.DoubleTime,
	NC: MOD.Nightcore | MOD.DoubleTime,
	RX: MOD.Relax
};

/** Mods that can't go together: choosing one turns the others off */
const EXCLUSIVE: Record<PlayModName, PlayModName[]> = {
	EZ: ['HR'],
	HR: ['EZ'],
	HT: ['DT', 'NC'],
	DT: ['HT', 'NC'],
	NC: ['HT', 'DT'],
	HD: [],
	RX: []
};

export function togglePlayMod(selected: PlayModName[], mod: PlayModName): PlayModName[] {
	if (selected.includes(mod)) return selected.filter((m) => m !== mod);
	return [...selected.filter((m) => !EXCLUSIVE[mod].includes(m)), mod];
}

export function playModBits(selected: PlayModName[]) {
	return selected.reduce((bits, mod) => bits | MOD_BITS[mod], 0);
}

/** The speed mod of the music before playing, to go back to afterwards */
let speedBefore: PlaybackMod | null = null;

/** Starts playing the song yourself with mods: the speed ones change the music's speed */
export function startPlaying(song: MapSet, selected: PlayModName[]) {
	speedBefore ??= currentMod();
	const speed: PlaybackMod = selected.includes('NC')
		? 'NC'
		: selected.includes('DT')
			? 'DT'
			: selected.includes('HT')
				? 'HT'
				: 'NM';
	setPlaybackMod(speed);
	setGameplayMode(song, { kind: 'live', mods: playModBits(selected) });
}

/** On to the next song of the queue, playing it too with the same mods */
export async function playNextLive() {
	if (get(carryingOn)) return;
	const before = get(currentSong).song;
	const mods = (get(userSettings).settings?.gameplayMods ?? []) as PlayModName[];
	carryingOn.set(mods);
	try {
		await withoutPlaybackLock(() => skipForward());
		const song = get(currentSong).song;
		if (song && song !== before) startPlaying(song, mods);
	} finally {
		carryingOn.set(null);
	}
}

if (typeof window !== 'undefined') {
	// Done playing: the music gets its speed back
	// A replay with a speed mod (DT, NC, HT) plays the music at that speed too
	const replaySpeed = derived([gameplayMode, currentSong], ([$mode, $song]) => {
		if ($mode.mode.kind !== 'replay' || $mode.key !== playKey($song.song)) return null;
		const mods = $mode.mode.replay.mods;
		return mods & MOD.Nightcore
			? 'NC'
			: mods & MOD.DoubleTime
				? 'DT'
				: mods & MOD.HalfTime
					? 'HT'
					: 'NM';
	});
	// Done playing or watching: the music gets its speed back
	derived([playingLive, replaySpeed], (values) => values).subscribe(([live, replay]) => {
		if (replay) {
			speedBefore ??= currentMod();
			if (currentMod() !== replay) setPlaybackMod(replay as PlaybackMod);
			return;
		}
		if (live || speedBefore === null) return;
		setPlaybackMod(speedBefore);
		speedBefore = null;
	});
}
