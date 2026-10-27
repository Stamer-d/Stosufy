// A tick of the phone's vibration on what the finger does (a tab, play, like, a song swiped
// in, a row picked up). Android has navigator.vibrate; iPhones don't, but since iOS 18 a
// switch (<input type="checkbox" switch>) ticks the Taptic Engine when it's flipped, also
// from code while a tap is being handled.

let toggle: HTMLLabelElement | null = null;

function iosSwitch() {
	if (!toggle) {
		toggle = document.createElement('label');
		toggle.setAttribute('aria-hidden', 'true');
		toggle.style.cssText =
			'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.setAttribute('switch', '');
		input.tabIndex = -1;
		toggle.append(input);
		document.body.append(toggle);
	}
	return toggle;
}

export type Haptic = 'light' | 'medium' | 'heavy';

export function haptic(kind: Haptic = 'light') {
	if (typeof navigator === 'undefined') return;
	try {
		if ('vibrate' in navigator && /android/i.test(navigator.userAgent)) {
			navigator.vibrate(kind === 'light' ? 8 : kind === 'medium' ? 16 : 30);
			return;
		}
		iosSwitch().click();
	} catch {
		// (no vibration here)
	}
}
