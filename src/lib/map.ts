// Web map math (the tiles of OpenStreetMap-style maps): where a place is on the map, in
// pixels of the whole world at a zoom level.

export const TILE = 256;

/** A place in pixels of the whole world at a zoom level */
export function worldPixel(lat: number, lon: number, zoom: number) {
	const size = TILE * 2 ** zoom;
	const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
	return {
		x: ((lon + 180) / 360) * size,
		y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
	};
}

/** The tiles that cover a view of a size around a place, and where each one goes */
export function tilesAround(lat: number, lon: number, zoom: number, width: number, height: number) {
	const center = worldPixel(lat, lon, zoom);
	const left = center.x - width / 2;
	const top = center.y - height / 2;
	const count = 2 ** zoom;
	const tiles: { x: number; y: number; z: number; left: number; top: number; key: string }[] = [];
	for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
		if (ty < 0 || ty >= count) continue;
		for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
			const x = ((tx % count) + count) % count;
			tiles.push({
				x,
				y: ty,
				z: zoom,
				left: tx * TILE - left,
				top: ty * TILE - top,
				key: `${tx}/${ty}`
			});
		}
	}
	return tiles;
}

/** Where a place shows in a view around another (pixels from its top left) */
export function inView(
	lat: number,
	lon: number,
	center: { lat: number; lon: number },
	zoom: number,
	width: number,
	height: number
) {
	const c = worldPixel(center.lat, center.lon, zoom);
	const p = worldPixel(lat, lon, zoom);
	return { x: p.x - c.x + width / 2, y: p.y - c.y + height / 2 };
}

/** Kilometres between two places */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 12742 * Math.asin(Math.sqrt(h));
}

/** The place at pixels of the whole world at a zoom level */
export function fromWorldPixel(x: number, y: number, zoom: number) {
	const size = TILE * 2 ** zoom;
	const lon = (x / size) * 360 - 180;
	const n = Math.PI - (2 * Math.PI * y) / size;
	const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
	return { lat, lon };
}

/** A tile's corners in web mercator metres (for WMS maps) */
export function tileBounds(x: number, y: number, z: number) {
	const half = 20037508.342789244;
	const span = (2 * half) / 2 ** z;
	return {
		minX: -half + x * span,
		maxX: -half + (x + 1) * span,
		maxY: half - y * span,
		minY: half - (y + 1) * span
	};
}
