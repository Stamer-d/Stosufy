// Stosufy Connect: your devices know of each other, as in Spotify. One of them plays (the
// active device); on the others the player shows what it plays, and its buttons control it
// (play, pause, next, seek, its volume, songs to play), or the playback moves over to them,
// going on where it was.
//
// This is the part both apps share: the device's connection to the Stamer API (a GraphQL
// subscription over server-sent events), what the devices send each other, and the controls
// for the device that plays. The player itself is the app's own: the desktop app's
// (connectDesktop.ts) and the web app's (src/web/connect.ts) hand it in with useConnectPlayer.

import { get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import * as api from '../api';
import { keyStore, freshToken } from './auth';
import { showToast } from './toast';
import type { MapSet } from '../types';

export type DeviceKind = 'computer' | 'phone' | 'tablet' | 'browser';
export type Repeat = 'off' | 'all' | 'one';

export interface ConnectDevice {
	id: string;
	name: string;
	kind: DeviceKind;
	isActive: boolean;
}

export interface ConnectPlayback {
	song: MapSet;
	/** Seconds into the song at updatedAt */
	position: number;
	duration: number;
	playing: boolean;
	rate: number;
	/** 0–1; null if it can't be set from another device */
	volume: number | null;
	shuffle: boolean;
	repeat: Repeat;
	/** Server time (ms) */
	updatedAt: number;
}

export interface ConnectQueue {
	songs: MapSet[];
	index: number;
}

export interface ConnectState {
	status: 'off' | 'connecting' | 'live' | 'error';
	/** This device */
	deviceId: string;
	devices: ConnectDevice[];
	activeDeviceId: string | null;
	playback: ConnectPlayback | null;
	queue: ConnectQueue | null;
	/** Another device plays: the player here controls it */
	remote: boolean;
	/** The device that plays, if it's another one */
	remoteDevice: ConnectDevice | null;
}

/** What the app's player does for Connect */
export interface ConnectPlayer {
	/** What plays here now (null: nothing loaded) */
	state(): Omit<ConnectPlayback, 'updatedAt'> | null;
	/** The queue around the song playing */
	queue(): ConnectQueue | null;
	/** Calls `changed` whenever the song, pause state, position (a seek), volume, shuffle,
	 * repeat or the queue change here */
	watch(changed: (event: 'play' | 'other') => void): void;
	// What another device asks
	play(): void;
	pause(): void;
	next(): void;
	previous(): void;
	seek(seconds: number): void;
	setVolume(volume: number): void;
	setShuffle(on: boolean): void;
	setRepeat(mode: Repeat): void;
	playSongs(songs: MapSet[], index: number): void;
	queueSong(song: MapSet, next: boolean): void;
	jumpTo(index: number, song: MapSet | null): void;
	/** The playback moves here: the song (and queue) from `at` seconds, playing or paused */
	takeOver(
		playback: ConnectPlayback | null,
		queue: ConnectQueue | null,
		at: number,
		play: boolean
	): void;
	/** Another device plays now: stop here */
	release(): void;
}

// --- This device ----------------------------------------------------------------------------

const DEVICE_KEY = 'stosufy-connect-device';

function newId() {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** This device's id: made once, then the same each time it opens */
function ownId() {
	try {
		const kept = localStorage.getItem(DEVICE_KEY);
		if (kept && /^[\w-]{1,64}$/.test(kept)) return kept;
		const id = newId();
		localStorage.setItem(DEVICE_KEY, id);
		return id;
	} catch {
		return newId();
	}
}

/** What the device is: e.g. "Windows PC" (the desktop app), "iPhone", "Chrome on Mac" */
export function describeDevice(desktop: boolean): { name: string; kind: DeviceKind } {
	const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
	const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
	const os = /Windows/i.test(agent)
		? 'Windows'
		: /Android/i.test(agent)
			? 'Android'
			: /iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && touch)
				? 'iOS'
				: /Mac/i.test(agent)
					? 'Mac'
					: /CrOS/i.test(agent)
						? 'ChromeOS'
						: 'Linux';
	if (desktop) return { name: os === 'Mac' ? 'Mac' : `${os} PC`, kind: 'computer' };
	if (/iPad/i.test(agent) || (/Macintosh/i.test(agent) && touch))
		return { name: 'iPad', kind: 'tablet' };
	if (/iPhone|iPod/i.test(agent)) return { name: 'iPhone', kind: 'phone' };
	if (/Android/i.test(agent))
		return /Mobile/i.test(agent)
			? { name: 'Android phone', kind: 'phone' }
			: { name: 'Android tablet', kind: 'tablet' };
	const browser = /Edg\//.test(agent)
		? 'Edge'
		: /Firefox\//.test(agent)
			? 'Firefox'
			: /Chrome\//.test(agent)
				? 'Chrome'
				: /Safari\//.test(agent)
					? 'Safari'
					: 'Browser';
	return { name: `${browser} on ${os}`, kind: 'browser' };
}

const OFF: ConnectState = {
	status: 'off',
	deviceId: '',
	devices: [],
	activeDeviceId: null,
	playback: null,
	queue: null,
	remote: false,
	remoteDevice: null
};

export const connect = writable<ConnectState>(OFF);

/** The song of the device that plays (as the apps keep songs: only what's needed to play it) */
export function connectSong(song: MapSet): MapSet {
	const map = song.beatmaps?.[0];
	return {
		id: song.id,
		title: song.title,
		artist: song.artist,
		creator: song.creator,
		track: song.track,
		genre: song.genre,
		language: song.language,
		songSource: song.songSource,
		bpm: song.bpm,
		...(song.preview_url && { preview_url: song.preview_url }),
		...((song as { queued?: boolean }).queued && { queued: true }),
		beatmaps: map ? [{ id: map.id, total_length: map.total_length, version: map.version }] : []
	} as MapSet;
}

/** The queue as it goes to the other devices: up to 20 songs before the one playing and 150 after */
export function connectQueue(songs: MapSet[], index: number): ConnectQueue | null {
	if (!songs.length || index < 0) return null;
	const from = Math.max(0, index - 20);
	return {
		songs: songs.slice(from, index + 151).map(connectSong),
		index: index - from
	};
}

// --- The connection ---------------------------------------------------------------------

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000];
/** The device that plays also sends where it is this often (the others' clocks drift) */
const HEARTBEAT = 15_000;

