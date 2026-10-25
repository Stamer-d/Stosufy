import { fetch } from '@tauri-apps/plugin-http';
import { get } from 'svelte/store';
import { keyStore, freshToken } from './stores/auth';
import type { Playlist, PlaylistSongInfo, User } from './types';

// Trailing slash: nginx redirects /v2 to /v2/, which turns the POST into a GET
export const API_URL = 'https://api.stamer-d.de/v2/';

/**
 * Sends a GraphQL request to the Stamer API, authenticated with the osu! access token.
 * Files are sent as a GraphQL multipart request, mapped to the given variable names.
 */
export async function graphql<T>(
	token: string,
	query: string,
	variables: Record<string, unknown> = {},
	files: Record<string, File> = {}
): Promise<T> {
	const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
	let body: string | FormData;

	if (Object.keys(files).length) {
		body = new FormData();
		const map: Record<string, string[]> = {};
		Object.keys(files).forEach((name, index) => {
			map[index] = [`variables.${name}`];
		});
		body.append('operations', JSON.stringify({ query, variables }));
		body.append('map', JSON.stringify(map));
		Object.values(files).forEach((file, index) => {
			(body as FormData).append(String(index), file, file.name);
		});
	} else {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify({ query, variables });
	}

	// The user's own token: renewed if it ran out, and once more if the API turns it down
	const own = token && token === get(keyStore).access_token;
	if (own) headers.Authorization = `Bearer ${await freshToken()}`;
	let response = await fetch(API_URL, { method: 'POST', headers, body });
	if (own && response.status === 401 && typeof body === 'string') {
		headers.Authorization = `Bearer ${await freshToken(true)}`;
		response = await fetch(API_URL, { method: 'POST', headers, body });
	}
	const result = await response.json().catch(() => null);
	if (!result || result.errors?.length) {
		throw new Error(result?.errors?.[0]?.message ?? `HTTP error! status: ${response.status}`);
	}
	return result.data;
}

const PLAYLIST_FIELDS =
	'id title description imageUrl createdBy public songAmount createdAt updatedAt saves saved creator { osuId username avatarUrl }';
const SONG_FIELDS = 'id setId mapId createdAt';

function toPlaylist(playlist: any): Playlist {
	return {
		id: playlist.id,
		title: playlist.title,
		description: playlist.description,
		image_url: playlist.imageUrl,
		created_by: playlist.createdBy,
		public: playlist.public,
		song_amount: playlist.songAmount,
		created_at: playlist.createdAt,
		updated_at: playlist.updatedAt,
		creator: playlist.creator ?? null,
		saves: playlist.saves ?? 0,
		saved: playlist.saved ?? false
	};
}

function toSong(song: any): PlaylistSongInfo {
	return {
		id: song.id,
		set_id: song.setId,
		map_id: song.mapId,
		position: song.position,
		created_at: song.createdAt,
		updated_at: song.updatedAt
	};
}

/** Returns the osu! profile of the user together with the Stosufy user id */
export async function getStosufyUser(token: string): Promise<User> {
	const data = await graphql<any>(token, '{ getStosufyUser { stosufyId osuProfile } }');
	return { ...data.getStosufyUser.osuProfile, stosufy_id: data.getStosufyUser.stosufyId };
}

export async function getPlaylists(token: string): Promise<Playlist[]> {
	const data = await graphql<any>(token, `{ getStosufyPlaylists { ${PLAYLIST_FIELDS} } }`);
	return data.getStosufyPlaylists.map(toPlaylist);
}

export async function getPlaylistSongs(
	token: string,
	playlistId: number
): Promise<PlaylistSongInfo[]> {
	const data = await graphql<any>(
		token,
		`
			query ($playlistId: Int!) {
				getStosufyPlaylistSongs(playlistId: $playlistId) {
					id
					setId
					mapId
					position
					createdAt
					updatedAt
				}
			}
		`,
		{ playlistId }
	);
	return data.getStosufyPlaylistSongs.map(toSong);
}

export async function createPlaylist(token: string, title: string): Promise<Playlist> {
	const data = await graphql<any>(
		token,
		`mutation ($title: String!) { createStosufyPlaylist(title: $title) { ${PLAYLIST_FIELDS} } }`,
		{ title }
	);
	return toPlaylist(data.createStosufyPlaylist);
}

export async function deletePlaylist(token: string, id: number) {
	await graphql(token, 'mutation ($id: Int!) { deleteStosufyPlaylist(id: $id) }', { id });
}

