// Logging out: friends see the user go offline, a listening session is left, and everything
// of the account on this device is forgotten (the login, the library kept for offline use,
// the queue, the listening history kept here). Downloaded songs and the device's settings
// stay. The app then starts over at the login, so nothing of the account is left in memory
// either.

import { get } from 'svelte/store';
import { load } from '@tauri-apps/plugin-store';
import { forgetLogin } from './auth';
import { goOffline } from './friends';
import { leaveSession } from './listen';
import { stopPlayback } from './audio';
import { flushMapData } from './data';
import { userSettings } from './user';
import { clearHistory, flushHistory } from './history';

export async function logout() {
	stopPlayback();
	leaveSession(false);
	// (the listening history goes up to the account first: it's back after the next login)
	await Promise.all([goOffline(), flushMapData(), flushHistory()]);
	await forgetLogin();
	await clearHistory();
	try {
		const library = await load('offline-library.json');
		await library.clear();
		await library.save();
		// The next account's settings come from its own sync, not from this one's
		const data = await load('userData.json');
		await data.set('user', { settings: get(userSettings).settings ?? {}, currentQueue: null });
		await data.delete('queueSongs');
		await data.delete('queuePosition');
		await data.save();
	} catch (error) {
		console.warn('Could not clear everything of the account:', error);
	}
	location.replace('/');
}
