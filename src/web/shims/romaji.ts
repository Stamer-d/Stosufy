// Romaji in the web app: the Stosufy API makes it. The desktop app reads kanji with
// kuromoji's dictionary (18 MB to download, ~100 MB in memory), too much for a phone: iOS
// closes an app that big in the background, and the music stops. The server does the same
// conversion and sends the lines back as text. Songs converted once stay here while the
// app is open.

const ROMAJI = 'https://api.stamer-d.de/v2/stosufy/romaji';
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
/** Lyrics kept in romaji (the newest last) */
const KEPT = 30;

const kept = new Map<string, Promise<string[]>>();

export function hasJapanese(text: string | null | undefined) {
	return !!text && JAPANESE.test(text);
}

async function ask(lines: string[]) {
	const response = await fetch(ROMAJI, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ lines })
	});
	const data = await response.json().catch(() => null);
	if (!response.ok || !Array.isArray(data?.lines) || data.lines.length !== lines.length)
		throw new Error(data?.error ?? `The romaji answered ${response.status}`);
	return data.lines as string[];
}

/** The lines in romaji; lines without Japanese stay as they are */
export async function romanize(lines: string[]): Promise<string[]> {
	if (!lines.some(hasJapanese)) return lines;
	const key = lines.join('\n');
	let romaji = kept.get(key);
	if (!romaji) {
		romaji = ask(lines);
		// (a failed one is asked again next time)
		romaji.catch(() => kept.delete(key));
		kept.set(key, romaji);
		if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
	}
	return romaji;
}
