import type { Component } from 'svelte';
import type { PlacedWidget } from './types';
import MacClock from './components/widgets/MacClock.svelte';
import MacNowPlaying from './components/widgets/MacNowPlaying.svelte';
import MacUpNext from './components/widgets/MacUpNext.svelte';
import MacLibrary from './components/widgets/MacLibrary.svelte';
import MacPlaylists from './components/widgets/MacPlaylists.svelte';
import LinuxFetch from './components/widgets/LinuxFetch.svelte';
import LinuxClock from './components/widgets/LinuxClock.svelte';
import LinuxPlayer from './components/widgets/LinuxPlayer.svelte';
import LinuxVisualizer from './components/widgets/LinuxVisualizer.svelte';
import MinimalClock from './components/widgets/MinimalClock.svelte';
import MinimalNowPlaying from './components/widgets/MinimalNowPlaying.svelte';
import MacLyrics from './components/widgets/MacLyrics.svelte';
import MacSongInfo from './components/widgets/MacSongInfo.svelte';
import MacOsuProfile from './components/widgets/MacOsuProfile.svelte';
import MacFriends from './components/widgets/MacFriends.svelte';
import MacWeather from './components/widgets/MacWeather.svelte';
import MacNote from './components/widgets/MacNote.svelte';
import MacCalendar from './components/widgets/MacCalendar.svelte';
import MacRainRadar from './components/widgets/MacRainRadar.svelte';
import MacStormPotential from './components/widgets/MacStormPotential.svelte';
import MacWarnings from './components/widgets/MacWarnings.svelte';
import MacFlightRadar from './components/widgets/MacFlightRadar.svelte';

export type WidgetFamily = 'macos' | 'linux' | 'minimal';

export const WIDGET_FAMILIES: { id: WidgetFamily; label: string; description: string }[] = [
	{ id: 'macos', label: 'macOS', description: 'Frosted widgets like on the Mac desktop' },
	{ id: 'linux', label: 'Linux', description: 'Terminal tools from a riced desktop' },
	{ id: 'minimal', label: 'Minimal', description: 'Just text on the wallpaper' }
];

export const WIDGETS: Record<
	string,
	{ name: string; description: string; family: WidgetFamily; component: Component<any> }
> = {
	'mac-clock': {
		name: 'Clock',
		description: 'Analog clock',
		family: 'macos',
		component: MacClock
	},
	'mac-now-playing': {
		name: 'Now Playing',
		description: 'Current song with cover and controls',
		family: 'macos',
		component: MacNowPlaying
	},
	'mac-up-next': {
		name: 'Up Next',
		description: 'The next song, click to skip to it',
		family: 'macos',
		component: MacUpNext
	},
	'mac-library': {
		name: 'Library',
		description: 'Your downloaded songs and playlists',
		family: 'macos',
		component: MacLibrary
	},
	'mac-playlists': {
		name: 'Playlists',
		description: 'Quick access to four playlists',
		family: 'macos',
		component: MacPlaylists
	},
	'mac-lyrics': {
		name: 'Lyrics',
		description: 'The line being sung now',
		family: 'macos',
		component: MacLyrics
	},
	'mac-song-info': {
		name: 'Song info',
		description: 'BPM with a dot on the beat, length, difficulty and mapper',
		family: 'macos',
		component: MacSongInfo
	},
	'mac-osu-profile': {
		name: 'osu! profile',
		description: 'Your rank, pp and accuracy',
		family: 'macos',
		component: MacOsuProfile
	},
	'mac-friends': {
		name: 'Friends',
		description: 'Who is online and what they listen to',
		family: 'macos',
		component: MacFriends
	},
	'mac-weather': {
		name: 'Weather',
		description: 'The weather in your city',
		family: 'macos',
		component: MacWeather
	},
	'mac-note': {
		name: 'Note',
		description: 'A sticky note to write on',
		family: 'macos',
		component: MacNote
	},
	'mac-calendar': {
		name: 'Calendar',
		description: 'This month, with today marked',
		family: 'macos',
		component: MacCalendar
	},
	'mac-rain-radar': {
		name: 'Rain radar',
		description: 'The radar of the last two hours around you, as a loop',
		family: 'macos',
		component: MacRainRadar
	},
	'mac-storm-potential': {
		name: 'Storm potential',
		description: 'CAPE, lifted index, wind shear and gusts for the next 24 hours',
		family: 'macos',
		component: MacStormPotential
	},
	'mac-warnings': {
		name: 'Weather warnings',
		description: 'Warnings of the German weather service (DWD) where you are',
		family: 'macos',
		component: MacWarnings
	},
	'mac-flight-radar': {
		name: 'Flight radar',
		description: 'The planes around you, live; click one for its flight',
		family: 'macos',
		component: MacFlightRadar
	},
	'linux-fetch': {
		name: 'stosufetch',
		description: 'Your stats in the style of neofetch',
		family: 'linux',
		component: LinuxFetch
	},
	'linux-clock': {
		name: 'tty-clock',
		description: 'A big terminal clock',
		family: 'linux',
		component: LinuxClock
	},
	'linux-player': {
		name: 'Terminal player',
		description: 'Now playing like ncmpcpp, with controls',
		family: 'linux',
		component: LinuxPlayer
	},
	'linux-visualizer': {
		name: 'cava',
		description: 'Audio bars that move with the music',
		family: 'linux',
		component: LinuxVisualizer
	},
	'minimal-clock': {
		name: 'Big clock',
		description: 'Time, date and greeting',
		family: 'minimal',
		component: MinimalClock
	},
	'minimal-now-playing': {
		name: 'Now playing text',
		description: 'Title and artist with a thin progress line',
		family: 'minimal',
		component: MinimalNowPlaying
	}
};

export const DEFAULT_WIDGETS: PlacedWidget[] = [
	{ uid: 'default-clock', type: 'minimal-clock', x: 0.03, y: 0.04 },
	{ uid: 'default-now-playing', type: 'mac-now-playing', x: 0.03, y: 1 },
	{ uid: 'default-playlists', type: 'mac-playlists', x: 1, y: 0.42 },
	{ uid: 'default-up-next', type: 'mac-up-next', x: 0.7, y: 1 },
	{ uid: 'default-library', type: 'mac-library', x: 1, y: 1 }
];
