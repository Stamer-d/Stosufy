// A difficulty's .osu file (for the hitsounds and the Nightcore beat): from the Stosufy API,
// kept on the phone, also for the downloaded songs offline.

import { get } from 'svelte/store';
import { OSU_FILE_THROUGH_STOSUFY } from './shims/http';
import { offline } from '../lib/stores/network';

const CACHE = 'stosufy-osu-files';
const files = new Map<string, Promise<string | null>>();

export function osuFile(mapId: string | number): Promise<string | null> {
	const id = String(mapId);
	if (!(Number(id) > 0)) return Promise.resolve(null);
	if (!files.has(id)) {
		const url = OSU_FILE_THROUGH_STOSUFY + id;
		const promise = (async () => {
			const cache = await caches?.open(CACHE).catch(() => null);
			const kept = await cache?.match(url).catch(() => undefined);
			if (kept) return kept.text();
			if (get(offline)) return null;
			const response = await fetch(url);
			if (!response.ok) return null;
			const text = await response.text();
			if (!text.includes('[HitObjects]')) return null;
			await cache?.put(url, new Response(text)).catch(() => {});
			return text;
		})().catch(() => null);
		files.set(id, promise);
		// (a miss is asked again next time)
		promise.then((text) => text ?? files.delete(id));
	}
	return files.get(id)!;
}
