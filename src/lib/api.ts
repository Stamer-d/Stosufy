import { fetch } from '@tauri-apps/plugin-http';
import type { Playlist, PlaylistSongInfo, User } from './types';

// Trailing slash: nginx redirects /v2 to /v2/, which turns the POST into a GET
const API_URL = 'https://api.stamer-d.de/v2/';

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

	const response = await fetch(API_URL, { method: 'POST', headers, body });
	const result = await response.json().catch(() => null);
	if (!result || result.errors?.length) {
		throw new Error(result?.errors?.[0]?.message ?? `HTTP error! status: ${response.status}`);
	}
	return result.data;
}

const PLAYLIST_FIELDS =
	'id title description imageUrl createdBy public songAmount createdAt updatedAt';
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
		updated_at: playlist.updatedAt
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
