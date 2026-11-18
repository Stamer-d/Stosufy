// Download links opened (see link.ts): kept until the downloader's page takes the last one and
// fills itself in with it (it's opened for it, see addons/links.ts). One that's wrong is said so.

import { get, writable } from 'svelte/store';
import { showToast } from '../../stores/toast';
import { parseDownloadLink, type DownloadLink } from './link';

export interface OpenedLink extends DownloadLink {
	/** When it was opened (ms) */
	at: number;
}

/** The links not taken yet, the first first */
export const openedLinks = writable<OpenedLink[]>([]);

/**
 * Taken only this long after it was opened: a link opened while the downloader wasn't
 * installed isn't downloaded when it's installed some day
 */
const FRESH = 10 * 60 * 1000;
/** The same link again this soon: the same opening, told twice (at the start, say) */
const TWICE = 3000;
const last = { text: '', at: 0 };

/** A link opened: kept for the page if it's a download link; whether it is (and can be used) */
export function receive(text: string): boolean {
	let link: DownloadLink | null;
	try {
		link = parseDownloadLink(text);
	} catch (error) {
		showToast(
			`Can't download from that link: ${(error as Error)?.message ?? error}`,
			'icon-[mingcute--warning-line]',
			6000
		);
		return false;
	}
	if (!link) return false;
	const now = Date.now();
	if (text === last.text && now - last.at < TWICE) return true;
	last.text = text;
	last.at = now;
	openedLinks.update((all) => [...all, { ...link, at: now }]);
	return true;
}

/**
 * The link to fill the page in with: the last one opened (each fills in what the one before
 * did), unless it waited too long; the list emptied
 */
export function takeLink(): OpenedLink | null {
	const newest = get(openedLinks).at(-1) ?? null;
	openedLinks.set([]);
	return newest && Date.now() - newest.at < FRESH ? newest : null;
}
