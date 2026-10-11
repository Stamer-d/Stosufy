export type PlaylistId = number | string;

export type QueueType = 'playlist' | 'preview' | 'radio';

export interface Beatmap {
	id: number | string;
	version?: string;
	difficulty_rating?: number;
	mode?: string;
	total_length?: number;
	audioFile?: string | null;
	downloaded?: boolean;
	/** Background of this difficulty, when the set has more than one */
	background?: string | null;
	/** Title and artist from the .osu file; differ between the songs of a set */
	title?: string;
	artist?: string;
	timing?: import('./osuFile').TimingPoint[];
	kiai?: import('./osuFile').KiaiSection[];
	/** The .osu file of this difficulty, for its own storyboard */
	osuFile?: string;
	/** Integrated loudness of this difficulty's audio in LUFS */
	loudness?: number;
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
	/** Which song of a set with several songs (see tracks.ts) */
	track?: number;
	/** Path of the full size background saved in the songs folder */
	background?: string | null;
	/** The full size background could not be loaded for this set, so it is not retried */
	backgroundUnavailable?: boolean;
	/** Path of the small square cover saved in the songs folder */
	thumbnail?: string | null;
	/** The small cover could not be loaded for this set, so it is not retried */
	thumbnailUnavailable?: boolean;
	/** Path of the beatmap video saved in the songs folder */
	video?: string | null;
	/** When the video starts, in ms relative to the audio */
	videoOffset?: number;
	/** Whether the set has a video on osu!; unknown for songs downloaded before videos were saved */
	hasVideo?: boolean;
	/** Saved storyboard: folder its images are relative to and the .osb file */
	storyboard?: { dir: string; osb: string | null } | null;
	/** Whether the set has a storyboard on osu! (for songs saved before storyboards) */
	hasStoryboard?: boolean;
	/** Video in a format the webview can't play, converted when the song is played */
	videoSource?: string | null;
	/** Uninherited timing points of the first difficulty (for Nightcore beats) */
	timing?: import('./osuFile').TimingPoint[];
	/** 'osu' for songs imported from an osu! installation; their files belong to osu! */
	source?: 'osu';
	/** Integrated loudness in LUFS, measured the first time the song plays */
	loudness?: number;
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
	/** "desktop": wallpaper with widgets, "classic": banner and lists */
	layout: 'desktop' | 'classic';
	/** Sections of the home page in display order */
	sections: { id: HomeSectionId; visible: boolean }[];
	/** Which beatmap background the hero banner shows */
	heroBackground: 'current' | 'random' | 'pinned';
	pinnedSetId?: number | string | null;
	/** Widgets on the desktop home page */
	widgets?: PlacedWidget[];
}

export interface PlacedWidget {
	uid: string;
	/** Key in the widget registry */
	type: string;
	/** Position of the top left corner as a fraction of the desktop (0 to 1) */
	x: number;
	y: number;
}

export interface AppearanceSettings {
	accent: AccentColor;
	/** Show the background of the current song behind the app */
	background: boolean;
	/** Background dim in percent, like osu!'s "Background dim" */
	dim: number;
	/** Play the videos of beatmaps that have one instead of the background */
	video?: boolean;
	/** The background pulses to the beat and lights up in kiai time, like in osu! */
	beatEffects?: boolean;
	/** Play the storyboards of beatmaps that have one */
	storyboard?: boolean;
}

export type AccentColor = 'violet' | 'pink' | 'blue' | 'teal' | 'orange';

export interface Settings {
	volume?: number;
	shuffle?: boolean;
	repeat?: RepeatMode;
	searchFilters?: SearchFilters;
	home?: HomeSettings;
	appearance?: AppearanceSettings;
	/** Bring every song to the same loudness */
	normalize?: boolean;
	/** Seconds the end of a song and the start of the next overlap; 0 turns crossfade off */
	crossfade?: number;
	/** Speed mod applied to the playback, like in osu! */
	mod?: PlaybackMod;
	/** What osu! friends see: online status and song, only the status, or nothing */
	activityVisibility?: 'all' | 'online' | 'hidden';
	/** Before activityVisibility: false hid the user */
	shareActivity?: boolean;
	/** Download the songs of the playlists made from the osu! profile */
	profileDownload?: boolean;
	/** Playlists made from the osu! profile, by list */
	profilePlaylists?: Partial<Record<'favourite' | 'most_played' | 'best', number | string>>;
	/** Keep playing similar songs when a queue ends (default on) */
	autoplay?: boolean;
	/** Chosen sort order per playlist id */
	playlistSort?: Record<string, import('./songSort').SongSort>;
}

/** No mod, Half Time, Daycore, Double Time or Nightcore */
export type PlaybackMod = 'NM' | 'HT' | 'DC' | 'DT' | 'NC';

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
