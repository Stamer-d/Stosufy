import { derived } from 'svelte/store';
import { librarySongs, mapDataStore } from './data';
import { currentSong } from './audio';
import { DEFAULT_HOME, userSettings } from './user';
import type { MapSet } from '../types';

// The random wallpaper: a new one with every song change (not while browsing or pausing)
let randomPick = Math.random();
let pickedFor: unknown = undefined;

/** The song whose background is used as wallpaper / featured banner */
export const wallpaper = derived(
	[mapDataStore, currentSong, userSettings],
	([$mapData, $currentSong, $userSettings]): {
		song: MapSet | null;
		label: string;
		downloaded: boolean;
	} => {
		const home = { ...DEFAULT_HOME, ...$userSettings.settings?.home };
		const songKey = $currentSong.song
			? `${$currentSong.song.id}:${$currentSong.song.track ?? 0}`
			: null;
		if (songKey !== pickedFor) {
			if (pickedFor !== undefined) randomPick = Math.random();
			pickedFor = songKey;
		}
		const downloaded = librarySongs();
		const randomSong = downloaded.length
			? downloaded[Math.floor(randomPick * downloaded.length)]
			: null;

		if (home.heroBackground === 'pinned') {
			const pinned = downloaded.find((song) => song.id == home.pinnedSetId);
			if (pinned) return { song: pinned, label: 'Pinned', downloaded: true };
		}
		if (home.heroBackground === 'current' && $currentSong.song) {
			return {
				song: $currentSong.song,
				label: $currentSong.isPlaying ? 'Now playing' : 'Paused',
				downloaded: !!$mapData[$currentSong.song.id]
			};
		}
		return { song: randomSong, label: 'From your downloads', downloaded: true };
	}
);