const SUBSCRIPTION = `subscription ($deviceId: String!, $name: String!, $kind: String!) {
	connect(deviceId: $deviceId, name: $name, kind: $kind) {
		devices { id name kind isActive }
		activeDeviceId
		playback { song position duration playing rate volume shuffle repeat updatedAt }
		queue { songs index }
		queueVersion
		command { id type data }
		serverTime
	}
}`;

let player: ConnectPlayer | null = null;
let device: { id: string; name: string; kind: DeviceKind } | null = null;
let controller: AbortController | null = null;
/** Server clock minus local clock (ms), from the timestamps of the received states */
let clockOffsets: number[] = [];
let queueVersion = -1;
let lastCommand = 0;
/** The first state after (re)connecting is looked at differently (see receive) */
let fresh = true;

/** The server's clock now (ms) */
export const serverNow = () => Date.now() + (clockOffsets.length ? Math.max(...clockOffsets) : 0);

/** Where the song of the device that plays is now (s) */
export function positionOf(playback: ConnectPlayback | null) {
	if (!playback) return 0;
	if (!playback.playing) return playback.position;
	const at = playback.position + ((serverNow() - playback.updatedAt) / 1000) * playback.rate;
	return playback.duration > 0 ? Math.min(at, playback.duration) : at;
}

/** Hands in the app's player and connects this device (once the user is logged in) */
export function useConnectPlayer(own: ConnectPlayer, desktop: boolean) {
	if (typeof window === 'undefined' || player) return;
	player = own;
	device = { id: ownId(), ...describeDevice(desktop) };
	player.watch((event) => report(event === 'play'));
	let token = '';
	keyStore.subscribe((keys) => {
		const now = keys?.access_token ?? '';
		if (!!now === !!token) {
			token = now;
			return;
		}
		token = now;
		if (now) start();
		else stop();
	});
	setInterval(() => {
		const state = get(connect);
		if (state.status === 'live' && state.activeDeviceId === device?.id) report(false, true);
	}, HEARTBEAT);
	// Back on the screen (a phone): the connection may have broken off meanwhile
	if (typeof document !== 'undefined')
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden && get(connect).status === 'error' && token) start();
		});
}

