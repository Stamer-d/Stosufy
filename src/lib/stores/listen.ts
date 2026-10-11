// Listening together: everyone in a session hears what the host plays, at the same moment.
// The session's state streams from the Stamer API (a GraphQL subscription over server-sent
// events); the host sends its playback with updateListenPlayback.

import { get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import * as api from '../api';
import { keyStore } from './auth';
import { user } from './user';
import { mapDataStore, downloadBeatmap } from './data';
import { currentMod, MODS } from './mods';
import {
	currentSong,
	songQueue,
	setSongQueue,
	setPlaybackMod,
	togglePlayback,
	stopPlayback,
	setPlaybackLock,
	withoutPlaybackLock
} from './audio';
import { librarySong } from './radio';
import { showToast } from './toast';
import type { MapSet, PlaybackMod } from '../types';

export interface ListenMember {
	osuId: number;
	username: string;
	avatarUrl: string | null;
	isHost: boolean;
}

export interface ListenPlayback {
	setId: number;
	mapId: number;
	title: string;
	artist: string;
	position: number;
	playing: boolean;
	mod: PlaybackMod;
	updatedAt: number;
}

export interface ListenState {
	status: 'idle' | 'connecting' | 'live' | 'error';
	code: string | null;
	members: ListenMember[];
	playback: ListenPlayback | null;
	isHost: boolean;
	/** Members follow the host until they pause or seek themselves */
	following: boolean;
	/** What a member is doing to catch up, e.g. downloading the song */
	activity: string | null;
	message?: string;
}

const IDLE: ListenState = {
	status: 'idle',
	code: null,
	members: [],
	playback: null,
	isHost: false,
	following: true,
	activity: null
};

export const listen = writable<ListenState>(IDLE);

/** Members seek when they are further off than this (seconds) */
const MAX_DRIFT = 0.35;
/** The host also sends its position this often while playing */
const HOST_HEARTBEAT = 5000;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000];

const SUBSCRIPTION = `subscription ($code: String!) {
	listenRoom(code: $code) {
		code
		members { osuId username avatarUrl isHost }
		playback { setId mapId title artist position playing mod updatedAt }
		serverTime
	}
}`;

let controller: AbortController | null = null;
/** Server clock minus local clock (ms), from the timestamps of the received states */
let clockOffsets: number[] = [];
let previousMod: PlaybackMod | null = null;

const serverNow = () => Date.now() + (clockOffsets.length ? Math.max(...clockOffsets) : 0);

/** Starts a session and joins it as the host */
export async function startSession() {
	try {
		listen.set({ ...IDLE, status: 'connecting' });
		const code = await api.createListenRoom(get(keyStore).access_token);
		await joinSession(code);
	} catch (error) {
		listen.set({ ...IDLE, status: 'error', message: errorText(error) });
	}
}

/** Joins a session by its code (or a stosufynew://listen/CODE link) */
export async function joinSession(input: string) {
	const code = input.trim().split('/').pop().toUpperCase();
	if (!code) return;
	leaveSession(false);
	previousMod = currentMod();
	listen.set({ ...IDLE, status: 'connecting', code });
	controller = new AbortController();
	stream(code, controller.signal, 0);
}

/** Leaves the session; members get their own mod back */
export function leaveSession(notify = true) {
	controller?.abort();
	controller = null;
	clockOffsets = [];
	const wasMember = get(listen).code && !get(listen).isHost;
	if (wasMember && previousMod) setPlaybackMod(previousMod);
	previousMod = null;
	if (notify && get(listen).code)
		showToast('Left the listening session', 'icon-[mingcute--group-line]');
	listen.set(IDLE);
}

/** Members: follow the host again after pausing or seeking themselves */
export function syncAgain() {
	listen.update((state) => ({ ...state, following: true }));
	follow();
}

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

