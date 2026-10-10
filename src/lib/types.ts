export type PlaylistId = number | string;

export type QueueType = 'playlist' | 'preview';

export interface Beatmap {
	id: number | string;
	version?: string;
	difficulty_rating?: number;
	mode?: string;
	total_length?: number;
	audioFile?: string | null;
	downloaded?: boolean;
	[key: string]: any;
}

/** Entry of a song in a user playlist, as returned by the Stosufy API */
export interface PlaylistSongInfo {
	id: number | null;
	set_id: number | string;
	map_id: number | string;
	position?: number;
	created_at: string;
	updated_at?: string;
}

interface MapSetInfo {
	id: number | string;
	title?: string;
	artist?: string;
	creator?: string;
	covers?: Record<string, string>;
	bpm?: number;
	status?: string;
	tags?: string;
	preview_url?: string;
	created_at?: number | string;
	songInfo?: PlaylistSongInfo;
	/** Set on songs added to the queue by the user; they always play the full song */
	queued?: boolean;
	[key: string]: any;
}

/** A beatmap set as used in queues and playlists (osu! API shape or formatted local data) */
export interface MapSet extends MapSetInfo {
	beatmaps: Beatmap[];
}

/** A downloaded beatmap set as stored in songData.json */
export interface StoredMapSet extends MapSetInfo {
	beatmaps: Record<string, Beatmap>;
}

export interface Playlist {
	id: PlaylistId;
	title: string;
	description?: string;
	image_url?: string | null;
	song_amount: number;
	public?: boolean;
	created_by?: number;
	created_at?: string | null;
	updated_at?: string | null;
}

export interface SongQueue {
	currentIndex?: number | null;
	audio?: HTMLAudioElement | null;
	queue?: MapSet[];
	type?: QueueType;
	playlistId?: PlaylistId | null;
}

export interface CurrentSong {
	song: MapSet | null;
	isPlaying: boolean;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface SearchFilters {
	/** osu! beatmap status filter (the `s` search parameter) */
	status: string;
	/** osu! sort order (the `sort` search parameter), empty for relevance */
	sort: string;
}

export type HomeSectionId = 'hero' | 'playlists' | 'recent' | 'discover';

export interface HomeSettings {
	/** Sections of the home page in display order */
	sections: { id: HomeSectionId; visible: boolean }[];
	/** Which beatmap background the hero banner shows */
	heroBackground: 'current' | 'random' | 'pinned';
	pinnedSetId?: number | string | null;
}

export interface AppearanceSettings {
	accent: AccentColor;
	/** Show the background of the current song behind the app */
	background: boolean;
	/** Background dim in percent, like osu!'s "Background dim" */
	dim: number;
}

export type AccentColor = 'violet' | 'pink' | 'blue' | 'teal' | 'orange';

export interface Settings {
	volume?: number;
	shuffle?: boolean;
	repeat?: RepeatMode;
	searchFilters?: SearchFilters;
	home?: HomeSettings;
	appearance?: AppearanceSettings;
}

/** Queue state persisted between app starts */
export interface StoredQueue {
	index?: number;
	queue?: MapSet[];
	type?: QueueType;
	playlistId?: PlaylistId | null;
	currentSeconds?: number;
}

export interface UserSettings {
	settings: Settings;
	currentQueue: StoredQueue | null;
}

export interface User {
	id?: number;
	stosufy_id?: number;
	username?: string;
	avatar_url?: string;
	[key: string]: any;
}

export interface Keys {
	access_token: string;
	refresh_token: string;
	expiry_time: number;
	sessionKey: string;
}

export interface DownloadState {
	isDownloading: boolean;
	progress: number;
}
