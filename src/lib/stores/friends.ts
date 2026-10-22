// Friend activity: shows your osu! friends whether you're online and what you listen to,
// and shows the same of them. Clicking a friend listens along: joins their listening session if they're in
// one, otherwise plays their song from where they are.

import { get, writable } from 'svelte/store';
import { open } from '@tauri-apps/plugin-shell';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import * as api from '../api';
import { keyStore, exchangeCode, osuAuthUrl, authCode } from './auth';
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

const POLL = 30 * 1000;
/** Checked in this often, so friends see you online and at the right position */
const HEARTBEAT = 60 * 1000;

export type Visibility = 'all' | 'online' | 'hidden';

export const VISIBILITY: Record<Visibility, { label: string; description: string }> = {
	all: {
		label: 'Everything',
		description: "Friends see that you're online and what you listen to."
	},
	online: {
		label: 'Only online',
		description: "Friends see that you're online, not what you listen to."
	},
	hidden: { label: 'Invisible', description: "Friends don't see you at all." }
};

export function visibility(): Visibility {
	const settings = get(userSettings).settings;
	return settings?.activityVisibility ?? (settings?.shareActivity === false ? 'hidden' : 'all');
}

export function setVisibility(value: Visibility) {
	updateUserSettings({ activityVisibility: value });
	lastSent = null;
	const token = get(keyStore).access_token;
	if (value === 'hidden' && token) api.hidePresence(token).catch(() => {});
	else checkIn(true);
}

// --- The user's own status ----------------------------------------------------------

let lastSent: string | null = null;

/** What the user plays now, or null */
function nowPlaying(): api.ListenPlaybackInput | null {
	const song = get(currentSong).song;
	const audio = get(songQueue).audio;
	const setId = Number(song?.id);
	if (!song || !audio || !(setId > 0)) return null;
	return {
		setId,
		mapId: Number(song.beatmaps?.[0]?.id ?? 0),
		title: song.title ?? '',
		artist: song.artist ?? '',
		position: audio.currentTime,
		playing: !audio.paused,
		mod: currentMod()
	};
}

/** Checks in as online with the current song, if it changed (or `force`) */
async function checkIn(force = false) {
	const token = get(keyStore).access_token;
	const shown = visibility();
	if (shown === 'hidden' || !token || !get(user)?.id) return;
	// "Only online": no song and no listening session
	const playback = shown === 'all' ? nowPlaying() : null;
	const room = get(listen);
	const roomCode = shown === 'all' && room.status === 'live' ? room.code : null;
	const key = JSON.stringify({ ...playback, position: 0, roomCode });
	if (!force && key === lastSent) return;
	lastSent = key;
	try {
		await api.setPresence(token, true, playback, roomCode);
	} catch (error) {
		console.warn('Could not check in:', error);
	}
}

/** Shows the user as offline; when the app closes */
export async function goOffline() {
	const token = get(keyStore).access_token;
	if (visibility() === 'hidden' || !token || !get(user)?.id) return;
	// Don't hold up closing the app for long
	await Promise.race([
		api.setPresence(token, false).catch(() => {}),
		new Promise((resolve) => setTimeout(resolve, 1500))
	]);
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
	if (!playback) return 0;
	if (!playback.playing) return playback.position;
	const serverNow = Date.now() - get(friendActivity).offset;
	const rate = MODS[playback.mod as PlaybackMod]?.rate ?? 1;
	return playback.position + ((serverNow - playback.updatedAt) / 1000) * rate;
}

/** Listens along with a friend */
export async function listenAlong(friend: api.FriendActivity) {
	const room = get(listen);
	if (!friend.playback) return;
	if (friend.roomCode) {
		if (room.code !== friend.roomCode) await joinSession(friend.roomCode);
		return;
	}
	const playback = { ...friend.playback!, mod: friend.playback.mod as PlaybackMod };
	const song = await songFor(playback);
	listen.update((s) => ({ ...s, activity: null }));
	if (!song) {
		showToast(`Couldn't play ${playback.title}`, 'icon-[mingcute--warning-line]');
		return;
	}
	if (currentMod() !== playback.mod) setPlaybackMod(playback.mod);
	// An offline friend's last song plays from the start
	await setSongQueue(0, [song], 'playlist', null, true, friend.online ? friendPosition(friend) : 0);
}

/** Asks osu! again, now with access to the friend list */
export async function connectFriends() {
	const stop = await onOpenUrl(async (urls) => {
		const code = authCode(urls.find((url) => url.includes('code=')));
		if (!code) return;
		stop();
		try {
			const tokens = await exchangeCode(code);
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
	// Check in on every change of song, pause or seek, and every minute to stay online
	let watched: HTMLAudioElement | null = null;
	const onChange = () => setTimeout(() => checkIn(true), 500);
	songQueue.subscribe(({ audio }) => {
		if (audio === watched) return;
		for (const type of ['play', 'pause', 'seeked', 'ratechange']) {
			watched?.removeEventListener(type, onChange);
			audio?.addEventListener(type, onChange);
		}
		watched = audio ?? null;
		onChange();
	});
	listen.subscribe(() => checkIn());
	user.subscribe((current) => current?.id && checkIn(true));
	setInterval(() => checkIn(true), HEARTBEAT);

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