/** Reads the session's server-sent events; reconnects when the stream drops */
async function stream(code: string, signal: AbortSignal, attempt: number) {
	try {
		const response = await fetch(api.API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				Authorization: `Bearer ${get(keyStore).access_token}`
			},
			body: JSON.stringify({ query: SUBSCRIPTION, variables: { code } }),
			signal
		});
		if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let end: number;
			while ((end = buffer.indexOf('\n\n')) !== -1) {
				const event = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				const data = event
					.split('\n')
					.filter((line) => line.startsWith('data:'))
					.map((line) => line.slice(5).trim())
					.join('\n');
				if (!data) continue;
				const message = JSON.parse(data);
				if (message.errors?.length) throw new Error(message.errors[0].message);
				if (message.data?.listenRoom) {
					attempt = 0;
					receive(message.data.listenRoom);
				}
			}
		}
		throw new Error('The connection was closed');
	} catch (error) {
		if (signal.aborted) return;
		const text = errorText(error);
		// The session is gone: no point in reconnecting
		if (/not found/i.test(text) || attempt >= RECONNECT_DELAYS.length) {
			listen.set({ ...IDLE, status: 'error', message: text });
			return;
		}
		listen.update((state) => ({ ...state, status: 'connecting' }));
		await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAYS[attempt]));
		if (!signal.aborted) stream(code, signal, attempt + 1);
	}
}

function receive(room: {
	code: string;
	members: ListenMember[];
	playback: ListenPlayback | null;
	serverTime: number;
}) {
	// Network delay makes this smaller than the real offset, so the largest recent one is best
	clockOffsets = [...clockOffsets.slice(-9), room.serverTime - Date.now()];
	const me = get(user)?.id;
	const isHost = room.members.some((member) => member.isHost && member.osuId === me);
	const before = get(listen);
	listen.set({
		...before,
		status: 'live',
		code: room.code,
		members: room.members,
		playback: room.playback,
		isHost
	});
	// Just became the host (the host left): send what's playing here
	if (isHost && !before.isHost && before.status === 'live') sendPlayback();
	if (!isHost) follow();
}

// --- Host: send the playback ----------------------------------------------------------

let lastSent = '';

/** Sends what the host plays; songs that aren't downloaded (previews) aren't shared */
async function sendPlayback(force = false) {
	const state = get(listen);
	const song = get(currentSong).song;
	const audio = get(songQueue).audio;
	if (state.status !== 'live' || !state.isHost || !song || !audio) return;
	// Previews (songs not downloaded) are only a cut of the song: they aren't shared
	const shareable = !!get(mapDataStore)[song.id];
	const note = shareable
		? null
		: 'Previews aren’t shared: download the song to play it for everyone.';
	if (state.activity !== note) listen.update((s) => ({ ...s, activity: note }));
	if (!shareable) return;
	const playback: api.ListenPlaybackInput = {
		setId: Number(song.id),
		mapId: Number(song.beatmaps?.[0]?.id ?? 0),
		title: song.title ?? '',
		artist: song.artist ?? '',
		position: audio.currentTime,
		playing: !audio.paused,
		mod: currentMod()
	};
	const key = JSON.stringify({ ...playback, position: Math.round(playback.position) });
	if (!force && key === lastSent) return;
	lastSent = key;
	try {
		await api.updateListenPlayback(get(keyStore).access_token, state.code, playback);
	} catch (error) {
		console.warn('Could not send the playback:', error);
	}
}

// --- Members: follow the host ---------------------------------------------------------

let loadingSong: string | null = null;
let syncing = false;

/** Where the host is now, in seconds */
function hostPosition(playback: ListenPlayback) {
	if (!playback.playing) return playback.position;
	return playback.position + ((serverNow() - playback.updatedAt) / 1000) * MODS[playback.mod].rate;
}

/** Songs that couldn't be downloaded: not tried again for a while (osu! would rate limit) */
const RETRY_AFTER = 60_000;
const failedDownloads = new Map<string, { until: number; reason: string }>();

