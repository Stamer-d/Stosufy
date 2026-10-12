// Which device the app runs on: the desktop (Windows) or a phone (Android). The phone has
// no window to move, no global shortcuts, no Discord and no updater, keeps its files in the
// app's own folder, and gets the touch layout.

import { BaseDirectory } from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';

export const isMobile =
	typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

export const isDesktop = !isMobile;

/**
 * The base directory for file calls. The paths are absolute anyway; on a phone the home
 * directory can't be resolved, so the app's own data folder is named instead.
 */
export const HOME_BASE = isMobile ? BaseDirectory.AppLocalData : BaseDirectory.Home;

let root: Promise<string> | null = null;

/** Stosufy's folder: ~/Stosufy on the desktop, in the app's data on a phone */
export function stosufyDir() {
	root ??= (async () =>
		path.join(isMobile ? await path.appLocalDataDir() : await path.homeDir(), 'Stosufy'))();
	return root;
}