export async function editPlaylist(
	token: string,
	playlist: { id: number; title: string; description: string; public: boolean },
	image: File | null
): Promise<Playlist> {
	const data = await graphql<any>(
		token,
		`mutation ($id: Int!, $title: String!, $description: String, $public: Boolean, $image: File) {
			editStosufyPlaylist(id: $id, title: $title, description: $description, public: $public, image: $image) {
				${PLAYLIST_FIELDS}
			}
		}`,
		{ ...playlist, image: null },
		image ? { image } : {}
	);
	return toPlaylist(data.editStosufyPlaylist);
}

export async function addSongToPlaylist(
	token: string,
	playlistId: number,
	setId: number,
	mapId: number
): Promise<PlaylistSongInfo> {
	const data = await graphql<any>(
		token,
		`mutation ($playlistId: Int!, $setId: Int!, $mapId: Int!) {
			addSongToStosufyPlaylist(playlistId: $playlistId, setId: $setId, mapId: $mapId) { ${SONG_FIELDS} }
		}`,
		{ playlistId, setId, mapId }
	);
	return toSong(data.addSongToStosufyPlaylist);
}

/** Moves a song of a playlist to a position (1 is the first song) */
export async function moveSongInPlaylist(
	token: string,
	playlistId: number,
	songId: number,
	position: number
) {
	await graphql(
		token,
		'mutation ($playlistId: Int!, $songId: Int!, $position: Int!) { moveSongInStosufyPlaylist(playlistId: $playlistId, songId: $songId, position: $position) }',
		{ playlistId, songId, position }
	);
}

export async function removeSongFromPlaylist(token: string, playlistId: number, songId: number) {
	await graphql(
		token,
		'mutation ($playlistId: Int!, $songId: Int!) { removeSongFromStosufyPlaylist(playlistId: $playlistId, songId: $songId) }',
		{ playlistId, songId }
	);
}

/** Registers a downloaded song */
export async function addSong(token: string, setId: number, mapId: number) {
	await graphql(
		token,
		`
			mutation ($setId: Int!, $mapId: Int!) {
				addStosufySong(setId: $setId, mapId: $mapId) {
					id
				}
			}
		`,
		{ setId, mapId }
	);
}

/** Starts a listening session; returns its code */
export async function createListenRoom(token: string): Promise<string> {
	const data = await graphql<any>(token, 'mutation { createListenRoom { code } }');
	return data.createListenRoom.code;
}

export interface ListenPlaybackInput {
	setId: number;
	mapId: number;
	title: string;
	artist: string;
	position: number;
	playing: boolean;
	mod: string;
}

/** Sends the host's playback to a listening session */
export async function updateListenPlayback(
	token: string,
	code: string,
	playback: ListenPlaybackInput
) {
	await graphql(
		token,
		'mutation ($code: String!, $playback: ListenPlaybackInput!) { updateListenPlayback(code: $code, playback: $playback) }',
		{ code, playback }
	);
}

export interface FriendActivity {
	osuId: number;
	username: string;
	avatarUrl: string | null;
	/** Stosufy is open */
	online: boolean;
	/** Server time (ms) of the last check-in */
	lastSeen: number;
	/** The song now; the last one while offline */
	playback: (ListenPlaybackInput & { updatedAt: number }) | null;
	/** The listening session the friend is in, to join it */
	roomCode: string | null;
}

/** Checks in for the friend activity: online (with the song now, if any) or going offline */
export async function setPresence(
	token: string,
	online: boolean,
	playback: ListenPlaybackInput | null = null,
	roomCode: string | null = null
) {
	await graphql(
		token,
		'mutation ($online: Boolean!, $playback: ListenPlaybackInput, $roomCode: String) { setPresence(online: $online, playback: $playback, roomCode: $roomCode) }',
		{ online, playback, roomCode }
	);
}

/** Stops showing the user to their friends */
export async function hidePresence(token: string) {
	await graphql(token, 'mutation { hidePresence }');
}

/** The user's osu! friends who use Stosufy */
export async function getFriendActivity(
	token: string
): Promise<{ friends: FriendActivity[]; serverTime: number }> {
	const data = await graphql<any>(
		token,
		`
			{
				getFriendActivity {
					serverTime
					friends {
						osuId
						username
						avatarUrl
						online
						lastSeen
						roomCode
						playback {
							setId
							mapId
							title
							artist
							position
							playing
							mod
							updatedAt
						}
					}
				}
			}
		`
	);
	return data.getFriendActivity;
}

/** The user's settings saved on the server, or null */
export async function getSettings(
	token: string
): Promise<{ settings: Record<string, unknown>; updatedAt: number } | null> {
	const data = await graphql<any>(token, '{ getStosufySettings { settings updatedAt } }');
	return data.getStosufySettings;
}

