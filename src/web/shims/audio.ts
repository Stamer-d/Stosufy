// The desktop player's stores, as far as the shared code asks for them in the web app (the
// listening history looks at what plays): from the web app's player

import { derived } from 'svelte/store';
import { audioElement, playing, queue } from '../player';

export const songQueue = derived(audioElement, (audio) => ({ audio }));
export const currentSong = derived([queue, playing], ([{ songs, index }, isPlaying]) => ({
	song: songs[index] ?? null,
	isPlaying
}));
