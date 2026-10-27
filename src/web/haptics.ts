// A tick of the phone's vibration on what the finger does (a tab, play, like, a song swiped
// in, a row picked up), where the browser lets the page vibrate: Android. (iPhones don't let
// web pages vibrate; a workaround with a hidden switch didn't work there and cost time on
// every tap, so there's none.)

export type Haptic = 'light' | 'medium' | 'heavy';

const canVibrate =
	typeof navigator !== 'undefined' &&
	'vibrate' in navigator &&
	/android/i.test(navigator.userAgent);

export function haptic(kind: Haptic = 'light') {
	if (!canVibrate) return;
	try {
		navigator.vibrate(kind === 'light' ? 8 : kind === 'medium' ? 16 : 30);
	} catch {
		// (no vibration here)
	}
}
