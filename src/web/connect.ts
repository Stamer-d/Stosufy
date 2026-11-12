// Stosufy Connect in the web app (see ../lib/stores/connect.ts): the phone as one of the
// user's devices. While another one plays (the desktop app), the player shows that one and
// controls it: its song, queue and position, play, pause, next, the songs chosen here, its
// volume (in the player's sheet of devices). Or the playback comes over to the phone.

import { get, writable } from 'svelte/store';
import {
	connect,
	connectQueue,
	positionOf,
	remote,
	useConnectPlayer,
	type ConnectPlayer,
	type ConnectState
} from '../lib/stores/connect';
import { sameSong } from '../lib/tracks';
import { showToast } from '../lib/stores/toast';
import {
	audioElement,
	queue,
	shuffle,
	repeat,
	playing,
	time,
	ownPlayback,
	showElsewhere,
	showOwn,
	playHere,
	stopForElsewhere,
	toggle,
	next,
	previous,
	seek,
	jumpTo,
	play,
	playNext,
	addToQueue,
	toggleShuffle,
	cycleRepeat,
	type Elsewhere
} from './player';
import type { MapSet } from '../lib/types';

/** What the player's controls do while another device plays */
const controls: Elsewhere = {
	play: (songs, index) => remote.playSongs(songs, index),
	toggle: () => remote.toggle(),
	next: () => remote.next(),
	previous: () => remote.previous(),
	seek: (seconds) => remote.seek(seconds),
	jumpTo: (index) => remote.jumpTo(index),
	queueSong: (song, next) => remote.queueSong(song, next),
	setShuffle: (on) => remote.setShuffle(on),
	cycleRepeat: () => remote.cycleRepeat(),
	cantChangeQueue: () =>
		showToast(
			`Change the queue on ${get(connect).remoteDevice?.name ?? 'the device that plays'}`,
			'icon-[mingcute--playlist-2-line]'
		)
};

/** The songs the other device sent, the song playing in them (its queue may come a moment
 * after the song) */
function songsOf(state: ConnectState) {
	const playback = state.playback!;
	const sent = state.queue;
	if (sent && sameSong(sent.songs[sent.index], playback.song))
		return { songs: sent.songs, index: sent.index };
	const songs = sent?.songs ?? [];
	const at = songs.findIndex((song) => sameSong(song, playback.song));
	return at >= 0 ? { songs, index: at } : { songs: [playback.song], index: 0 };
}

let shownSongs: MapSet[] = [];
let shownFrom: unknown = null;

function show(state: ConnectState) {
	const playback = state.playback!;
	// (the same list as long as it's the same: the player's list isn't drawn again)
	const key = state.queue ?? playback.song;
	let { songs, index } = songsOf(state);
	if (key === shownFrom && shownSongs.length === songs.length) songs = shownSongs;
	shownSongs = songs;
	shownFrom = key;
	showElsewhere(controls, {
		songs,
		index,
		playing: playback.playing,
		current: positionOf(playback),
		duration: playback.duration || Number(playback.song.beatmaps?.[0]?.total_length) || 0,
		shuffle: playback.shuffle,
		repeat: playback.repeat
	});
}

let shownRemote = false;

/** The player follows what the devices do */
function follow(state: ConnectState, before: ConnectState | null) {
	if (state.remote && state.playback) {
		shownRemote = true;
		show(state);
		return;
	}
	if (!shownRemote) return;
	shownRemote = false;
	// The device that played is gone (closed): its song here, paused, to play on with
	const gone = state.status === 'live' && !state.activeDeviceId && before?.playback;
	if (gone) {
		const last = state.playback ?? before!.playback!;
		const { songs, index } = songsOf({
			...state,
			playback: last,
			queue: state.queue ?? before!.queue
		});
		showOwn({
			songs,
			index,
			current: last.position,
			duration: last.duration,
			shuffle: last.shuffle,
			repeat: last.repeat
		});
	} else if (state.activeDeviceId === state.deviceId && before?.playback) {
		// It came over to this one: its song (playing here in a moment), not this one's own
		// from before (else that would go to the others for a moment)
		const last = before.playback;
		const { songs, index } = songsOf({ ...before, playback: last });
		showOwn({
			songs,
			index,
			current: positionOf(last),
			duration: last.duration,
			shuffle: last.shuffle,
			repeat: last.repeat
		});
	} else showOwn();
}

const webPlayer: ConnectPlayer = {
	state() {
		const own = ownPlayback();
		// (the phone's volume is its own: iOS doesn't let a page set it)
		return own ? { ...own, volume: null } : null;
	},
	queue() {
		if (!ownPlayback()) return null;
		const { songs, index } = get(queue);
		return connectQueue(songs, index);
	},
	watch(changed) {
		let watched: HTMLAudioElement | null = null;
		const onPlay = () => changed('play');
		const onOther = () => changed('other');
		const events = ['pause', 'seeked', 'ratechange', 'durationchange'];
		audioElement.subscribe((audio) => {
			if (audio === watched) return;
			watched?.removeEventListener('play', onPlay);
			for (const type of events) watched?.removeEventListener(type, onOther);
			audio?.addEventListener('play', onPlay);
			for (const type of events) audio?.addEventListener(type, onOther);
			watched = audio;
			changed('other');
		});
		queue.subscribe(onOther);
		shuffle.subscribe(onOther);
		repeat.subscribe(onOther);
	},
	play() {
		if (!ownPlayback()?.playing) toggle();
	},
	pause() {
		if (ownPlayback()?.playing) toggle();
	},
	next: () => next(),
	previous: () => previous(),
	seek: (seconds) => seek(seconds),
	setVolume() {
		// (not on a phone)
	},
	setShuffle(on) {
		if (get(shuffle) !== on) toggleShuffle();
	},
	setRepeat(mode) {
		for (let i = 0; i < 3 && get(repeat) !== mode; i++) cycleRepeat();
	},
	playSongs: (songs, index) => play(songs, index),
	queueSong: (song, next) => (next ? playNext(song) : addToQueue(song)),
	jumpTo(index, song) {
		const { songs, index: now } = get(queue);
		let at = Math.max(0, now - 20) + index;
		if (song && !sameSong(songs[at], song)) at = songs.findIndex((other) => sameSong(other, song));
		if (at >= 0 && at !== now) jumpTo(at);
	},
	takeOver(playback, sent, at, start) {
		if (!playback) return;
		const { songs, index } = songsOf({ ...get(connect), playback, queue: sent });
		playHere(songs, index, at, start, {
			duration: playback.duration,
			shuffle: playback.shuffle,
			repeat: playback.repeat
		});
		// (the phone may not let a song start without a tap: then it starts with the next one)
		if (start)
			setTimeout(() => {
				if (!ownPlayback()?.playing && !get(connect).remote)
					showToast('Tap play to go on here', 'icon-[mingcute--play-line]');
			}, 1500);
	},
	release() {
		stopForElsewhere();
	}
};

if (typeof window !== 'undefined') {
	useConnectPlayer(webPlayer, false);
	let before: ConnectState | null = null;
	connect.subscribe((state) => {
		follow(state, before);
		before = state;
	});
	// Where the song there is, on the line (four times a second)
	setInterval(() => {
		const state = get(connect);
		if (!state.remote || !state.playback) return;
		const now = get(time);
		time.set({ ...now, current: positionOf(state.playback) });
		if (get(playing) !== state.playback.playing) playing.set(state.playback.playing);
	}, 250);
}

/** The sheet of devices is open (from the player or the bar at the bottom) */
export const devicesOpen = writable(false);
