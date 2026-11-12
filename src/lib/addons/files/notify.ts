// "It's done", as a notification of the system: when the app isn't what's being looked at
// (the converter's files done while the user is elsewhere).

import {
	isPermissionGranted,
	requestPermission,
	sendNotification
} from '@tauri-apps/plugin-notification';

export async function notifyDone(title: string, body: string) {
	if (typeof document !== 'undefined' && document.hasFocus()) return;
	try {
		let allowed = await isPermissionGranted();
		if (!allowed) allowed = (await requestPermission()) === 'granted';
		if (allowed) sendNotification({ title, body });
	} catch (error) {
		console.warn('Could not notify:', error);
	}
}
