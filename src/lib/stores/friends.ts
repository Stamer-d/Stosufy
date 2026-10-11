// Friend activity: shares what you listen to with your osu! friends, and shows what they
// listen to. Clicking a friend listens along: joins their listening session if they're in
// one, otherwise plays their song from where they are.

import { get, writable } from 'svelte/store';
import { open } from '@tauri-apps/plugin-shell';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import * as api from '../api';
import { keyStore, exchangeCode, osuAuthUrl } from './auth';
import { user, userSettings, updateUserSettings } from './user';
import { currentSong, songQueue, setSongQueue, setPlaybackMod, queuePanelOpen } from './audio';
import { currentMod, MODS } from './mods';
import { listen, joinSession, songFor } from './listen';
import { showToast } from './toast';
import type { PlaybackMod } from '../types';

export interface FriendsState {
	status: 'idle' | 'loading' | 'ok' | 'needs-login' | 'error';
	friends: api.FriendActivity[];
	/** Local time minus server time (ms) */
	offset: number;
	message?: string;
}

export const friendActivity = writable<FriendsState>({ status: 'idle', friends: [], offset: 0 });
export const friendsPanelOpen = writable(false);

/** A friend counts as listening right now if they sent something this recently */
export const LIVE_FOR = 3 * 60 * 1000;
const POLL = 30 * 1000;
/** Sent this often while playing, so friends see the right position */
const HEARTBEAT = 60 * 1000;

export function sharing() {
	return get(userSettings).settings?.shareActivity ?? true;
}

export function setSharing(share: boolean) {
	updateUserSettings({ shareActivity: share });
	lastSent = null;
	if (!share) send(null);
	else shareNow();
}

// --- What the user plays ------------------------------------------------------------

let lastSent: string | null = null;

async function send(playback: api.ListenPlaybackInput | null, roomCode: string | null = null) {
	const token = get(keyStore).access_token;
	if (!token || !get(user)?.id) return;
	try {
		await api.setNowPlaying(token, playback, roomCode);
	} catch (error) {
		console.warn('Could not share the playback:', error);
	}
}

/** Sends the current playback if it changed (or `force`) */
function shareNow(force = false) {
	if (!sharing()) return;
	const song = get(currentSong).song;
	const audio = get(songQueue).audio;
	const setId = Number(song?.id);
	if (!song || !audio || !(setId > 0)) return;
	const playback: api.ListenPlaybackInput = {
		setId,
		mapId: Number(song.beatmaps?.[0]?.id ?? 0),
		title: song.title ?? '',
		artist: song.artist ?? '',
		position: audio.currentTime,
		playing: !audio.paused,
		mod: currentMod()
	};
	const room = get(listen);
	const roomCode = room.status === 'live' ? room.code : null;
	const key = JSON.stringify({ ...playback, position: 0, roomCode });
	if (!force && key === lastSent) return;
	lastSent = key;
	send(playback, roomCode);
}

// --- What the friends play ----------------------------------------------------------

let loading = false;

export async function loadFriendActivity() {
	const token = get(keyStore).access_token;
	if (loading || !token) return;
	loading = true;
	friendActivity.update((s) => ({ ...s, status: s.status === 'ok' ? 'ok' : 'loading' }));
	try {
		const sentAt = Date.now();
		const { friends, serverTime } = await api.getFriendActivity(token);
		const offset = (sentAt + Date.now()) / 2 - serverTime;
		friendActivity.set({ status: 'ok', friends, offset });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		friendActivity.update((s) => ({
			...s,
			status: /log in again/i.test(message) ? 'needs-login' : 'error',
			message
		}));
	} finally {
		loading = false;
	}
}

/** Where a friend is in their song now, in seconds */
export function friendPosition(friend: api.FriendActivity) {
	const { playback } = friend;
	if (!playback.playing) return playback.position;
	const serverNow = Date.now() - get(friendActivity).offset;
	const rate = MODS[playback.mod as PlaybackMod]?.rate ?? 1;
	return playback.position + ((serverNow - playback.updatedAt) / 1000) * rate;
}

/** Listens along with a friend */
export async function listenAlong(friend: api.FriendActivity) {
	const room = get(listen);
	if (friend.roomCode) {
		if (room.code !== friend.roomCode) await joinSession(friend.roomCode);
		return;
	}
	const playback = { ...friend.playback, mod: friend.playback.mod as PlaybackMod };
	const song = await songFor(playback);
	listen.update((s) => ({ ...s, activity: null }));
	if (!song) {
		showToast(`Couldn't play ${friend.playback.title}`, 'icon-[mingcute--warning-line]');
		return;
	}
	if (currentMod() !== playback.mod) setPlaybackMod(playback.mod);
	await setSongQueue(0, [song], 'playlist', null, true, friendPosition(friend));
}

/** Asks osu! again, now with access to the friend list */
export async function connectFriends() {
	const stop = await onOpenUrl(async (urls) => {
		if (!urls[0]?.includes('code=')) return;
		stop();
		try {
			const tokens = await exchangeCode(urls[0].split('code=')[1]);
			keyStore.update((keys) => ({
				...keys,
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expiry_time: Date.now() + tokens.expires_in * 1000
			}));
			loadFriendActivity();
		} catch (error) {
			console.error('Could not log in again:', error);
			showToast("Couldn't connect to osu!", 'icon-[mingcute--warning-line]');
		}
	});
	await open(osuAuthUrl);
}

if (typeof window !== 'undefined') {
	// Share on every change of song, pause or seek, and now and then while playing
	let watched: HTMLAudioElement | null = null;
	const onChange = () => setTimeout(() => shareNow(true), 500);
	songQueue.subscribe(({ audio }) => {
		if (audio === watched) return;
		for (const type of ['play', 'pause', 'seeked', 'ratechange']) {
			watched?.removeEventListener(type, onChange);
			audio?.addEventListener(type, onChange);
		}
		watched = audio ?? null;
		onChange();
	});
	listen.subscribe(() => shareNow());
	setInterval(() => {
		if (!get(songQueue).audio?.paused) shareNow(true);
	}, HEARTBEAT);

	// One panel at a time on the right
	friendsPanelOpen.subscribe((isOpen) => isOpen && queuePanelOpen.set(false));
	queuePanelOpen.subscribe((isOpen) => isOpen && friendsPanelOpen.set(false));

	// Load the friends while the panel is open
	let timer: ReturnType<typeof setInterval> | null = null;
	friendsPanelOpen.subscribe((isOpen) => {
		if (timer) clearInterval(timer);
		timer = null;
		if (!isOpen) return;
		loadFriendActivity();
		timer = setInterval(loadFriendActivity, POLL);
	});
}
