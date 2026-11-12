// yt-dlp for the downloader (see src-tauri/src/ytdlp.rs): downloaded when it's first needed and
// brought up to date once a day (the sites it downloads from change all the time), Deno with
// the first YouTube link, and FFmpeg (the file add-ons' own) for putting video and sound
// together and cutting. What a link is, and its download with its progress.

import { get, writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { nativeFfmpeg, nativeState } from '../files/native';

export type ToolStatus = 'unknown' | 'unavailable' | 'downloading' | 'ready' | 'failed';

export interface ToolsState {
	status: ToolStatus;
	/** What's being downloaded, and how far (0–1) */
	what: 'yt-dlp' | 'deno' | 'ffmpeg' | null;
	progress: number;
	error?: string;
	/** YouTube support (Deno) there */
	deno: boolean;
}

export const tools = writable<ToolsState>({
	status: 'unknown',
	what: null,
	progress: 0,
	deno: false
});

interface Status {
	supported: boolean;
	installed: boolean;
	denoSupported: boolean;
	denoInstalled: boolean;
}

const UPDATE_KEY = 'stosufy-ytdlp-checked';
const DAY = 24 * 60 * 60 * 1000;

let listening: Promise<unknown> | null = null;
function listenToInstall() {
	listening ??= listen<{ what: 'yt-dlp' | 'deno'; received: number; total: number }>(
		'ytdlp-install',
		({ payload }) =>
			tools.update((state) => ({
				...state,
				what: payload.what,
				progress: payload.total ? payload.received / payload.total : 0
			}))
	).catch(() => (listening = null));
	return listening;
}

async function status(): Promise<Status | null> {
	try {
		return (await invoke<Status | null>('ytdlp_status')) ?? null;
	} catch {
		return null;
	}
}

let ready: Promise<boolean> | null = null;

/** yt-dlp (and FFmpeg) there, downloaded if they aren't; whether they are */
export function ensureTools(): Promise<boolean> {
	ready ??= (async () => {
		const found = await status();
		if (!found?.supported) {
			tools.update((state) => ({ ...state, status: 'unavailable' }));
			return false;
		}
		tools.update((state) => ({ ...state, deno: found.denoInstalled }));
		await listenToInstall();
		try {
			if (!found.installed) {
				tools.update((state) => ({ ...state, status: 'downloading', what: 'yt-dlp', progress: 0 }));
				await invoke('ytdlp_install');
				remember();
			}
			// (FFmpeg: the file add-ons' own, downloaded with its progress shown here too)
			const stop = nativeState.subscribe(($native) => {
				if ($native.status === 'downloading')
					tools.update((state) => ({
						...state,
						status: 'downloading',
						what: 'ffmpeg',
						progress: $native.progress
					}));
			});
			const ffmpeg = await nativeFfmpeg().finally(stop);
			if (!ffmpeg) throw new Error("FFmpeg couldn't be downloaded");
			tools.update((state) => ({ ...state, status: 'ready', what: null, error: undefined }));
			void updateDaily();
			return true;
		} catch (error) {
			ready = null;
			tools.update((state) => ({
				...state,
				status: 'failed',
				what: null,
				error: String((error as Error)?.message ?? error)
			}));
			return false;
		}
	})();
	return ready;
}

function remember() {
	try {
		localStorage.setItem(UPDATE_KEY, String(Date.now()));
	} catch {
		// (it's checked again next time)
	}
}

/** Once a day: yt-dlp brought up to date (in the background); whether it was */
async function updateDaily() {
	let last = 0;
	try {
		last = Number(localStorage.getItem(UPDATE_KEY)) || 0;
	} catch {
		// (checked now)
	}
	if (Date.now() - last < DAY) return false;
	try {
		const result = await invoke<string>('ytdlp_install');
		remember();
		return result === 'updated';
	} catch (error) {
		console.warn('Could not update yt-dlp:', error);
		return false;
	}
}

const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export function isYouTube(url: string) {
	try {
		return YOUTUBE.test(new URL(url).hostname);
	} catch {
		return false;
	}
}

let deno: Promise<boolean> | null = null;

/** YouTube support (Deno) there, downloaded if it isn't */
export function ensureDeno(): Promise<boolean> {
	if (get(tools).deno) return Promise.resolve(true);
	deno ??= (async () => {
		await listenToInstall();
		tools.update((state) => ({ ...state, status: 'downloading', what: 'deno', progress: 0 }));
		try {
			await invoke('deno_install');
			tools.update((state) => ({ ...state, status: 'ready', what: null, deno: true }));
			return true;
		} catch (error) {
			deno = null;
			denoError = `YouTube support couldn't be downloaded: ${(error as Error)?.message ?? error}`;
			tools.update((state) => ({ ...state, status: 'ready', what: null }));
			return false;
		}
	})();
	return deno;
}

let denoError = '';

/** Ready for this link: yt-dlp, FFmpeg, and Deno for YouTube (without it YouTube doesn't work) */
async function readyFor(url: string) {
	if (!(await ensureTools())) throw new Error(get(tools).error ?? "The downloader isn't ready");
	if (isYouTube(url) && !(await ensureDeno())) throw new Error(denoError);
}

// --- What a link is ------------------------------------------------------------------------

export type Codec = 'h264' | 'av1' | 'vp9' | 'hevc' | 'any';

/** A height a video comes in (in a codec): its frame rate, and how big it'd be (bytes, about) */
export interface Quality {
	height: number;
	fps: number;
	bytes: number | null;
}

/** A way to download the video: a codec in a container, and the qualities it comes in */
export interface VideoChoice {
	id: Codec;
	/** mp4, webm or mkv */
	container: 'mp4' | 'webm' | 'mkv';
	label: string;
	hint: string;
	qualities: Quality[];
}

export interface LinkInfo {
	kind: 'video' | 'playlist';
	url: string;
	title: string;
	thumbnail: string | null;
	uploader: string | null;
	/** Where it's from (YouTube, Twitch, …) */
	site: string;
	/** Seconds, 0 if unknown */
	duration: number;
	/** How it can be downloaded as a video, the most usable first (none: only sound) */
	videos: VideoChoice[];
	/** How big its best sound is (bytes, about) */
	audioBytes: number | null;
	/** It has a picture (else only sound) */
	video: boolean;
	live: boolean;
	/** A playlist's videos */
	count: number;
}

interface RawFormat {
	height?: number | null;
	width?: number | null;
	fps?: number | null;
	vcodec?: string | null;
	acodec?: string | null;
	tbr?: number | null;
	vbr?: number | null;
	abr?: number | null;
	filesize?: number | null;
	filesize_approx?: number | null;
}

interface RawInfo {
	_type?: string;
	title?: string;
	webpage_url?: string;
	original_url?: string;
	thumbnail?: string;
	thumbnails?: { url: string; width?: number }[];
	uploader?: string;
	channel?: string;
	extractor_key?: string;
	duration?: number;
	is_live?: boolean;
	live_status?: string;
	formats?: RawFormat[];
	vcodec?: string | null;
	height?: number | null;
	entries?: RawInfo[];
	playlist_count?: number;
}

const SITES: Record<string, string> = {
	Youtube: 'YouTube',
	YoutubeTab: 'YouTube',
	TwitchVod: 'Twitch',
	TwitchClips: 'Twitch',
	TwitchStream: 'Twitch',
	TwitchVideos: 'Twitch',
	Generic: 'The web'
};

const CODECS: {
	id: Exclude<Codec, 'any'>;
	test: RegExp;
	container: 'mp4' | 'webm';
	label: string;
	hint: string;
}[] = [
	{
		id: 'h264',
		test: /^(avc|h264)/,
		container: 'mp4',
		label: 'MP4 · H.264',
		hint: 'plays everywhere, also in editing apps'
	},
	{
		id: 'av1',
		test: /^av01/,
		container: 'mp4',
		label: 'MP4 · AV1',
		hint: 'small files, newer devices'
	},
	{
		id: 'vp9',
		test: /^vp0?9/,
		container: 'webm',
		label: 'WebM · VP9',
		hint: 'high quality, browsers'
	},
	{
		id: 'hevc',
		test: /^(hev|hvc|h265)/,
		container: 'mp4',
		label: 'MP4 · H.265',
		hint: 'small files, Apple devices'
	}
];

/** How big a format is (bytes, about): as it says, else from its bitrate and the length */
function bytesOf(format: RawFormat, duration: number) {
	if (format.filesize) return format.filesize;
	if (format.filesize_approx) return format.filesize_approx;
	const kbps = format.tbr ?? format.vbr ?? format.abr;
	return kbps && duration ? (kbps * 1000 * duration) / 8 : null;
}

/** A codec's qualities: each height once (its best frame rate, its biggest file), highest first */
function qualitiesOf(formats: RawFormat[], duration: number): Quality[] {
	const byHeight = new Map<number, Quality>();
	for (const format of formats) {
		// (an upright video's "height" is its shorter side's partner: its height as it is)
		const height = format.height ?? 0;
		if (!height) continue;
		const fps = Math.round(format.fps ?? 0);
		const bytes = bytesOf(format, duration);
		const known = byHeight.get(height);
		if (!known || fps > known.fps || (fps === known.fps && (bytes ?? 0) > (known.bytes ?? 0)))
			byHeight.set(height, { height, fps, bytes });
	}
	return [...byHeight.values()].sort((a, b) => b.height - a.height || b.fps - a.fps);
}

export function readInfo(raw: RawInfo, url: string): LinkInfo {
	const playlist = raw._type === 'playlist';
	const first = raw.entries?.[0];
	const thumbnail =
		raw.thumbnail ??
		raw.thumbnails?.at(-1)?.url ??
		first?.thumbnail ??
		first?.thumbnails?.at(-1)?.url ??
		null;
	const duration = raw.duration ?? 0;
	const formats = raw.formats ?? [];
	const pictures = formats.filter((format) => format.vcodec !== 'none');
	// (a picture unless every format says it has none: SoundCloud's, a podcast's)
	const video =
		raw.vcodec !== 'none' &&
		!(formats.length > 0 && formats.every((format) => format.vcodec === 'none'));
	const videos: VideoChoice[] = [];
	if (video) {
		for (const codec of CODECS) {
			const of = pictures.filter((format) => codec.test.test(format.vcodec ?? ''));
			if (of.length) videos.push({ ...codec, qualities: qualitiesOf(of, duration) });
		}
		// A playlist's videos aren't looked at one by one: every codec offered (each falls back
		// to what a video has, see codec_filter in ytdlp.rs), its qualities not known
		if (playlist) for (const codec of CODECS) videos.push({ ...codec, qualities: [] });
		// The best of all of them (whatever the codec), as MKV; or, not knowing its codecs (a
		// site that doesn't say), MP4
		const known = videos.length > 0;
		videos.push({
			id: 'any',
			container: known ? 'mkv' : 'mp4',
			label: known ? 'MKV · Best quality' : 'MP4',
			hint: known ? 'the best there is, whatever its codec' : 'the best there is',
			qualities: qualitiesOf(pictures, duration)
		});
	}
	const sounds = formats
		.filter((format) => format.acodec && format.acodec !== 'none' && format.vcodec === 'none')
		.map((format) => bytesOf(format, duration) ?? 0);
	const key = raw.extractor_key ?? '';
	return {
		kind: playlist ? 'playlist' : 'video',
		url: raw.webpage_url ?? raw.original_url ?? url,
		title: raw.title ?? 'Untitled',
		thumbnail,
		uploader: raw.uploader ?? raw.channel ?? null,
		site: SITES[key] ?? (key.replace(/(Vod|Clips?|Video|Tab|Stream)$/, '') || 'The web'),
		duration,
		videos,
		audioBytes: sounds.length ? Math.max(...sounds) : null,
		video,
		live: !!raw.is_live || raw.live_status === 'is_live',
		count: raw.playlist_count ?? raw.entries?.length ?? 0
	};
}

const randomId = () => Math.random().toString(36).slice(2, 10);
let lookingUp: string | null = null;

/** What a link is (one at a time: a new one stops the one before) */
export async function lookUp(url: string, cookies: string | null): Promise<LinkInfo> {
	await readyFor(url);
	if (lookingUp) void invoke('ytdlp_cancel', { id: lookingUp }).catch(() => {});
	const id = (lookingUp = `info-${randomId()}`);
	try {
		const json = await invoke<string>('ytdlp_info', { id, url, cookies });
		return readInfo(JSON.parse(json), url);
	} finally {
		if (lookingUp === id) lookingUp = null;
	}
}

// --- Downloading ---------------------------------------------------------------------------

export interface DownloadRequest {
	url: string;
	kind: 'video' | 'audio';
	/** A video's container (mp4, webm, mkv), or the sound's format (mp3, …, "original") */
	format: string;
	codec: Codec | null;
	height: number | null;
	audioKbps: number | null;
	sections: [number, number][];
	exactCuts: boolean;
	sponsorblock: boolean;
	playlist: boolean;
	/** Which of a playlist's videos ("1-10"; null: all) */
	playlistItems: string | null;
	cookies: string | null;
}

export interface Progress {
	phase: string;
	percent: number | null;
	speed: string | null;
	eta: string | null;
	/** Which of a playlist's videos, of how many */
	index: number | null;
	count: number | null;
	/** The picture or the sound (of a video downloaded as two) */
	stream: 'video' | 'audio' | null;
}

const handlers = new Map<string, (progress: Progress) => void>();
let listeningToProgress: Promise<unknown> | null = null;
function listenToProgress() {
	listeningToProgress ??= listen<Progress & { id: string }>('ytdlp-progress', ({ payload }) =>
		handlers.get(payload.id)?.(payload)
	).catch(() => (listeningToProgress = null));
	return listeningToProgress;
}

export interface Downloaded {
	files: { path: string; size: number }[];
	cancelled: boolean;
	/** What went wrong with some (a playlist's private videos, …) */
	error: string | null;
}

export async function download(
	id: string,
	request: DownloadRequest,
	progress: (progress: Progress) => void,
	/** Stopped while it got ready (nothing to stop yet then) */
	stopped: () => boolean = () => false
): Promise<Downloaded> {
	await readyFor(request.url);
	if (stopped()) return { files: [], cancelled: true, error: null };
	await listenToProgress();
	handlers.set(id, progress);
	try {
		const result = await invoke<Downloaded | null>('ytdlp_download', { id, request });
		return result ?? { files: [], cancelled: false, error: null };
	} finally {
		handlers.delete(id);
	}
}

export function stopDownload(id: string) {
	return invoke('ytdlp_cancel', { id }).catch(() => {});
}