function start() {
	if (!device) return;
	controller?.abort();
	controller = new AbortController();
	connect.set({ ...OFF, status: 'connecting', deviceId: device.id });
	stream(controller.signal, 0);
}

function stop() {
	controller?.abort();
	controller = null;
	connect.set({ ...OFF, deviceId: device?.id ?? '' });
}

/** Reads the server-sent events; reconnects when the stream drops */
async function stream(signal: AbortSignal, attempt: number) {
	try {
		const response = await fetch(api.API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				Authorization: `Bearer ${await freshToken()}`
			},
			body: JSON.stringify({
				query: SUBSCRIPTION,
				variables: { deviceId: device!.id, name: device!.name, kind: device!.kind }
			}),
			signal
		});
		if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
		fresh = true;
		queueVersion = -1;
		lastSent = '';
		lastQueue = '';
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
				if (message.data?.connect) {
					attempt = 0;
					receive(message.data.connect);
				}
			}
		}
		throw new Error('The connection was closed');
	} catch (error) {
		if (signal.aborted) return;
		console.warn('Connect:', error);
		// (another device may still play: the player here shows that until it's back)
		connect.update((state) => ({ ...state, status: 'connecting' }));
		if (attempt >= RECONNECT_DELAYS.length) {
			connect.set({ ...OFF, status: 'error', deviceId: device?.id ?? '' });
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAYS[attempt]));
		if (!signal.aborted) stream(signal, attempt + 1);
	}
}

interface Received {
	devices: ConnectDevice[];
	activeDeviceId: string | null;
	playback: ConnectPlayback | null;
	queue: ConnectQueue | null;
	queueVersion: number;
	command: { id: number; type: string; data: any } | null;
	serverTime: number;
}

/** The commands this device sent last, so a state from before them doesn't undo what the
 * player already shows (until the playing device sent its state after them) */
let optimisticSince = 0;
/** A song asked for there: shown until the device plays it (it may take a moment to load) */
let askedSong: { key: string; until: number } | null = null;
const keyOfSong = (song: MapSet | null | undefined) =>
	song ? `${song.id}:${song.track ?? 0}` : '';

function receive(message: Received) {
	// Network delay makes this smaller than the real offset, so the largest recent one is best
	clockOffsets = [...clockOffsets.slice(-9), message.serverTime - Date.now()];
	const before = get(connect);
	const me = device!.id;
	const queue = message.queueVersion !== queueVersion ? (message.queue ?? null) : before.queue;
	queueVersion = message.queueVersion;
	let playback = message.playback;
	// (shown as asked until the device that plays answered)
	if (
		before.playback &&
		playback &&
		optimisticSince &&
		playback.updatedAt < optimisticSince &&
		serverNow() - optimisticSince < 3000
	)
		playback = before.playback;
	if (askedSong && playback) {
		if (keyOfSong(playback.song) === askedSong.key || Date.now() > askedSong.until)
			askedSong = null;
		else if (before.playback) playback = before.playback;
	}
	const activeId = message.activeDeviceId;
	const remoteDevice =
		activeId && activeId !== me ? (message.devices.find((d) => d.id === activeId) ?? null) : null;
	const next: ConnectState = {
		status: 'live',
		deviceId: me,
		devices: message.devices,
		activeDeviceId: activeId,
		playback,
		queue,
		remote: !!remoteDevice,
		remoteDevice
	};
	connect.set(next);

	const wasFresh = fresh;
	fresh = false;
	const local = player!.state();
	if (wasFresh) {
		// Connected (again): playing here while nothing else plays makes this the one that
		// plays; while another one plays, it took over meanwhile: this one stops
		if (local?.playing && !activeId) report(true);
		else if (local?.playing && remoteDevice) player!.release();
		else if (activeId === me) report(false, true);
	}

	const command = message.command;
	if (command && command.id !== lastCommand) {
		lastCommand = command.id;
		run(command.type, command.data ?? {});
	}
}

