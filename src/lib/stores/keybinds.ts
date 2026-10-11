// Keyboard shortcuts: each action has a shortcut inside the app and one that works
// everywhere (a global shortcut, e.g. the media keys). Both can be changed in the settings.

import { derived, get, writable } from 'svelte/store';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { userSettings, updateUserSettings } from './user';
import { setVolume, toggleMute, DEFAULT_VOLUME } from './mixer';
import { goto } from '$app/navigation';
import {
	togglePlayback,
	skipForward,
	skipBackward,
	songQueue,
	shuffleQueue,
	cycleRepeatMode,
	focusMode,
	queuePanelOpen
} from './audio';

export type KeybindAction =
	| 'playPause'
	| 'next'
	| 'previous'
	| 'seekForward'
	| 'seekBackward'
	| 'volumeUp'
	| 'volumeDown'
	| 'mute'
	| 'shuffle'
	| 'repeat'
	| 'search'
	| 'queue'
	| 'focusMode'
	| 'lyrics';

export type KeybindScope = 'app' | 'global';

/** A shortcut like "Ctrl+Shift+KeyP" (modifiers, then the key's code), or null for none */
export type Keybind = string | null;

export const KEYBIND_ACTIONS: { id: KeybindAction; label: string; group: string }[] = [
	{ id: 'playPause', label: 'Play / pause', group: 'Playback' },
	{ id: 'next', label: 'Next song', group: 'Playback' },
	{ id: 'previous', label: 'Previous song', group: 'Playback' },
	{ id: 'seekForward', label: 'Forward 5 seconds', group: 'Playback' },
	{ id: 'seekBackward', label: 'Back 5 seconds', group: 'Playback' },
	{ id: 'shuffle', label: 'Shuffle', group: 'Playback' },
	{ id: 'repeat', label: 'Repeat', group: 'Playback' },
	{ id: 'volumeUp', label: 'Volume up', group: 'Volume' },
	{ id: 'volumeDown', label: 'Volume down', group: 'Volume' },
	{ id: 'mute', label: 'Mute', group: 'Volume' },
	{ id: 'search', label: 'Search', group: 'App' },
	{ id: 'queue', label: 'Show queue', group: 'App' },
	{ id: 'lyrics', label: 'Lyrics', group: 'App' },
	{ id: 'focusMode', label: 'Focus mode', group: 'App' }
];

export const DEFAULT_KEYBINDS: Record<KeybindScope, Record<KeybindAction, Keybind>> = {
	app: {
		playPause: 'Space',
		next: 'Ctrl+ArrowRight',
		previous: 'Ctrl+ArrowLeft',
		seekForward: 'Shift+ArrowRight',
		seekBackward: 'Shift+ArrowLeft',
		volumeUp: 'Ctrl+ArrowUp',
		volumeDown: 'Ctrl+ArrowDown',
		mute: 'KeyM',
		shuffle: 'Ctrl+KeyS',
		repeat: 'Ctrl+KeyR',
		search: 'Ctrl+KeyK',
		queue: 'KeyQ',
		focusMode: 'KeyF',
		lyrics: 'KeyL'
	},
	global: {
		playPause: 'MediaPlayPause',
		next: 'MediaTrackNext',
		previous: 'MediaTrackPrevious',
		seekForward: null,
		seekBackward: null,
		volumeUp: 'F14',
		volumeDown: 'F13',
		mute: null,
		shuffle: null,
		repeat: null,
		search: null,
		queue: null,
		focusMode: null,
		lyrics: null
	}
};

/** The shortcuts in use: the defaults with the user's changes */
export function keybinds(): Record<KeybindScope, Record<KeybindAction, Keybind>> {
	const changed = get(userSettings).settings?.keybinds;
	return {
		app: { ...DEFAULT_KEYBINDS.app, ...changed?.app },
		global: { ...DEFAULT_KEYBINDS.global, ...changed?.global }
	};
}

/** The shortcuts in use, as a store */
export const currentKeybinds = derived(userSettings, () => keybinds());

/**
 * Sets a shortcut. Another action with the same shortcut in the same scope loses it;
 * returns that action, if any.
 */
export function setKeybind(scope: KeybindScope, action: KeybindAction, bind: Keybind) {
	const current = keybinds()[scope];
	const taken = bind
		? (Object.keys(current) as KeybindAction[]).find(
				(other) => other !== action && current[other] === bind
			)
		: undefined;
	const changed = { ...get(userSettings).settings?.keybinds?.[scope], [action]: bind };
	if (taken) changed[taken] = null;
	updateUserSettings({
		keybinds: { ...get(userSettings).settings?.keybinds, [scope]: changed }
	});
	return taken ?? null;
}

export function resetKeybinds() {
	updateUserSettings({ keybinds: undefined });
}

// --- Reading and showing shortcuts ------------------------------------------------------

const MODIFIER_CODES = ['Control', 'Shift', 'Alt', 'Meta', 'OS'];

/** The shortcut of a key press, or null for a modifier alone */
export function keybindFromEvent(event: KeyboardEvent): Keybind {
	if (!event.code || MODIFIER_CODES.some((m) => event.code.startsWith(m))) return null;
	const parts = [];
	if (event.ctrlKey) parts.push('Ctrl');
	if (event.altKey) parts.push('Alt');
	if (event.shiftKey) parts.push('Shift');
	if (event.metaKey) parts.push('Super');
	parts.push(event.code);
	return parts.join('+');
}