/** The library song for the host's song, downloading it first if needed */
export async function songFor(playback: ListenPlayback): Promise<MapSet | null> {
	const wanted = { id: playback.setId, beatmaps: [{ id: playback.mapId }] } as MapSet;
	const local = librarySong(wanted);
	if (local) return local;
	const key = `${playback.setId}`;
	if (loadingSong === key) return null;
	const failed = failedDownloads.get(key);
	if (failed && failed.until > Date.now()) {
		const seconds = Math.ceil((failed.until - Date.now()) / 1000);
		listen.update((state) => ({
			...state,
			activity: `Couldn't download ${playback.title}: ${failed.reason} Trying again in ${seconds} s.`
		}));
		return null;
	}
	loadingSong = key;
	listen.update((state) => ({ ...state, activity: `Downloading ${playback.title}…` }));
	try {
		const { access_token: token, sessionKey } = get(keyStore);
		const response = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${playback.setId}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!response.ok) throw new Error(`osu! API error (HTTP ${response.status})`);
		await downloadBeatmap(await response.json(), playback.mapId, sessionKey, token);
		return librarySong(wanted);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		failedDownloads.set(key, { until: Date.now() + RETRY_AFTER, reason });
		listen.update((state) => ({
			...state,
			activity: `Couldn't download ${playback.title}: ${reason}`
		}));
		console.error('Could not download the song of the session:', error);
		return null;
	} finally {
		loadingSong = null;
	}
}

/** Brings the member's playback to the host's: song, mod, position and pause state */
async function follow() {
	const state = get(listen);
	const playback = state.playback;
	if (state.isHost || !state.following || !playback || syncing) return;
	syncing = true;
	try {
		if (currentMod() !== playback.mod) setPlaybackMod(playback.mod);
		const current = get(currentSong).song;
		const sameMap =
			current?.id == playback.setId && current?.beatmaps?.some((map) => map.id == playback.mapId);
		if (!sameMap) {
			const song = await songFor(playback);
			// The host may have moved on while the song downloaded (the state itself is
			// sent again every few seconds, so compare the song, not the object)
			const now = get(listen).playback;
			if (!song || now?.setId !== playback.setId || now?.mapId !== playback.mapId) return;
			listen.update((s) => ({ ...s, activity: null }));
			await withoutPlaybackLock(() =>
				setSongQueue(0, [song], 'playlist', null, false, hostPosition(now))
			);
		}
		const audio = get(songQueue).audio;
		if (!audio) return;
		const target = hostPosition(playback);
		if (Math.abs(audio.currentTime - target) > MAX_DRIFT) audio.currentTime = target;
		if (playback.playing && audio.paused) togglePlayback();
		if (!playback.playing && !audio.paused) stopPlayback();
	} finally {
		// Let the events of these changes pass before telling them apart from the member's own
		setTimeout(() => (syncing = false), 300);
	}
}

// Watch the audio: the host sends its changes, a member's own pause or seek stops following
let watched: HTMLAudioElement | null = null;
const onChange = (event: Event) => {
	const state = get(listen);
	if (state.status !== 'live') return;
	if (state.isHost) sendPlayback(true);
	else if (
		!syncing &&
		(event.type === 'pause' || event.type === 'seeked') &&
		state.following &&
		// A song that ends pauses too: that isn't the member pausing
		!(event.target as HTMLAudioElement).ended
	) {
		listen.update((s) => ({ ...s, following: false }));
	}
};

if (typeof window !== 'undefined') {
	// Members can't pick songs themselves: the host does (pausing and seeking still work)
	setPlaybackLock(() => {
		const state = get(listen);
		return state.status === 'live' && !state.isHost
			? "You're listening along, so the host picks the songs. Leave the session to choose your own."
			: null;
	});
	songQueue.subscribe(({ audio }) => {
		if (audio === watched) return;
		for (const type of ['play', 'pause', 'seeked', 'ratechange']) {
			watched?.removeEventListener(type, onChange);
			audio?.addEventListener(type, onChange);
		}
		watched = audio ?? null;
		if (get(listen).isHost) sendPlayback(true);
	});
	setInterval(() => {
		const state = get(listen);
		if (state.status !== 'live') return;
		if (state.isHost) sendPlayback();
		else follow();
	}, HOST_HEARTBEAT / 2);
}
