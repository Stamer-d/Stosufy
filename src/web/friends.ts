// Friends, as in the desktop app: your osu! friends who use Stosufy, whether they're on and
// what they listen to (tap one to listen along), and the same of you for them. Who sees what
// is the account's setting, the same as on the desktop.

import { get, writable } from 'svelte/store';
import * as api from '../lib/api';
import { freshToken, keyStore } from './shims/auth';
import { user, userSettings, updateUserSettings } from './shims/user';
import { queue, playing, time, audioElement, play } from './player';
import { offline } from '../lib/stores/network';
import { showToast } from '../lib/stores/toast';
import { MODS, currentMod } from '../lib/stores/mods';
import type { MapSet, PlaybackMod } from '../lib/types';

export interface FriendsState {
	status: 'idle' | 'loading' | 'ok' | 'needs-login' | 'error';
	friends: api.FriendActivity[];
	/** Local time minus server time (ms) */
	offset: number;
	message?: string;
}

export const friendActivity = writable<FriendsState>({ status: 'idle', friends: [], offset: 0 });

const POLL = 30 * 1000;
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

export function setVisibility(value: Visibility | string) {
	updateUserSettings({ activityVisibility: value as Visibility });
	lastSent = null;
	if (value === 'hidden')
		freshToken()
			.then((token) => api.hidePresence(token))
			.catch(() => {});
	else checkIn(true);
}

// --- Your own status ----------------------------------------------------------------

let lastSent: string | null = null;

function nowPlaying(): api.ListenPlaybackInput | null {
	const { songs, index } = get(queue);
	const song = songs[index];
	const setId = Number(song?.id);
	if (!song || !(setId > 0)) return null;
	return {
		setId,
		mapId: Number(song.beatmaps?.[0]?.id ?? 0),
		title: song.title ?? '',
		artist: song.artist ?? '',
		position: get(time).current,
		playing: get(playing),
		mod: currentMod()
	};
}

/** Checks in as online with the song now, if it changed (or `force`) */
async function checkIn(force = false) {
	const shown = visibility();
	if (shown === 'hidden' || !get(keyStore).access_token || !get(user)?.id || get(offline)) return;
	const playback = shown === 'all' ? nowPlaying() : null;
	const key = JSON.stringify({ ...playback, position: 0 });
	if (!force && key === lastSent) return;
	lastSent = key;
	try {
		await api.setPresence(await freshToken(), true, playback, null);
	} catch (error) {
		console.warn('Could not check in:', error);
	}
}

// --- What the friends play ----------------------------------------------------------

let loading = false;

export async function loadFriendActivity() {
	if (loading || !get(keyStore).access_token || get(offline)) return;
	loading = true;
	friendActivity.update((s) => ({ ...s, status: s.status === 'ok' ? 'ok' : 'loading' }));
	try {
		const token = await freshToken();
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

/** Polls the friends while a page shows them; returns the stop */
export function watchFriends() {
	loadFriendActivity();
	const timer = setInterval(loadFriendActivity, POLL);
	const onShow = () => document.visibilityState === 'visible' && loadFriendActivity();
	document.addEventListener('visibilitychange', onShow);
	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onShow);
	};
}

/** Where a friend is in their song now, in seconds (songs with mods play faster or slower) */
export function friendPosition(friend: api.FriendActivity) {
	const { playback } = friend;
	if (!playback) return 0;
	if (!playback.playing) return playback.position;
	const serverNow = Date.now() - get(friendActivity).offset;
	const rate =
		playback.mod === 'dt' || playback.mod === 'nc' ? 1.5 : playback.mod === 'ht' ? 0.75 : 1;
	return playback.position + ((serverNow - playback.updatedAt) / 1000) * rate;
}

/** A friend's song, to play */
export const friendSong = (playback: NonNullable<api.FriendActivity['playback']>): MapSet => ({
	id: playback.setId,
	title: playback.title,
	artist: playback.artist,
	beatmaps: [{ id: playback.mapId }]
});

/** Listens along: their song, from where they are (an offline friend's last one from the start) */
export function listenAlong(friend: api.FriendActivity) {
	if (!friend.playback) return;
	const at = friend.online ? Math.max(0, friendPosition(friend)) : 0;
	// (their speed mod too, as in the desktop app)
	const mod = friend.playback.mod as PlaybackMod;
	if (MODS[mod] && mod !== currentMod()) updateUserSettings({ mod });
	play([friendSong(friend.playback)], 0, { at });
	showToast(`Listening along with ${friend.username}`, 'icon-[mingcute--headphone-line]');
}

if (typeof window !== 'undefined') {
	// Check in on every change of song, pause or seek, and every minute to stay online
	let watched: HTMLAudioElement | null = null;
	const onChange = () => setTimeout(() => checkIn(true), 500);
	audioElement.subscribe((audio) => {
		if (audio === watched) return;
		for (const type of ['play', 'pause', 'seeked']) {
			watched?.removeEventListener(type, onChange);
			audio?.addEventListener(type, onChange);
		}
		watched = audio;
	});
	queue.subscribe(() => checkIn());
	user.subscribe((current) => current?.id && checkIn(true));
	setInterval(() => checkIn(true), HEARTBEAT);
	// Closed: offline (with the app in the background and a song on, it stays on)
	window.addEventListener('pagehide', () => {
		const token = get(keyStore).access_token;
		if (visibility() !== 'hidden' && token && !get(playing))
			api.setPresence(token, false).catch(() => {});
	});
}
