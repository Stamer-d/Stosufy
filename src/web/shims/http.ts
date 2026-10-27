// Tauri's fetch in the web app: the browser's. osu! doesn't let web pages ask its API (no
// CORS), so those requests go through the Stosufy API, which passes them on with the user's
// token.

const OSU_API = 'https://osu.ppy.sh/api/v2/';
const THROUGH_STOSUFY = 'https://api.stamer-d.de/v2/stosufy/osu/';

const viaStosufy = (url: string) =>
	url.startsWith(OSU_API) ? THROUGH_STOSUFY + url.slice(OSU_API.length) : url;

export const fetch: typeof globalThis.fetch = (input, init) =>
	globalThis.fetch(
		typeof input === 'string' || input instanceof URL ? viaStosufy(String(input)) : input,
		init
	);

/** An osu! API request (e.g. `me`, `beatmapsets/search?q=…`), through the Stosufy API */
export const osuApi = (path: string, token: string) =>
	fetch(OSU_API + path, { headers: { Authorization: `Bearer ${token}` } });
