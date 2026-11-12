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
			tools.update((state) => ({
				...state,
				status: 'ready',
				what: null,
				error: `YouTube support couldn't be downloaded: ${(error as Error)?.message ?? error}`
			}));
			return false;
		}
	})();
	return deno;
}

/** Ready for this link: yt-dlp, FFmpeg, and Deno for YouTube */
async function readyFor(url: string) {
	if (!(await ensureTools())) throw new Error(get(tools).error ?? "The downloader isn't ready");
	if (isYouTube(url)) await ensureDeno();
}

// --- What a link is ------------------------------------------------------------------------

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
	/** The heights its videos come in (none: sound only, or unknown) */
	heights: number[];
	/** It has a picture (else only sound) */
	video: boolean;
	live: boolean;
	/** A playlist's videos */
	count: number;
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
	formats?: { height?: number | null; vcodec?: string | null }[];
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

export function readInfo(raw: RawInfo, url: string): LinkInfo {
	const playlist = raw._type === 'playlist';
	const first = raw.entries?.[0];
	const thumbnail =
		raw.thumbnail ??
		raw.thumbnails?.at(-1)?.url ??
		first?.thumbnail ??
		first?.thumbnails?.at(-1)?.url ??
		null;
	const formats = raw.formats ?? [];
	const heights = [
		...new Set(
			formats
				.filter((format) => format.vcodec !== 'none' && format.height)
				.map((format) => format.height as number)
		)
	].sort((a, b) => b - a);
	// (a picture unless every format says it has none: SoundCloud's, a podcast's)
	const video =
		raw.vcodec !== 'none' &&
		!(formats.length > 0 && formats.every((format) => format.vcodec === 'none'));
	const key = raw.extractor_key ?? '';
	return {
		kind: playlist ? 'playlist' : 'video',
		url: raw.webpage_url ?? raw.original_url ?? url,
		title: raw.title ?? 'Untitled',
		thumbnail,
		uploader: raw.uploader ?? raw.channel ?? null,
		site: SITES[key] ?? (key.replace(/(Vod|Clips?|Video|Tab|Stream)$/, '') || 'The web'),
		duration: raw.duration ?? 0,
		heights,
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
	format: string;
	height: number | null;
	sections: [number, number][];
	exactCuts: boolean;
	sponsorblock: boolean;
	playlist: boolean;
	cookies: string | null;
}

export interface Progress {
	phase: string;
	percent: number | null;
	speed: string | null;
	eta: string | null;
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
}

export async function download(
	id: string,
	request: DownloadRequest,
	progress: (progress: Progress) => void
): Promise<Downloaded> {
	await readyFor(request.url);
	await listenToProgress();
	handlers.set(id, progress);
	try {
		const result = await invoke<Downloaded | null>('ytdlp_download', { id, request });
		return result ?? { files: [], cancelled: false };
	} finally {
		handlers.delete(id);
	}
}

export function stopDownload(id: string) {
	return invoke('ytdlp_cancel', { id }).catch(() => {});
}
