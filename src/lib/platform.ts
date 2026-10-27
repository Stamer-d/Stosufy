// Where the app runs: a computer, or a phone (iOS through SideStore), where some of what a
// computer has isn't there (global shortcuts, the updater, Discord, the osu! folder)

import * as path from '@tauri-apps/api/path';

/** Whether the app runs on a phone or tablet (an iPad's web view says it's a Mac: touch tells) */
export const isMobile =
	typeof navigator !== 'undefined' &&
	(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
		(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/**
 * The folder the app's own folder ("Stosufy") is in: the home folder, on a phone the app's
 * Documents (the home folder itself can't be written there)
 */
export const filesRoot = () => (isMobile ? path.documentDir() : path.homeDir());

/**
 * A saved path of the app's own files, where they are now: on iOS the app's folder moves with
 * each update (its path has an id in it), so a path saved before points nowhere
 */
export function relocated(saved: string | null | undefined, root: string) {
	if (!isMobile || !saved) return saved;
	const at = saved.indexOf('/Stosufy/');
	return at < 0 ? saved : root + saved.slice(at);
}
