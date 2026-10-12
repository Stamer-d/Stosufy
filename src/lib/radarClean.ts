// Map tiles for the weather layers: shown only once they're loaded (never a broken image), and
// radar errors filtered out of the rain radar. Some radars now and then send interference or
// test signals: a whole disc of rings around the radar in heavy-rain colours, hundreds of
// kilometres wide. Real storms never cover a map tile that evenly with strong colours, so
// such tiles (and the edges of the disc in the tiles around them) are hidden.
//
// The tiles are looked at as the map loads them (no second download): each loaded radar tile
// gets its share of heavy rain, and tiles next to an error tile are checked again.

import { offscreenCanvas } from './canvas';

/** How much of a tile shows heavy rain (0–1), from its colours (RainViewer's scheme 2) */
function heavyShare(img: HTMLImageElement): number | null {
	try {
		const size = 64;
		const c = offscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
		c.drawImage(img, 0, 0, size, size);
		const px = c.getImageData(0, 0, size, size).data;
		let heavy = 0;
		for (let i = 0; i < px.length; i += 4) {
			// Orange to red: heavy rain, hail
			if (px[i + 3] > 80 && px[i] > 190 && px[i + 1] < 175 && px[i + 2] < 110) heavy++;
		}
		return heavy / (size * size);
	} catch {
		// The server doesn't allow reading its pictures: shown as they are
		return null;
	}
}

/** Heavy-rain shares of the radar tiles looked at, by layer and tile */
const shares = new Map<string, number>();
/** The radar tiles on the map now, by layer and tile */
const shown = new Map<string, HTMLImageElement>();

const tileKey = (layer: string, z: number, x: number, y: number) => `${layer}|${z}/${x}/${y}`;

/** A tile is an error: mostly heavy rain, or a lot of it next to such a tile */
function isError(layer: string, z: number, x: number, y: number) {
	const own = shares.get(tileKey(layer, z, x, y)) ?? 0;
	if (own > 0.3) return true;
	if (own < 0.08) return false;
	for (const dx of [-1, 0, 1])
		for (const dy of [-1, 0, 1])
			if ((dx || dy) && (shares.get(tileKey(layer, z, x + dx, y + dy)) ?? 0) > 0.3) return true;
	return false;
}

function judge(layer: string, z: number, x: number, y: number) {
	const img = shown.get(tileKey(layer, z, x, y));
	if (img?.dataset.loaded) img.style.visibility = isError(layer, z, x, y) ? 'hidden' : '';
}

/** Whether most of a radar layer's tiles on the map are there (loaded or failed) */
export function layerReady(layer: string) {
	let total = 0;
	let done = 0;
	for (const [key, img] of shown) {
		if (!key.startsWith(layer + '|')) continue;
		total++;
		if (img.dataset.loaded || img.dataset.failed) done++;
	}
	return total > 0 && done / total >= 0.85;
}

type Layer = { key: string; url: (z: number, x: number, y: number) => string; clean?: boolean };
type Tile = { x: number; y: number; z: number };

/** An action for a tile's img: its address, shown once loaded (and, for a layer that wants
 * it, not a radar error) */
export function radarSrc(img: HTMLImageElement, params: { layer: Layer; tile: Tile }) {
	let current = '';
	let registered = '';
	let anonymous = true;
	let state = params;
	const forget = () => {
		if (registered && shown.get(registered) === img) shown.delete(registered);
		registered = '';
	};
	img.style.visibility = 'hidden';
	img.decoding = 'async';
	img.addEventListener('load', () => {
		img.dataset.loaded = '1';
		const { layer, tile } = state;
		if (!layer.clean) {
			img.style.visibility = '';
			return;
		}
		const share = anonymous ? heavyShare(img) : null;
		if (share === null) {
			img.style.visibility = '';
			return;
		}
		shares.set(tileKey(layer.key, tile.z, tile.x, tile.y), share);
		if (shares.size > 5000) shares.delete(shares.keys().next().value!);
		judge(layer.key, tile.z, tile.x, tile.y);
		// A big error tile: its neighbours may be the disc's edges
		if (share > 0.3)
			for (const dx of [-1, 0, 1])
				for (const dy of [-1, 0, 1])
					if (dx || dy) judge(layer.key, tile.z, tile.x + dx, tile.y + dy);
	});
	img.addEventListener('error', () => {
		// Read-protected pictures still show, just not checked
		if (anonymous && state.layer.clean) {
			anonymous = false;
			img.removeAttribute('crossorigin');
			img.src = current;
			return;
		}
		img.dataset.failed = '1';
		img.style.visibility = 'hidden';
	});
	const set = (next: { layer: Layer; tile: Tile }) => {
		state = next;
		const { layer, tile } = next;
		const url = layer.url(tile.z, tile.x, tile.y);
		if (url === current) return;
		current = url;
		forget();
		delete img.dataset.loaded;
		delete img.dataset.failed;
		img.style.visibility = 'hidden';
		if (layer.clean) {
			registered = tileKey(layer.key, tile.z, tile.x, tile.y);
			shown.set(registered, img);
			if (anonymous) img.crossOrigin = 'anonymous';
		}
		img.src = url;
	};
	set(params);
	return { update: set, destroy: forget };
}