/** What another device asked of this one */
function run(type: string, data: any) {
	const p = player!;
	try {
		switch (type) {
			case 'play':
				return p.play();
			case 'pause':
				return p.pause();
			case 'toggle':
				return p.state()?.playing ? p.pause() : p.play();
			case 'next':
				return p.next();
			case 'previous':
				return p.previous();
			case 'seek':
				return p.seek(Number(data.position) || 0);
			case 'volume':
				return p.setVolume(Math.min(1, Math.max(0, Number(data.volume) || 0)));
			case 'shuffle':
				return p.setShuffle(!!data.on);
			case 'repeat':
				return p.setRepeat(['off', 'all', 'one'].includes(data.mode) ? data.mode : 'off');
			case 'playSongs':
				if (Array.isArray(data.songs) && data.songs.length)
					p.playSongs(data.songs, Math.min(Math.max(0, data.index | 0), data.songs.length - 1));
				return;
			case 'queueSong':
				if (data.song) p.queueSong(data.song, !!data.next);
				if (Array.isArray(data.songs)) for (const song of data.songs) p.queueSong(song, false);
				return;
			case 'jumpTo':
				return p.jumpTo(data.index | 0, data.song ?? null);
			case 'takeOver': {
				const playback: ConnectPlayback | null = data.playback ?? null;
				const at = playback ? positionOf(playback) : 0;
				p.takeOver(playback, data.queue ?? null, at, !!data.play);
				return;
			}
			case 'release':
				return p.release();
		}
	} catch (error) {
		console.error(`Connect: couldn't ${type}:`, error);
	}
}

// --- The device that plays: sending its state --------------------------------------------

let lastSent = '';
let lastQueue = '';
let sending = Promise.resolve();

/**
 * Sends what plays here, if this is the device that plays (or `claim`: the user started
 * playing here, so it is now). Only what changed, unless `force` (the heartbeat).
 */
function report(claim: boolean, force = false) {
	const state = get(connect);
	if (state.status !== 'live' || !device || !player) return;
	const active = state.activeDeviceId === device.id;
	const local = player.state();
	if (!active && !(claim && local?.playing)) return;
	const playback: api.ConnectPlaybackInput | null = local
		? { ...local, song: connectSong(local.song) }
		: null;
	const key = JSON.stringify(
		playback && { ...playback, position: Math.round(playback.position * 2) / 2 }
	);
	const queue = local ? player.queue() : null;
	const queueKey = JSON.stringify(
		queue && [queue.index, queue.songs.map((song) => `${song.id}:${song.track ?? 0}`)]
	);
	const queueChanged = queueKey !== lastQueue;
	if (!force && !claim && key === lastSent && !queueChanged) return;
	lastSent = key;
	lastQueue = queueKey;
	// One at a time, in order
	sending = sending.then(async () => {
		try {
			const isActive = await api.updateConnectPlayback(
				get(keyStore).access_token,
				device!.id,
				playback,
				queueChanged ? queue : null,
				claim
			);
			if (!isActive && active) lastSent = '';
		} catch (error) {
			console.warn('Connect: could not send the playback:', error);
			lastSent = '';
			lastQueue = '';
		}
	});
}

// --- Controlling the device that plays --------------------------------------------------

/** Changes what the player shows right away, as the device that plays will soon */
function showAsked(change: Partial<ConnectPlayback>) {
	optimisticSince = serverNow();
	connect.update((state) =>
		state.playback
			? {
					...state,
					playback: {
						...state.playback,
						position: positionOf(state.playback),
						updatedAt: serverNow(),
						...change
					}
				}
			: state
	);
}

async function send(type: string, data: unknown = null) {
	const state = get(connect);
	if (!state.remote || !device) return false;
	try {
		const sent = await api.sendConnectCommand(get(keyStore).access_token, device.id, type, data);
		if (!sent)
			showToast(
				`${state.remoteDevice?.name ?? 'The device'} didn't answer`,
				'icon-[mingcute--warning-line]'
			);
		return sent;
	} catch (error) {
		console.warn(`Connect: could not send ${type}:`, error);
		showToast("Couldn't reach the device that plays", 'icon-[mingcute--warning-line]');
		return false;
	}
}

let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let volumeWanted: number | null = null;

