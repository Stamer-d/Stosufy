// Updates on a phone: the desktop updater doesn't exist there, so the app looks for a newer
// release with an APK and offers to download it.

import { writable } from 'svelte/store';
import { getVersion } from '@tauri-apps/api/app';

export const mobileUpdate = writable<{ version: string; url: string } | null>(null);

const newer = (a: string, b: string) => {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
	}
	return false;
};

export async function checkMobileUpdate() {
	try {
		const [current, response] = await Promise.all([
			getVersion(),
			fetch('https://api.github.com/repos/Stamer-d/Stosufy/releases/latest')
		]);
		if (!response.ok) return;
		const release = await response.json();
		const version = String(release.tag_name ?? '').replace(/^Stosufy-v|^v/, '');
		// The APK on Android, the IPA (for AltStore or Sideloadly) on an iPhone
		const ending = /iphone|ipad|ipod/i.test(navigator.userAgent) ? '.ipa' : '.apk';
		const file = release.assets?.find((asset: { name: string }) => asset.name.endsWith(ending));
		if (file && newer(version, current))
			mobileUpdate.set({ version, url: file.browser_download_url });
	} catch {
		// Offline or GitHub unreachable: next start
	}
}
