// A link that opens the downloader filled in with (a part of) a video, ready to be downloaded,
// from another app or a web page (a VOD analyzer, say):
//
//   stosufynew://download?url={url}&start={start}&end={end}&title={title}
//
//   url                 the video's link (YouTube's, or any other the downloader knows)
//   video               or only a YouTube video's id, instead of `url`
//   start, end          where the part starts and ends (s, "83.5")
//   startTime, endTime  the same as h:mm:ss ("1:02:03"), where start and end aren't given
//   title               the file's name (without its extension)
//
// Each value URL-encoded. Without a start and an end: all of it. Nothing here but reading it:
// what's done with it is in opened.ts and the page.

export const SCHEME = 'stosufynew';
const HOST = 'download';

export interface DownloadLink {
	url: string;
	/** s; null: from the start (or from where the video's link says) */
	start: number | null;
	/** s; null: to the end */
	end: number | null;
	/** The file's name; null: the video's title */
	title: string | null;
}

/** A YouTube video's id: 11 letters, digits, - and _ */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Longer is cut (the file's name is cut shorter still, see ytdlp.rs) */
const TITLE_LENGTH = 200;

/** Whether it's a download link at all (right or not) */
export function isDownloadLink(text: string | null | undefined): boolean {
	return hostOf(text) === HOST;
}

/** stosufynew://download?… → "download" (also stosufynew:download?… and …/download/?…) */
function hostOf(text: string | null | undefined): string | null {
	if (!text) return null;
	try {
		const address = new URL(text.trim());
		if (address.protocol.toLowerCase() !== `${SCHEME}:`) return null;
		return (address.host + address.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
	} catch {
		return null;
	}
}

/**
 * A time: seconds ("83", "83.5") or h:mm:ss ("1:02:03", "2:03", "1:02:03.250"); null for none,
 * NaN for one that isn't a time
 */
export function readTime(value: string | null | undefined): number | null {
	const text = value?.trim();
	if (!text) return null;
	if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(text)) return NaN;
	const parts = text.split(':').map(Number);
	// (minutes and seconds after a colon: under 60)
	if (parts.slice(1).some((part) => part >= 60)) return NaN;
	return parts.reduce((total, part) => total * 60 + part, 0);
}

/** A link to a page: http(s), nothing else (no file, no other protocol); a site without https:// gets it */
function readUrl(value: string | null): string | null {
	const text = value?.trim();
	if (!text) return null;
	const full = /^https?:\/\//i.test(text)
		? text
		: /^[\w-]+(\.[\w-]+)+(\/|$)/.test(text)
			? `https://${text}`
			: null;
	if (!full || full.length >= 4096 || /[\s\u0000-\u001f\u007f]/.test(full)) return null;
	try {
		const address = new URL(full);
		return address.protocol === 'https:' || address.protocol === 'http:' ? address.href : null;
	} catch {
		return null;
	}
}

/**
 * What a download link asks for; null if it isn't one (another stosufynew:// link, the login's,
 * an invite); an error (saying what's wrong) for a download link that can't be used
 */
export function parseDownloadLink(text: string | null | undefined): DownloadLink | null {
	if (!isDownloadLink(text)) return null;
	const params = new URL(text!.trim()).searchParams;

	const given = params.get('url');
	const id = params.get('video')?.trim() ?? '';
	let url = readUrl(given);
	if (given?.trim() && !url) throw new Error("Its video's link isn't a link to a page");
	if (!url && id) {
		if (!VIDEO_ID.test(id)) throw new Error("Its video isn't a YouTube video's id");
		url = `https://www.youtube.com/watch?v=${id}`;
	}
	if (!url) throw new Error('It says no video (url= or video=)');

	/** start (s), else startTime (h:mm:ss) */
	const time = (seconds: string, clock: string) => {
		const value = params.get(seconds)?.trim() ? params.get(seconds) : params.get(clock);
		const read = readTime(value);
		if (Number.isNaN(read)) throw new Error(`Its ${seconds} isn't a time: ${value}`);
		return read;
	};
	const start = time('start', 'startTime');
	const end = time('end', 'endTime');
	if (end !== null && end <= (start ?? 0)) throw new Error('Its part ends before it starts');

	const title = (params.get('title') ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH);
	return { url, start, end, title: title || null };
}