/** The controls for the device that plays (when another one does: `get(connect).remote`) */
export const remote = {
	play() {
		showAsked({ playing: true });
		return send('play');
	},
	pause() {
		showAsked({ playing: false });
		return send('pause');
	},
	toggle() {
		return get(connect).playback?.playing ? remote.pause() : remote.play();
	},
	next() {
		return send('next');
	},
	previous() {
		return send('previous');
	},
	seek(position: number) {
		showAsked({ position: Math.max(0, position) });
		return send('seek', { position: Math.max(0, position) });
	},
	/** 0–1; while dragging, sent at most every 150 ms (the last one always) */
	setVolume(volume: number) {
		const value = Math.min(1, Math.max(0, volume));
		showAsked({ volume: value });
		volumeWanted = value;
		if (volumeTimer) return;
		send('volume', { volume: value });
		volumeWanted = null;
		volumeTimer = setTimeout(function flush() {
			volumeTimer = null;
			if (volumeWanted == null) return;
			const wanted = volumeWanted;
			volumeWanted = null;
			send('volume', { volume: wanted });
			volumeTimer = setTimeout(flush, 150);
		}, 150);
	},
	setShuffle(on: boolean) {
		showAsked({ shuffle: on });
		return send('shuffle', { on });
	},
	setRepeat(mode: Repeat) {
		showAsked({ repeat: mode });
		return send('repeat', { mode });
	},
	cycleRepeat() {
		const mode = get(connect).playback?.repeat ?? 'off';
		return remote.setRepeat(mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');
	},
	/** Plays these songs from the one at `index` there (a whole list at most 300 songs long,
	 * around the one chosen) */
	playSongs(songs: MapSet[], index = 0) {
		const from = Math.max(0, Math.min(index - 50, songs.length - 300));
		const sent = songs.slice(from, from + 300).map(connectSong);
		const song = songs[index];
		if (song) askedSong = { key: keyOfSong(song), until: Date.now() + 8000 };
		if (song)
			showAsked({
				song: connectSong(song),
				position: 0,
				playing: true,
				duration: Number(song.beatmaps?.[0]?.total_length) || 0
			});
		return send('playSongs', { songs: sent, index: index - from });
	},
	queueSong(song: MapSet, next = false) {
		showToast(
			next
				? `Plays next on ${get(connect).remoteDevice?.name}`
				: `Added to the queue on ${get(connect).remoteDevice?.name}`,
			'icon-[mingcute--playlist-2-line]'
		);
		return send('queueSong', { song: connectSong(song), next });
	},
	/** Songs (a whole playlist) to the end of the queue there */
	queueSongs(songs: MapSet[]) {
		showToast(
			`Added to the queue on ${get(connect).remoteDevice?.name}`,
			'icon-[mingcute--playlist-2-line]'
		);
		return send('queueSong', { songs: songs.slice(0, 300).map(connectSong) });
	},
	/** The song at `index` of the queue it sent */
	jumpTo(index: number) {
		const song = get(connect).queue?.songs[index] ?? null;
		return send('jumpTo', { index, song });
	}
};

/** Moves the playback to a device (this one included): it goes on there where it was */
export async function transferTo(targetId: string) {
	const state = get(connect);
	if (state.status !== 'live' || !device || !player) return;
	if (targetId === state.activeDeviceId) return;
	const playing = state.remote
		? (state.playback?.playing ?? true)
		: (player.state()?.playing ?? state.playback?.playing ?? false);
	if (targetId === device.id) {
		// Here: right away (from the tap: browsers start sound only then), the others are told
		const playback = state.playback;
		connect.set({ ...state, activeDeviceId: device.id, remote: false, remoteDevice: null });
		player.takeOver(playback, state.queue, positionOf(playback), playing);
	} else if (!state.remote) {
		// From here: the others get the state as it is right now first
		report(false, true);
		await sending;
	}
	try {
		await api.transferConnectPlayback(get(keyStore).access_token, device.id, targetId, playing);
	} catch (error) {
		console.warn('Connect: could not move the playback:', error);
		showToast("Couldn't move the playback", 'icon-[mingcute--warning-line]');
	}
}

/** A device's icon (the whole class names: the icons are found by them) */
export const DEVICE_ICONS: Record<DeviceKind, string> = {
	computer: 'icon-[mingcute--computer-line]',
	phone: 'icon-[mingcute--cellphone-line]',
	tablet: 'icon-[mingcute--pad-line]',
	browser: 'icon-[mingcute--globe-line]'
};
