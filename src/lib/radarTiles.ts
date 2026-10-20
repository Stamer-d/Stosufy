// The rain radar's tiles, kept as pictures in memory: loaded once (a few at a time, the
// frame shown first), drawn on a canvas, so the loop plays without flicker and a moved map
// draws at once. Tiles that are radar errors (interference or test signals: a whole disc of
// rings in heavy-rain colours around a radar) are left out.
//
// RainViewer answers about 500 tiles a minute per internet address and refuses the rest for
// the minute. So each picture is 512 pixels: the four map tiles one zoom higher at once (a
// quarter of the requests), they're asked for well within that limit (the frame shown first,
// with room kept for it), and one refused or lost is asked for again a bit later.

import { fetchWithin } from './fastFetch';
import { offscreenCanvas } from './canvas';

/** RainViewer's radar goes up to map zoom 7 (its pictures one zoom lower, at 512 pixels) */
export const RADAR_MAX_ZOOM = 7;

export interface RadarTile {
	/** The picture, or null: nothing there */
	bitmap: ImageBitmap | null;
	/** How much of each quarter shows heavy rain (0–1): top left, top right, bottom left, bottom right */
	heavy: number[];
	/** When it couldn't be loaded (ms): tried again a little later */
	failedAt?: number;
}

/** Where a map tile's radar is: a quarter of a picture one zoom lower */
export function radarPiece(host: string, path: string, z: number, x: number, y: number) {
	return {
		url: `${host}${path}/512/${z - 1}/${x >> 1}/${y >> 1}/2/1_1.png`,
		quarter: (x & 1) + 2 * (y & 1)
	};
}

const cache = new Map<string, RadarTile>();
// A picture is a megabyte in memory: about two views of the whole loop
const MAX_TILES = 320;
/** How many pictures the maps show now (they always stay) */
let inUse = 0;

/** The pictures a map shows now: kept, the ones not shown longest make room for new ones */
export function keepTiles(urls: Set<string>) {
	for (const url of urls) {
		const tile = cache.get(url);
		if (!tile) continue;
		cache.delete(url);
		cache.set(url, tile);
	}
	inUse = urls.size;
}

// --- Loading, within the limit ------------------------------------------------------------

const PARALLEL = 6;
/** At most this many a minute (RainViewer: 500) … */
const PER_MINUTE = 400;
/** … of which the frames not shown get this many: the rest stays for the one shown */
const PER_MINUTE_OTHERS = 300;
const MINUTE = 60 * 1000;

interface Job {
	url: string;
	/** The frame shown: before the others */
	urgent: boolean;
	/** Loaded even when no map asks for it any more */
	always: boolean;
	/** The maps that want it (each asks with its own) */
	wanters: Set<(url: string) => boolean>;
	tries: number;
	promise: Promise<RadarTile>;
	done: (tile: RadarTile) => void;
}
const jobs = new Map<string, Job>();
const waiting: Job[] = [];
let running = 0;
/** When the requests of the last minute started */
const started: number[] = [];
/** Refused for asking too much: nothing until then */
let restUntil = 0;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;

const SKIPPED: RadarTile = { bitmap: null, heavy: [0, 0, 0, 0] };
const wanted = (job: Job) => job.always || [...job.wanters].some((wants) => wants(job.url));

function finish(job: Job, tile: RadarTile) {
	jobs.delete(job.url);
	if (tile !== SKIPPED) {
		cache.set(job.url, tile);
		if (cache.size > Math.max(MAX_TILES, inUse + 20)) {
			const [oldest, old] = cache.entries().next().value!;
			old.bitmap?.close();
			cache.delete(oldest);
		}
	}
	job.done(tile);
}

function pump() {
	clearTimeout(pumpTimer);
	pumpTimer = undefined;
	// The ones no map wants any more (it moved on) aren't loaded
	for (let i = waiting.length - 1; i >= 0; i--)
		if (!wanted(waiting[i])) finish(waiting.splice(i, 1)[0], SKIPPED);
	while (running < PARALLEL && waiting.length) {
		const now = Date.now();
		while (started.length && started[0] <= now - MINUTE) started.shift();
		let next = waiting.findIndex((job) => job.urgent);
		if (next < 0 && started.length < PER_MINUTE_OTHERS) next = 0;
		const wait = Math.max(
			restUntil - now,
			started.length >= PER_MINUTE || next < 0 ? started[0] + MINUTE - now : 0
		);
		if (wait > 0) {
			pumpTimer = setTimeout(pump, wait + 20);
			return;
		}
		const [job] = waiting.splice(next, 1);
		running++;
		started.push(now);
		fetchTile(job.url).then((result) => {
			running--;
			if (typeof result !== 'string') finish(job, result);
			else if (++job.tries > (result === 'busy' ? 6 : 3))
				finish(job, { ...SKIPPED, failedAt: Date.now() });
			else if (result === 'busy') {
				// Asked too much: a break for all, then this one first again
				restUntil = Math.max(restUntil, Date.now() + 15000);
				waiting.unshift(job);
			} else
				setTimeout(
					() => {
						waiting.push(job);
						pump();
					},
					2000 * 2 ** job.tries
				);
			pump();
		});
	}
}