/** Saves the user's settings; returns the server time of the save */
export async function saveSettings(token: string, settings: Record<string, unknown>) {
	const data = await graphql<any>(
		token,
		'mutation ($settings: JSON!) { saveStosufySettings(settings: $settings) }',
		{ settings }
	);
	return data.saveStosufySettings as number;
}

// --- Public playlists and favourites -----------------------------------------------------

/** Public playlists of everyone: most saved ("popular") or newest first, with a search */
export async function getPublicPlaylists(
	token: string,
	options: { search?: string; sort?: 'popular' | 'new'; limit?: number; offset?: number } = {}
): Promise<Playlist[]> {
	const data = await graphql<any>(
		token,
		`query ($search: String, $sort: String, $limit: Int, $offset: Int) {
			getPublicStosufyPlaylists(search: $search, sort: $sort, limit: $limit, offset: $offset) {
				${PLAYLIST_FIELDS}
			}
		}`,
		{
			search: options.search || null,
			sort: options.sort ?? 'popular',
			limit: options.limit ?? 30,
			offset: options.offset ?? 0
		}
	);
	return data.getPublicStosufyPlaylists.map(toPlaylist);
}

/** A playlist of the user or a public one of someone else */
export async function getPlaylist(token: string, id: number): Promise<Playlist> {
	const data = await graphql<any>(
		token,
		`query ($id: Int!) { getStosufyPlaylist(id: $id) { ${PLAYLIST_FIELDS} } }`,
		{ id }
	);
	return toPlaylist(data.getStosufyPlaylist);
}

/** The public playlists of a user (by osu! id) */
export async function getUserPlaylists(token: string, osuId: number): Promise<Playlist[]> {
	const data = await graphql<any>(
		token,
		`query ($osuId: Int!) { getStosufyUserPlaylists(osuId: $osuId) { ${PLAYLIST_FIELDS} } }`,
		{ osuId }
	);
	return data.getStosufyUserPlaylists.map(toPlaylist);
}

/** Public playlists of others the user saved to their library */
export async function getSavedPlaylists(token: string): Promise<Playlist[]> {
	const data = await graphql<any>(token, `{ getSavedStosufyPlaylists { ${PLAYLIST_FIELDS} } }`);
	return data.getSavedStosufyPlaylists.map(toPlaylist);
}

export async function savePlaylist(token: string, id: number, saved: boolean) {
	await graphql(
		token,
		'mutation ($id: Int!, $saved: Boolean!) { saveStosufyPlaylist(id: $id, saved: $saved) }',
		{ id, saved }
	);
}

/** The user's favourite songs, newest first */
export async function getFavourites(token: string): Promise<PlaylistSongInfo[]> {
	const data = await graphql<any>(token, `{ getStosufyFavourites { ${SONG_FIELDS} } }`);
	return data.getStosufyFavourites.map(toSong);
}

export async function setFavourite(
	token: string,
	setId: number,
	mapId: number,
	favourite: boolean
) {
	await graphql(
		token,
		`
			mutation ($setId: Int!, $mapId: Int!, $favourite: Boolean!) {
				setStosufyFavourite(setId: $setId, mapId: $mapId, favourite: $favourite)
			}
		`,
		{ setId, mapId, favourite }
	);
}

// --- Listening history ---------------------------------------------------------------------

/** A play as the server keeps it: the song's key, when (Unix time, s), heard and length (s) */
export type ServerPlay = [songKey: string, at: number, heard: number, length: number];

/** Uploads plays (the server keeps each once) with the songs they're of; returns how many were new */
export async function addPlays(
	token: string,
	plays: ServerPlay[],
	songs: Record<string, unknown>
): Promise<number> {
	const data = await graphql<any>(
		token,
		'mutation ($plays: [StosufyPlayInput!]!, $songs: JSON) { addStosufyPlays(plays: $plays, songs: $songs) }',
		{
			plays: plays.map(([songKey, at, heard, length]) => ({ songKey, at, heard, length })),
			songs
		}
	);
	return data.addStosufyPlays;
}

/** The plays the server got after the cursor (a page; `more` if there are others after it) */
export async function getPlays(
	token: string,
	after: number
): Promise<{ plays: ServerPlay[]; songs: Record<string, any>; cursor: number; more: boolean }> {
	const data = await graphql<any>(
		token,
		`
			query ($after: Float) {
				getStosufyPlays(after: $after) {
					plays {
						songKey
						at
						heard
						length
					}
					songs
					cursor
					more
				}
			}
		`,
		{ after }
	);
	const page = data.getStosufyPlays;
	return {
		plays: page.plays.map((p: any) => [p.songKey, p.at, p.heard, p.length]),
		songs: page.songs ?? {},
		cursor: page.cursor,
		more: page.more
	};
}

