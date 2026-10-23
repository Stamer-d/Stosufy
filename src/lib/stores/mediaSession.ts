// The system's media controls: the song in Windows' media overlay and on the lock screen
// (macOS: the Now Playing menu), with its cover, and their buttons (play, pause, next,
// previous, seek) controlling the player. The keyboard's media keys are global shortcuts
// (keybinds.ts); these are the controls the system shows itself.

import { get } from 'svelte/store';
import {
	currentSong,
	playbackTime,
	songQueue,
	skipBackward,
	skipForward,
	stopPlayback,
	togglePlayback
} from './audio';
import { thumbnailUrl } from './data';
import type { MapSet } from '../types';

/** The cover the system shows: osu!'s online one (it loads it itself), else the saved one */
async function artwork(song: MapSet) {
	const own = Number(song.id) > 0 && !(song.track ?? 0);
	const src = own
		? `https://assets.ppy.sh/beatmaps/${song.id}/covers/list@2x.jpg`
		: await thumbnailUrl(song.id, song.track ?? 0).catch(() => null);
	return src ? [{ src, sizes: '300x300', type: 'image/jpeg' }] : [];
}

export function startMediaSession() {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
	const session = navigator.mediaSession;

	let shown: MapSet | null = null;
	currentSong.subscribe(async ({ song, isPlaying }) => {
		session.playbackState = song ? (isPlaying ? 'playing' : 'paused') : 'none';
		if (song === shown) return;
		shown = song;
		if (!song) {
			session.metadata = null;
			return;
		}
		session.metadata = new MediaMetadata({
			title: song.title ?? '',
			artist: song.artist ?? '',
			album: song.songSource || (song.creator ? `mapped by ${song.creator}` : '')
		});
		const covers = await artwork(song);
		// (the song may have changed while the cover was looked up)
		if (shown === song && session.metadata) session.metadata.artwork = covers;
	});

	// Where the song is, so the overlay's bar moves (and can be dragged)
	playbackTime.subscribe(({ current, duration }) => {
		const audio = get(songQueue).audio;
		if (!audio || !Number.isFinite(duration) || duration <= 0) return;
		try {
			session.setPositionState({
				duration,
				position: Math.min(Math.max(current, 0), duration),
				playbackRate: audio.playbackRate || 1
			});
		} catch {
			// (not every webview knows the position)
		}
	});

	const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
		['play', () => get(songQueue).audio?.paused && togglePlayback()],
		['pause', () => get(songQueue).audio?.paused === false && togglePlayback()],
		['stop', () => stopPlayback()],
		['nexttrack', () => skipForward()],
		['previoustrack', () => skipBackward()],
		[
			'seekto',
			(details) => {
				const audio = get(songQueue).audio;
				if (audio && details.seekTime != null) audio.currentTime = details.seekTime;
			}
		]
	];
	for (const [action, handler] of actions) {
		try {
			session.setActionHandler(action, handler);
		} catch {
			// (an action this webview doesn't have)
		}
	}
}
