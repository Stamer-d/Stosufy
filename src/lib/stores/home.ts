import { derived } from 'svelte/store';
import { formatSongData, mapDataStore } from './data';
import { currentSong } from './audio';
import { DEFAULT_HOME, userSettings } from './user';
import type { MapSet } from '../types';

// Picked once per app start, so the random wallpaper doesn't change while browsing
const randomPick = Math.random();

/** The song whose background is used as wallpaper / featured banner */
export const wallpaper = derived(
	[mapDataStore, currentSong, userSettings],
	([$mapData, $currentSong, $userSettings]): {
		song: MapSet | null;
		label: string;
		downloaded: boolean;
	} => {
		const home = { ...DEFAULT_HOME, ...$userSettings.settings?.home };
		const downloaded = formatSongData($mapData);
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
