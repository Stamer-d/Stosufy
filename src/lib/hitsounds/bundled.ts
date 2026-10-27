// The hitsounds that come with Stosufy (the "- ez" skin's): what plays when no skin is
// chosen, in the desktop app and on the phone. By lowercase name without extension.

const urls = import.meta.glob('./samples/*.wav', {
	query: '?url',
	import: 'default',
	eager: true
}) as Record<string, string>;

export const BUNDLED_DIR = 'stosufy:bundled';

export const bundledSamples = new Map(
	Object.entries(urls).map(([file, url]) => [
		file
			.split('/')
			.pop()!
			.replace(/\.wav$/i, '')
			.toLowerCase(),
		url
	])
);

/** A bundled sample's bytes (the browser's fetch: they're files of the app itself) */
export async function bundledSample(url: string) {
	const response = await globalThis.fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.arrayBuffer();
}