/** Deletes the user's listening history on the server */
export async function clearPlays(token: string) {
	await graphql(token, 'mutation { clearStosufyHistory }');
}

// --- Puzzle leaderboards ---------------------------------------------------------------------

/** A time on a puzzle leaderboard */
export interface PuzzleScore {
	rank: number;
	osuId: number;
	username: string | null;
	avatarUrl: string | null;
	/** ms */
	time: number;
	moves: number;
	mods: string[];
	at: number;
}

export interface PuzzleBoard {
	entries: PuzzleScore[];
	mine: PuzzleScore | null;
	players: number;
}

/** A place on an overall leaderboard: `value` is what it's ranked by */
export interface PuzzleTopEntry {
	rank: number;
	osuId: number;
	username: string | null;
	avatarUrl: string | null;
	value: number;
	count: number;
}

export type PuzzleTopBoard = 'daily' | 'records' | 'solved' | 'streak';

const SCORE_FIELDS = 'rank osuId username avatarUrl time moves mods at';
const BOARD_FIELDS = `entries { ${SCORE_FIELDS} } mine { ${SCORE_FIELDS} } players`;
const TOP_FIELDS = 'rank osuId username avatarUrl value count';

/** Today's puzzle, the same for everyone (null if there's no song to make it of) */
export async function getDailyPuzzle(token: string) {
	const data = await graphql<any>(
		token,
		`{ getStosufyPuzzleDaily { day setId mapId title artist mode difficulty seed nextAt players streak longest mine { ${SCORE_FIELDS} } } }`
	);
	return data.getStosufyPuzzleDaily as {
		day: string;
		setId: number;
		mapId: number | null;
		title: string | null;
		artist: string | null;
		mode: 'jigsaw' | 'slide' | 'spin';
		difficulty: number;
		seed: number;
		nextAt: number;
		players: number;
		streak: number;
		longest: number;
		mine: PuzzleScore | null;
	} | null;
}

/** The fastest times of a song's puzzle in a mode and difficulty */
export async function getPuzzleBoard(
	token: string,
	setId: number,
	mode: string,
	difficulty: number,
	limit = 50
): Promise<PuzzleBoard> {
	const data = await graphql<any>(
		token,
		`query ($setId: Int!, $mode: String!, $difficulty: Int!, $limit: Int) {
			getStosufyPuzzleBoard(setId: $setId, mode: $mode, difficulty: $difficulty, limit: $limit) { ${BOARD_FIELDS} }
		}`,
		{ setId, mode, difficulty, limit }
	);
	return data.getStosufyPuzzleBoard;
}

/** The fastest first solves of a day's daily puzzle (today's without a day) */
export async function getDailyPuzzleBoard(
	token: string,
	day?: string,
	limit = 50
): Promise<PuzzleBoard> {
	const data = await graphql<any>(
		token,
		`query ($day: String, $limit: Int) {
			getStosufyPuzzleDailyBoard(day: $day, limit: $limit) { ${BOARD_FIELDS} }
		}`,
		{ day, limit }
	);
	return data.getStosufyPuzzleDailyBoard;
}

/** An overall leaderboard: daily points, puzzle records, puzzles solved or streaks */
export async function getPuzzleTop(
	token: string,
	board: PuzzleTopBoard,
	limit = 50
): Promise<{ entries: PuzzleTopEntry[]; mine: PuzzleTopEntry | null; players: number }> {
	const data = await graphql<any>(
		token,
		`query ($board: String!, $limit: Int) {
			getStosufyPuzzleTop(board: $board, limit: $limit) { entries { ${TOP_FIELDS} } mine { ${TOP_FIELDS} } players }
		}`,
		{ board, limit }
	);
	return data.getStosufyPuzzleTop;
}

/** Puts a solved puzzle's time on its leaderboard */
export async function submitPuzzle(
	token: string,
	result: {
		setId: number;
		mapId: number | null;
		mode: string;
		difficulty: number;
		mods: string[];
		time: number;
		moves: number;
		pieces: number;
		daily: string | null;
	}
): Promise<{
	best: boolean;
	previous: number | null;
	ranked: boolean;
	board: PuzzleBoard;
	streak: number | null;
}> {
	const data = await graphql<any>(
		token,
		`mutation ($result: StosufyPuzzleResultInput!) {
			submitStosufyPuzzle(result: $result) { best previous ranked streak board { ${BOARD_FIELDS} } }
		}`,
		{ result }
	);
	return data.submitStosufyPuzzle;
}
