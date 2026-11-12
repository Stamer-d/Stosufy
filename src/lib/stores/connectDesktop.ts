// Stosufy Connect in the desktop app (see connect.ts): the player here as one of the user's
// devices. While another device plays, the song bar shows that one and controls it, and the
// songs chosen here (a playlist, a search, the queue's "Play next") play there; the add-ons
// (DJ mode, Dash, the puzzle) and a listening session still play here.

import { get } from 'svelte/store';
import {
	currentSong,
	jumpTo,
	queueSong,
	setRedirect,
	setSongQueue,
	shuffleQueue,
	skipBackward,
	skipForward,
	songQueue,
	stopPlayback,
	togglePlayback,
	updateSongQueue,
	upNext,
	withoutPlaybackLock
} from './audio';
import { userSettings, updateUserSettings } from './user';
import { setVolume, DEFAULT_VOLUME, MAX_VOLUME } from './mixer';
import { librarySong } from './radio';
import { listen } from './listen';
import { showToast } from './toast';
import { sameSong } from '../tracks';
import {
	connect,
	connectQueue,
	remote,
	useConnectPlayer,
	type ConnectPlayer,
	type Repeat
} from './connect';
import type { MapSet } from '../types';

/** A song from another device, as this app keeps it (the downloaded one if it's there) */
function here(song: MapSet): MapSet {
	const own = librarySong(song);
	if (own) return (song as { queued?: boolean }).queued ? { ...own, queued: true } : own;
	return {
		...song,
		preview_url: song.preview_url ?? `https://b.ppy.sh/preview/${song.id}.mp3`
	} as MapSet;
}

/** The queue as the other devices see it: the queued songs right after the one playing */
function fullQueue() {
	const { queue, currentIndex } = get(songQueue);
	if (!queue?.length) return { songs: [] as MapSet[], index: -1 };
	const queued = get(upNext).map((song) => ({ ...song, queued: true }) as MapSet);
	return {
		songs: [...queue.slice(0, currentIndex + 1), ...queued, ...queue.slice(currentIndex + 1)],
		index: currentIndex
	};
}

const settings = () => get(userSettings).settings ?? {};

const desktopPlayer: ConnectPlayer = {
	state() {
		const { audio } = get(songQueue);
		const song = get(currentSong).song;
		if (!audio || !song) return null;
		const { muted, volume, shuffle, repeat } = settings();
		return {
			song,
			position: audio.currentTime || 0,
			duration: Number.isFinite(audio.duration) ? audio.duration : 0,
			playing: !audio.paused,
			rate: audio.playbackRate || 1,
			volume: muted ? 0 : (volume ?? DEFAULT_VOLUME) / MAX_VOLUME,
			shuffle: !!shuffle,
			repeat: (repeat ?? 'off') as Repeat
		};
	},

	queue() {
		const { songs, index } = fullQueue();
		return connectQueue(songs, index);
	},

	watch(changed) {
		let watched: HTMLAudioElement | null = null;
		const onPlay = () => changed('play');
		const onOther = () => changed('other');
		const events = ['pause', 'seeked', 'ratechange', 'durationchange'];
		songQueue.subscribe(({ audio }) => {
			if (audio === watched) return;
			watched?.removeEventListener('play', onPlay);
			for (const type of events) watched?.removeEventListener(type, onOther);
			audio?.addEventListener('play', onPlay);
			for (const type of events) audio?.addEventListener(type, onOther);
			watched = audio ?? null;
			changed('other');
		});
		upNext.subscribe(onOther);
		let applied = '';
		userSettings.subscribe(({ settings }) => {
			const key = `${settings?.volume}:${settings?.muted}:${settings?.shuffle}:${settings?.repeat}`;
			if (key === applied) return;
			applied = key;
			changed('other');
		});
	},

	play() {
		if (get(songQueue).audio?.paused) togglePlayback();
	},
	pause() {
		if (get(songQueue).audio && !get(songQueue).audio.paused) stopPlayback();
	},
	next: () => skipForward(),
	previous: () => skipBackward(),
	seek(seconds) {
		const audio = get(songQueue).audio;
		if (!audio) return;
		audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, seconds));
	},
	setVolume: (volume) => setVolume(volume * MAX_VOLUME),
	setShuffle(on) {
		if (!!settings().shuffle === on) return;
		updateUserSettings({ shuffle: on });
		shuffleQueue();
	},
	setRepeat: (mode) => updateUserSettings({ repeat: mode }),
	playSongs: (songs, index) => setSongQueue(index, songs.map(here), 'playlist'),
	queueSong: (song, next) => queueSong(here(song), next),

	jumpTo(index, song) {
		const { songs, index: current } = fullQueue();
		const published = connectQueue(songs, current);
		if (!published) return;
		let at = current - published.index + index;
		// (the queue changed meanwhile: the song where it is now)
		if (song && !sameSong(songs[at], song)) at = songs.findIndex((other) => sameSong(other, song));
		if (at < 0 || at === current) return;
		const queued = get(upNext).length;
		if (at < current) jumpTo(at);
		else if (at <= current + queued) {
			// One of the queued songs: the ones before it are skipped
			upNext.update((list) => list.slice(at - current - 1));
			skipForward();
		} else jumpTo(at - queued);
	},

	async takeOver(playback, queue, at, play) {
		if (!playback) return;
		let songs = queue?.songs?.length ? queue.songs : [playback.song];
		let index = queue ? queue.index : 0;
		if (!sameSong(songs[index], playback.song)) {
			songs = [playback.song];
			index = 0;
		}
		// (queued songs there stay queued here: they come next, before the rest)
		const queued = songs.slice(index + 1).filter((song) => (song as { queued?: boolean }).queued);
		const rest = songs.filter((song, i) => i <= index || !(song as { queued?: boolean }).queued);
		const mine = rest.map(here);
		updateUserSettings({ shuffle: playback.shuffle, repeat: playback.repeat });
		const audio = get(songQueue).audio;
		if (audio && sameSong(get(currentSong).song, playback.song)) {
			// The song is here already: on from there
			await updateSongQueue(index, mine, 'playlist');
			audio.currentTime = at;
			if (play && audio.paused) togglePlayback();
			if (!play && !audio.paused) stopPlayback();
		} else {
			// (from a moment in: the queue isn't shuffled again)
			await withoutPlaybackLock(() =>
				setSongQueue(index, mine, 'playlist', null, play, Math.max(at, 0.001))
			);
		}
		upNext.set(queued.map(here));
	},

	release() {
		const audio = get(songQueue).audio;
		if (!audio || audio.paused) return;
		stopPlayback();
		const name = get(connect).remoteDevice?.name;
		showToast(`Now playing on ${name ?? 'another device'}`, 'icon-[mingcute--cellphone-line]');
	}
};

/** Connects the desktop app as one of the user's devices */
export function startConnect() {
	useConnectPlayer(desktopPlayer, true);
	// While another device plays, the player's controls and the songs chosen go there; not
	// from the add-ons (they play here), nor in a listening session
	setRedirect(() => {
		if (!get(connect).remote) return null;
		if (location.pathname.startsWith('/addons')) return null;
		if (get(listen).status === 'live') return null;
		return {
			toggle: () => remote.toggle(),
			next: () => remote.next(),
			previous: () => remote.previous(),
			playSongs: (songs, index) => remote.playSongs(songs, index),
			queueSong: (song, next) => remote.queueSong(song, next),
			queueSongs: (songs) => remote.queueSongs(songs)
		};
	});
}