/** How much of each quarter of a picture shows heavy rain (RainViewer's scheme 2: orange to red) */
function heavyShares(bitmap: ImageBitmap) {
	const size = 128;
	const half = size / 2;
	const c = offscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
	c.drawImage(bitmap, 0, 0, size, size);
	const px = c.getImageData(0, 0, size, size).data;
	const heavy = [0, 0, 0, 0];
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			if (px[i + 3] > 80 && px[i] > 190 && px[i + 1] < 175 && px[i + 2] < 110)
				heavy[(x < half ? 0 : 1) + (y < half ? 0 : 2)]++;
		}
	return heavy.map((count) => count / (half * half));
}

/** A picture, or why not: 'busy' (too many requests), 'failed' (an error, no answer) */
async function fetchTile(url: string): Promise<RadarTile | 'busy' | 'failed'> {
	try {
		return await fetchWithin(url, 15000, async (response) => {
			// Not there (404): nothing to show
			if (response.status === 404) return { bitmap: null, heavy: [0, 0, 0, 0] };
			if (response.status === 429) return 'busy';
			if (!response.ok) return 'failed';
			const bitmap = await createImageBitmap(await response.blob());
			return { bitmap, heavy: heavyShares(bitmap) };
		});
	} catch {
		return 'failed';
	}
}

/** A picture that's here already (or undefined; one that failed counts as not here) */
export const tileNow = (url: string) => {
	const tile = cache.get(url);
	return tile?.failedAt ? undefined : tile;
};

/** A map tile's radar that's here already: its picture and which quarter of it */
export function pieceNow(host: string, path: string, z: number, x: number, y: number) {
	const piece = radarPiece(host, path, z, x, y);
	const tile = tileNow(piece.url);
	return tile ? { tile, quarter: piece.quarter } : null;
}

/**
 * Loads a picture (once); urgent ones (the frame shown) go first, and one that no map wants
 * any more when its turn comes (`wanted` of each map that asked says no) isn't loaded
 */
export function loadTile(
	url: string,
	urgent = false,
	wants?: (url: string) => boolean
): Promise<RadarTile> {
	const done = cache.get(url);
	if (done && !(done.failedAt && Date.now() - done.failedAt > MINUTE)) return Promise.resolve(done);
	if (done) cache.delete(url);
	let job = jobs.get(url);
	if (!job) {
		let resolve!: (tile: RadarTile) => void;
		const promise = new Promise<RadarTile>((r) => (resolve = r));
		job = { url, urgent, always: false, wanters: new Set(), tries: 0, promise, done: resolve };
		jobs.set(url, job);
		waiting.push(job);
	}
	// Whether it's the frame shown changes as the loop plays: the latest ask says
	job.urgent = urgent;
	if (wants) job.wanters.add(wants);
	else job.always = true;
	pump();
	return job.promise;
}

/** How much heavy rain a map tile's radar shows (0 where it isn't here) */
function heavyAt(host: string, path: string, z: number, x: number, y: number) {
	const count = 2 ** z;
	if (y < 0 || y >= count) return 0;
	const piece = pieceNow(host, path, z, ((x % count) + count) % count, y);
	return piece ? piece.tile.heavy[piece.quarter] : 0;
}

/**
 * Whether a map tile's radar is a radar error: mostly heavy rain, or a lot of it next to
 * such a tile
 */
export function isRadarError(host: string, path: string, z: number, x: number, y: number) {
	const own = heavyAt(host, path, z, x, y);
	if (own > 0.3) return true;
	if (own < 0.08) return false;
	for (const dx of [-1, 0, 1])
		for (const dy of [-1, 0, 1])
			if ((dx || dy) && heavyAt(host, path, z, x + dx, y + dy) > 0.3) return true;
	return false;
}
