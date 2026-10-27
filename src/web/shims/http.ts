// Tauri's fetch in the web app: the browser's. osu! doesn't let web pages ask its API (no
// CORS) and LRCLIB turns browsers down, so those requests go through the Stosufy API, which
// passes them on (osu!'s with the user's token).

const OSU_API = 'https://osu.ppy.sh/api/v2/';
const THROUGH_STOSUFY = 'https://api.stamer-d.de/v2/stosufy/osu/';

// (LRCLIB turns browsers down: its lyrics come through the Stosufy API too)
const LRCLIB = 'https://lrclib.net/api/';
const LYRICS_THROUGH_STOSUFY = 'https://api.stamer-d.de/v2/stosufy/lyrics/';

// (and a difficulty's .osu file)
const OSU_FILE = /^https:\/\/osu\.ppy\.sh\/osu\/(\d+)$/;
export const OSU_FILE_THROUGH_STOSUFY = 'https://api.stamer-d.de/v2/stosufy/osufile/';

const viaStosufy = (url: string) =>
	url.startsWith(OSU_API)
		? THROUGH_STOSUFY + url.slice(OSU_API.length)
		: OSU_FILE.test(url)
			? OSU_FILE_THROUGH_STOSUFY + url.match(OSU_FILE)![1]
			: url.startsWith(LRCLIB)
				? LYRICS_THROUGH_STOSUFY + url.slice(LRCLIB.length)
				: url;
/** (the Stosufy API sends LRCLIB who asks: the request needs no headers of its own) */
const plain = (url: string, init?: RequestInit) =>
	url.startsWith(LRCLIB) && init?.headers ? { ...init, headers: undefined } : init;

export const fetch: typeof globalThis.fetch = (input, init) =>
	globalThis.fetch(
		typeof input === 'string' || input instanceof URL ? viaStosufy(String(input)) : input,
		// (a HEAD only asks whether there's a connection: the answer needn't be readable)
		init?.method === 'HEAD' ? { ...init, mode: 'no-cors' } : plain(String(input), init)
	);

/** An osu! API request (e.g. `me`, `beatmapsets/search?q=…`), through the Stosufy API */
export const osuApi = (path: string, token: string) =>
	fetch(OSU_API + path, { headers: { Authorization: `Bearer ${token}` } });
