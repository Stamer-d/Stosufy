// The rain radar's tiles, kept as pictures in memory: loaded once (a few at a time, the
// newest frame first), drawn on a canvas, so the loop plays without flicker and a moved map
// draws at once. Tiles that are radar errors (interference or test signals: a whole disc of
// rings in heavy-rain colours around a radar) are left out.

import { fastFetch } from './fastFetch';
import { offscreenCanvas } from './canvas';

export interface RadarTile {
	/** The picture, or null: not there, or a radar error */
	bitmap: ImageBitmap | null;
	/** How much of it shows heavy rain (0–1) */
	heavy: number;
	/** When it couldn't be loaded (ms): tried again a little later */
	failedAt?: number;
}

const cache = new Map<string, RadarTile>();
const loading = new Map<string, Promise<RadarTile>>();
const MAX_TILES = 900;

// A few at a time (the server limits how many)
const PARALLEL = 6;
let running = 0;
const waiting: { run: () => void; urgent: boolean }[] = [];
function inTurn<T>(task: () => Promise<T>, urgent: boolean): Promise<T> {
	return new Promise((resolve, reject) => {
		const run = () => {
			running++;
			task()
				.then(resolve, reject)
				.finally(() => {
					running--;
					const next = waiting.findIndex((w) => w.urgent);
					const item = next >= 0 ? waiting.splice(next, 1)[0] : waiting.shift();
					item?.run();
				});
		};
		if (running < PARALLEL) run();
		else waiting.push({ run, urgent });
	});
}

/** How much of a picture shows heavy rain (RainViewer's colour scheme 2: orange to red) */
function heavyShare(bitmap: ImageBitmap) {
	const size = 64;
	const c = offscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
	c.drawImage(bitmap, 0, 0, size, size);
	const px = c.getImageData(0, 0, size, size).data;
	let heavy = 0;
	for (let i = 0; i < px.length; i += 4)
		if (px[i + 3] > 80 && px[i] > 190 && px[i + 1] < 175 && px[i + 2] < 110) heavy++;
	return heavy / (size * size);
}

async function fetchTile(url: string): Promise<RadarTile> {
	try {
		const response = await fastFetch(url);
		// Not there (404): nothing to show; anything else (too many requests…): again later
		if (response.status === 404) return { bitmap: null, heavy: 0 };
		if (!response.ok) return { bitmap: null, heavy: 0, failedAt: Date.now() };
		const bitmap = await createImageBitmap(await response.blob());
		return { bitmap, heavy: heavyShare(bitmap) };
	} catch {
		return { bitmap: null, heavy: 0, failedAt: Date.now() };
	}
}

/** A tile that's here already (or undefined; one that failed counts as not here) */
export const tileNow = (url: string) => {
	const tile = cache.get(url);
	return tile?.failedAt ? undefined : tile;
};

const SKIPPED: RadarTile = { bitmap: null, heavy: 0 };

/**
 * Loads a tile (once); urgent ones (the frame shown) go first, and one no longer wanted
 * when its turn comes (the map moved on) isn't loaded
 */
export function loadTile(url: string, urgent = false, wanted?: () => boolean): Promise<RadarTile> {
	const done = cache.get(url);
	if (done && !(done.failedAt && Date.now() - done.failedAt > 20000)) return Promise.resolve(done);
	if (done) cache.delete(url);
	let pending = loading.get(url);
	if (!pending) {
		pending = inTurn(
			() => (wanted && !wanted() ? Promise.resolve(SKIPPED) : fetchTile(url)),
			urgent
		).then((tile) => {
			loading.delete(url);
			if (tile === SKIPPED) return tile;
			cache.set(url, tile);
			if (cache.size > MAX_TILES) {
				const [oldest, old] = cache.entries().next().value!;
				old.bitmap?.close();
				cache.delete(oldest);
			}
			return tile;
		});
		loading.set(url, pending);
	}
	return pending;
}

/**
 * Whether a tile is a radar error: mostly heavy rain, or a lot of it next to such a tile
 * (`near` gives the tiles around it, those that are here)
 */
export function isRadarError(tile: RadarTile, near: (RadarTile | undefined)[]) {
	if (tile.heavy > 0.3) return true;
	if (tile.heavy < 0.08) return false;
	return near.some((n) => (n?.heavy ?? 0) > 0.3);
}
