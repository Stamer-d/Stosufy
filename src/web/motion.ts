// osu!'s triangles rising, as on the desktop, if wanted: on the phone they stand still unless
// turned on (moving all the time they keep the graphics chip busy at 120 frames a second: a
// warmer phone, a quicker battery). This phone's choice, not the account's.

import { writable } from 'svelte/store';

const KEY = 'stosufy-web-moving-triangles';

export const movingTriangles = writable(
	(() => {
		try {
			return localStorage.getItem(KEY) === '1';
		} catch {
			return false;
		}
	})()
);

if (typeof document !== 'undefined')
	movingTriangles.subscribe((on) => {
		document.documentElement.classList.toggle('moving-triangles', on);
		try {
			localStorage.setItem(KEY, on ? '1' : '0');
		} catch {
			// (as it was, next time)
		}
	});
