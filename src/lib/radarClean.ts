// Radar errors filtered out of the rain radar. Some radars now and then send interference
// or test signals: a whole disc of rings around the radar in heavy-rain colours, hundreds of
// kilometres wide. Real storms never cover a map tile that evenly with strong colours, so
// such tiles (and the edges of the disc in the tiles around them) are left out.

import { fetch } from '@tauri-apps/plugin-http';

/** How much of a tile shows heavy rain (0–1), from its colours (RainViewer's scheme 2) */
const strength = new Map<string, Promise<number>>();
const cleaned = new Map<string, Promise<string>>();

async function heavyShare(url: string): Promise<number> {
	const response = await fetch(url);
	if (!response.ok) return 0;
	const bitmap = await createImageBitmap(await response.blob());
	const size = 64;
	const c = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
	c.drawImage(bitmap, 0, 0, size, size);
	const px = c.getImageData(0, 0, size, size).data;
	let heavy = 0;
	for (let i = 0; i < px.length; i += 4) {
		// Orange to red: heavy rain, hail
		if (px[i + 3] > 80 && px[i] > 190 && px[i + 1] < 175 && px[i + 2] < 110) heavy++;
	}
	return heavy / (size * size);
}

function shareOf(url: string) {
	if (!strength.has(url)) {
		if (strength.size > 6000) strength.delete(strength.keys().next().value!);
		strength.set(
			url,
			heavyShare(url).catch(() => 0)
		);
	}
	return strength.get(url)!;
}

/** A tile is an error: mostly heavy rain, or a lot of it next to such a tile */
async function isError(tile: (x: number, y: number) => string, x: number, y: number) {
	const own = await shareOf(tile(x, y));
	if (own > 0.3) return true;
	if (own < 0.08) return false;
	const around = await Promise.all(
		[-1, 0, 1].flatMap((dx) =>
			[-1, 0, 1].filter((dy) => dx || dy).map((dy) => shareOf(tile(x + dx, y + dy)))
		)
	);
	return around.some((share) => share > 0.3);
}

const EMPTY =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * The tile to show for a radar tile: itself, or nothing if it's a radar error. `tile` makes
 * the address of a tile of the same frame and zoom.
 */
export function cleanRadarTile(tile: (x: number, y: number) => string, x: number, y: number) {
	const url = tile(x, y);
	if (!cleaned.has(url)) {
		cleaned.set(
			url,
			isError(tile, x, y)
				.then((error) => (error ? EMPTY : url))
				.catch(() => url)
		);
		// Old frames go
		if (cleaned.size > 3000) {
			const first = cleaned.keys().next().value!;
			cleaned.delete(first);
			strength.delete(first);
		}
	}
	return cleaned.get(url)!;
}

type Layer = { url: (z: number, x: number, y: number) => string; clean?: boolean };
type Tile = { x: number; y: number; z: number };

/**
 * An action for a tile's img: its address right away; for a layer that wants it, checked for
 * radar errors meanwhile and hidden if it is one
 */
export function radarSrc(img: HTMLImageElement, params: { layer: Layer; tile: Tile }) {
	let current = '';
	const set = ({ layer, tile }: { layer: Layer; tile: Tile }) => {
		const key = layer.url(tile.z, tile.x, tile.y);
		if (key === current) return;
		current = key;
		img.classList.remove('invisible');
		img.src = key;
		if (!layer.clean) return;
		const count = 2 ** tile.z;
		cleanRadarTile(
			(x, y) =>
				layer.url(tile.z, ((x % count) + count) % count, Math.max(0, Math.min(count - 1, y))),
			tile.x,
			tile.y
		).then((src) => {
			if (current === key && src !== key) img.src = src;
		});
	};
	set(params);
	return { update: set };
}