const KEY_NAMES: Record<string, string> = {
	ArrowRight: '→',
	ArrowLeft: '←',
	ArrowUp: '↑',
	ArrowDown: '↓',
	Space: 'Space',
	MediaPlayPause: 'Play/Pause key',
	MediaTrackNext: 'Next key',
	MediaTrackPrevious: 'Previous key',
	MediaStop: 'Stop key',
	AudioVolumeUp: 'Volume up key',
	AudioVolumeDown: 'Volume down key',
	AudioVolumeMute: 'Mute key',
	Super: 'Win'
};

/** The parts of a shortcut as shown to the user, e.g. ["Ctrl", "K"] */
export function keybindLabel(bind: Keybind): string[] {
	if (!bind) return [];
	return bind.split('+').map((part) => {
		if (KEY_NAMES[part]) return KEY_NAMES[part];
		if (/^Key[A-Z]$/.test(part)) return part.slice(3);
		if (/^Digit\d$/.test(part)) return part.slice(5);
		if (/^Numpad/.test(part)) return 'Num ' + part.slice(6);
		return part;
	});
}

// --- Doing the actions --------------------------------------------------------------

const VOLUME_STEP = 0.01;

type Handler = () => void | Promise<void>;

function seek(seconds: number) {
	const audio = get(songQueue).audio;
	if (!audio) return;
	audio.currentTime = Math.max(
		0,
		Math.min(audio.duration || Infinity, audio.currentTime + seconds)
	);
}

function changeVolume(step: number) {
	const settings = get(userSettings).settings;
	// Louder while muted continues from the volume before muting
	const volume = settings?.muted && step < 0 ? 0 : (settings?.volume ?? DEFAULT_VOLUME);
	// Down stops just above 0: muting is its own shortcut
	setVolume(Math.max(step < 0 ? 0.001 : 0, volume + step));
}

const ACTIONS: Record<KeybindAction, Handler> = {
	playPause: () => {
		if (get(songQueue).audio) togglePlayback();
	},
	next: () => skipForward(),
	previous: () => skipBackward(),
	seekForward: () => seek(5),
	seekBackward: () => seek(-5),
	volumeUp: () => changeVolume(VOLUME_STEP),
	volumeDown: () => changeVolume(-VOLUME_STEP),
	mute: () => toggleMute(),
	shuffle: async () => {
		if (get(songQueue).type !== 'playlist') return;
		updateUserSettings({ shuffle: !get(userSettings).settings?.shuffle });
		await shuffleQueue();
	},
	repeat: () => cycleRepeatMode(),
	search: () => {
		const input = document.querySelector<HTMLInputElement>('[data-search-input]');
		input?.focus();
		input?.select();
	},
	queue: () => queuePanelOpen.update((open) => !open),
	lyrics: () => toggleLyrics(),
	focusMode: () => {
		if (get(songQueue).audio) focusMode.update((on) => !on);
	}
};

/** Opens the lyrics page, or goes back from it */
export function toggleLyrics() {
	if (location.pathname === '/lyrics') history.back();
	else goto('/lyrics');
}

export function runKeybind(action: KeybindAction) {
	return ACTIONS[action]();
}

// --- Listening ----------------------------------------------------------------------

/** While a shortcut is being recorded in the settings, no shortcut does anything */
export const recordingKeybind = writable(false);

let registered: string[] = [];

/** Turns a shortcut into what the global shortcut plugin understands */
function accelerator(bind: string) {
	return bind
		.split('+')
		.map((part) => part.replace(/^Key([A-Z])$/, '$1').replace(/^Digit(\d)$/, '$1'))
		.join('+');
}

/** The global shortcuts that couldn't be set, e.g. because another app uses them */
export const keybindErrors = writable<Partial<Record<KeybindAction, string>>>({});

async function registerGlobal() {
	const wanted = get(recordingKeybind) ? {} : keybinds().global;
	for (const shortcut of registered) await unregister(shortcut).catch(() => {});
	registered = [];
	const errors: Partial<Record<KeybindAction, string>> = {};
	for (const [action, bind] of Object.entries(wanted) as [KeybindAction, Keybind][]) {
		if (!bind) continue;
		const shortcut = accelerator(bind);
		try {
			await register(shortcut, (event) => {
				if (event.state === 'Pressed') runKeybind(action);
			});
			registered.push(shortcut);
		} catch (error) {
			errors[action] = String(error);
		}
	}
	keybindErrors.set(errors);
}

function onKeydown(event: KeyboardEvent) {
	if (get(recordingKeybind)) return;
	const bind = keybindFromEvent(event);
	if (!bind) return;
	// The global shortcut already reacts to it
	if (registered.includes(accelerator(bind))) return;
	const action = (Object.entries(keybinds().app) as [KeybindAction, Keybind][]).find(
		([, value]) => value === bind
	)?.[0];
	if (!action) return;
	// While typing, only shortcuts with Ctrl or Alt count
	const target = event.target;
	const typing =
		target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]');
	if (typing && !event.ctrlKey && !event.altKey && !event.metaKey) return;
	if (event.repeat && !['volumeUp', 'volumeDown', 'seekForward', 'seekBackward'].includes(action)) {
		event.preventDefault();
		return;
	}
	event.preventDefault();
	runKeybind(action);
}

let started = false;

/** Starts listening for the shortcuts; again whenever they change */
export function startKeybinds() {
	if (started || typeof window === 'undefined') return;
	started = true;
	window.addEventListener('keydown', onKeydown);
	let last = '';
	const update = () => {
		const key = JSON.stringify([keybinds().global, get(recordingKeybind)]);
		if (key === last) return;
		last = key;
		registerGlobal();
	};
	userSettings.subscribe(update);
	recordingKeybind.subscribe(update);
}
