// Drawing the weather grid on the map: smooth (its points joined by curves, not straight
// lines), between the hours as time moves on, coloured from a table. The map's projection
// (web mercator) keeps a place's longitude to its column on the screen and its latitude to its
// row, so where each pixel is on the grid is worked out once per row and column, not per pixel.
// Also the pressure's lines (isobars) with the highs and lows, and the values of a place.

import { colourAt, type WeatherGrid, type Stops } from './weather';
import { worldPixel, fromWorldPixel, TILE } from './map';

export interface MapView {
	lat: number;
	lon: number;
	zoom: number;
	width: number;
	height: number;
}

/** A grid's values of a name at a time (between its hours), row by row */
export function valuesAt(grid: WeatherGrid, key: string, time: number): Float32Array | null {
	const all = grid.values[key];
	if (!all || !grid.times.length) return null;
	const count = grid.columns * grid.rows;
	const last = grid.times.length - 1;
	const f = Math.max(0, Math.min(last, (time - grid.times[0]) / 3600e3));
	const i = Math.floor(f);
	const t = f - i;
	const a = i * count;
	const b = Math.min(last, i + 1) * count;
	const out = new Float32Array(count);
	for (let p = 0; p < count; p++) out[p] = all[a + p] + (all[b + p] - all[a + p]) * t;
	return out;
}

/** Catmull-Rom: the curve through four values, between the middle two */
function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
	return (
		p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
	);
}

export interface Raster {
	data: Float32Array;
	columns: number;
	rows: number;
	/** How many of its points to one of the grid's */
	factor: number;
}

/** Values made finer (factor points to one each way), joined smoothly */
export function smooth(
	values: Float32Array,
	columns: number,
	rows: number,
	factor: number
): Raster {
	const fc = (columns - 1) * factor + 1;
	const fr = (rows - 1) * factor + 1;
	const wide = new Float32Array(fc * rows);
	for (let r = 0; r < rows; r++) {
		const row = r * columns;
		for (let x = 0; x < fc; x++) {
			const g = x / factor;
			const c = Math.min(columns - 2, Math.floor(g));
			wide[r * fc + x] = cubic(
				values[row + Math.max(0, c - 1)],
				values[row + c],
				values[row + c + 1],
				values[row + Math.min(columns - 1, c + 2)],
				g - c
			);
		}
	}
	const data = new Float32Array(fc * fr);
	for (let y = 0; y < fr; y++) {
		const g = y / factor;
		const r = Math.min(rows - 2, Math.floor(g));
		const t = g - r;
		const r0 = Math.max(0, r - 1) * fc;
		const r1 = r * fc;
		const r2 = (r + 1) * fc;
		const r3 = Math.min(rows - 1, r + 2) * fc;
		for (let x = 0; x < fc; x++)
			data[y * fc + x] = cubic(wide[r0 + x], wide[r1 + x], wide[r2 + x], wide[r3 + x], t);
	}
	return { data, columns: fc, rows: fr, factor };
}

/** A value between the points of values (gx, gy: where on the grid, in its columns and rows) */
export function valueAt(
	values: Float32Array,
	columns: number,
	rows: number,
	gx: number,
	gy: number
) {
	const c = Math.max(0, Math.min(columns - 2, Math.floor(gx)));
	const r = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
	const tx = gx - c;
	const ty = gy - r;
	const row = (k: number) => {
		const at = Math.max(0, Math.min(rows - 1, k)) * columns;
		return cubic(
			values[at + Math.max(0, c - 1)],
			values[at + c],
			values[at + c + 1],
			values[at + Math.min(columns - 1, c + 2)],
			tx
		);
	};
	return cubic(row(r - 1), row(r), row(r + 1), row(r + 2), ty);
}

/** Where a place is on a grid (in its columns and rows), or null off it */
export function onGrid(grid: WeatherGrid, lat: number, lon: number) {
	const gy = (grid.north - lat) / grid.latStep;
	if (gy < 0 || gy > grid.rows - 1) return null;
	// The world repeats east and west
	for (const shift of [0, -360, 360]) {
		const gx = (lon + shift - grid.west) / grid.step;
		if (gx >= 0 && gx <= grid.columns - 1) return { gx, gy };
	}
	return null;
}

/**
 * Where the screen's columns and rows (each `scale` pixels) are on a grid, in a raster's points
 * (factor to one of the grid's), −1 where off it
 */
export function screenOnGrid(grid: WeatherGrid, view: MapView, scale: number, factor = 1) {
	const centre = worldPixel(view.lat, view.lon, view.zoom);
	const world = TILE * 2 ** view.zoom;
	const width = Math.ceil(view.width / scale);
	const height = Math.ceil(view.height / scale);
	const columns = new Float32Array(width);
	const rows = new Float32Array(height);
	for (let sx = 0; sx < width; sx++) {
		const lon = ((centre.x - view.width / 2 + (sx + 0.5) * scale) / world) * 360 - 180;
		let at = -1;
		for (const shift of [0, -360, 360]) {
			const gx = (lon + shift - grid.west) / grid.step;
			if (gx >= 0 && gx <= grid.columns - 1) {
				at = gx * factor;
				break;
			}
		}
		columns[sx] = at;
	}
	for (let sy = 0; sy < height; sy++) {
		const { lat } = fromWorldPixel(0, centre.y - view.height / 2 + (sy + 0.5) * scale, view.zoom);
		const gy = (grid.north - lat) / grid.latStep;
		rows[sy] = gy >= 0 && gy <= grid.rows - 1 ? gy * factor : -1;
	}
	return { columns, rows, width, height };
}

/** Where a raster's columns and rows are on the screen (the inverse of screenOnGrid) */
export function gridOnScreen(grid: WeatherGrid, view: MapView, raster: Raster) {
	const centre = worldPixel(view.lat, view.lon, view.zoom);
	const world = TILE * 2 ** view.zoom;
	const left = centre.x - view.width / 2;
	const top = centre.y - view.height / 2;
	// The copy of the world nearest the view
	const middle = (grid.west + grid.east) / 2;
	const viewLon = (centre.x / world) * 360 - 180;
	const shift = Math.round((viewLon - middle) / 360) * 360;
	const xs = new Float32Array(raster.columns);
	const ys = new Float32Array(raster.rows);
	for (let x = 0; x < raster.columns; x++) {
		const lon = grid.west + shift + (x / raster.factor) * grid.step;
		xs[x] = ((lon + 180) / 360) * world - left;
	}
	for (let y = 0; y < raster.rows; y++) {
		const lat = grid.north - (y / raster.factor) * grid.latStep;
		ys[y] = worldPixel(lat, 0, view.zoom).y - top;
	}
	return { xs, ys };
}

// --- Colours ---------------------------------------------------------------------------------

export interface ColourTable {
	/** r, g, b, a (0–255) for each step */
	rgba: Uint8ClampedArray;
	min: number;
	/** Steps per unit of the value */
	per: number;
	size: number;
}

const tables = new WeakMap<Stops, ColourTable>();
/** A layer's colours as a table (made once) */
export function colourTable(stops: Stops, steps = false, size = 1024): ColourTable {
	const kept = tables.get(stops);
	if (kept) return kept;
	const min = stops[0][0];
	const max = stops[stops.length - 1][0];
	const rgba = new Uint8ClampedArray(size * 4);
	for (let i = 0; i < size; i++) {
		const [r, g, b, a] = colourAt(stops, min + ((max - min) * i) / (size - 1), steps);
		rgba[i * 4] = r;
		rgba[i * 4 + 1] = g;
		rgba[i * 4 + 2] = b;
		rgba[i * 4 + 3] = a * 255;
	}
	const table = { rgba, min, per: (size - 1) / (max - min), size };
	tables.set(stops, table);
	return table;
}

/**
 * Colours an image with a raster: `blend` mixes in other colours by a share (0–1) of its own,
 * `under` is drawn beneath
 */
export function paintField(
	image: ImageData,
	place: { columns: Float32Array; rows: Float32Array },
	raster: Raster,
	table: ColourTable,
	blend: { raster: Raster; table: ColourTable } | null = null,
	under: { raster: Raster; table: ColourTable } | null = null
) {
	const out = image.data;
	out.fill(0);
	const width = image.width;
	const { data, columns: rc, rows: rr } = raster;
	// Each column's place between the raster's points, worked out once
	const x0 = new Int32Array(width);
	const tx = new Float32Array(width);
	for (let sx = 0; sx < width; sx++) {
		const fx = place.columns[sx];
		if (fx < 0) {
			x0[sx] = -1;
			continue;
		}
		x0[sx] = Math.min(rc - 2, Math.floor(fx));
		tx[sx] = fx - x0[sx];
	}
	const lookup = (values: Float32Array, i: number, i2: number, ax: number, ay: number) =>
		(values[i] * (1 - ax) + values[i + 1] * ax) * (1 - ay) +
		(values[i2] * (1 - ax) + values[i2 + 1] * ax) * ay;
	const index = (t: ColourTable, value: number) =>
		Math.max(0, Math.min(t.size - 1, Math.round((value - t.min) * t.per))) * 4;
	for (let sy = 0; sy < image.height; sy++) {
		const fy = place.rows[sy];
		if (fy < 0) continue;
		const y0 = Math.min(rr - 2, Math.floor(fy));
		const ty = fy - y0;
		for (let sx = 0; sx < width; sx++) {
			const c = x0[sx];
			if (c < 0) continue;
			const i = y0 * rc + c;
			const i2 = i + rc;
			const ax = tx[sx];
			const value = lookup(data, i, i2, ax, ty);
			let k = index(table, value);
			let r = table.rgba[k];
			let g = table.rgba[k + 1];
			let b = table.rgba[k + 2];
			let a = table.rgba[k + 3];
			if (blend) {
				const share = lookup(blend.raster.data, i, i2, ax, ty);
				if (share > 0.02) {
					const s = Math.min(1, share);
					k = index(blend.table, value);
					r += (blend.table.rgba[k] - r) * s;
					g += (blend.table.rgba[k + 1] - g) * s;
					b += (blend.table.rgba[k + 2] - b) * s;
					a += (blend.table.rgba[k + 3] - a) * s;
				}
			}
			if (under && a < 250) {
				k = index(under.table, lookup(under.raster.data, i, i2, ax, ty));
				const ua = under.table.rgba[k + 3];
				if (ua) {
					// The field over what's under it
					const top = a / 255;
					const total = a + ua * (1 - top);
					const below = (ua * (1 - top)) / total;
					r = r * (a / total) + under.table.rgba[k] * below;
					g = g * (a / total) + under.table.rgba[k + 1] * below;
					b = b * (a / total) + under.table.rgba[k + 2] * below;
					a = total;
				}
			}
			const o = (sy * width + sx) * 4;
			out[o] = r;
			out[o + 1] = g;
			out[o + 2] = b;
			out[o + 3] = a;
		}
	}
}

// --- The pressure's lines (isobars), highs and lows -----------------------------------------------

/**
 * The lines where a raster has a value (marching squares), as segments in the raster's points:
 * x1, y1, x2, y2 one after another
 */
export function isolines(raster: Raster, level: number): number[] {
	const { data, columns, rows } = raster;
	const out: number[] = [];
	for (let y = 0; y < rows - 1; y++) {
		for (let x = 0; x < columns - 1; x++) {
			const a = data[y * columns + x];
			const b = data[y * columns + x + 1];
			const c = data[(y + 1) * columns + x + 1];
			const d = data[(y + 1) * columns + x];
			const code =
				(a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
			if (code === 0 || code === 15) continue;
			// Where the line crosses each side: top, right, bottom, left
			const top = () => [x + (level - a) / (b - a), y];
			const right = () => [x + 1, y + (level - b) / (c - b)];
			const bottom = () => [x + (level - d) / (c - d), y + 1];
			const left = () => [x, y + (level - a) / (d - a)];
			const segment = (p: number[], q: number[]) => out.push(p[0], p[1], q[0], q[1]);
			switch (code) {
				case 1:
				case 14:
					segment(left(), bottom());
					break;
				case 2:
				case 13:
					segment(bottom(), right());
					break;
				case 3:
				case 12:
					segment(left(), right());
					break;
				case 4:
				case 11:
					segment(top(), right());
					break;
				case 6:
				case 9:
					segment(top(), bottom());
					break;
				case 7:
				case 8:
					segment(left(), top());
					break;
				case 5:
				case 10: {
					// A saddle: the middle decides how the lines go
					const high = (a + b + c + d) / 4 > level;
					if ((code === 5) === high) {
						segment(left(), top());
						segment(bottom(), right());
					} else {
						segment(left(), bottom());
						segment(top(), right());
					}
				}
			}
		}
	}
	return out;
}

/** The highs and lows of a grid's values (grid points, the grid's border left out) */
export function extremes(values: Float32Array, columns: number, rows: number, reach = 3) {
	const found: { gx: number; gy: number; value: number; high: boolean }[] = [];
	for (let y = 1; y < rows - 1; y++) {
		for (let x = 1; x < columns - 1; x++) {
			const value = values[y * columns + x];
			let max = true;
			let min = true;
			let sum = 0;
			let count = 0;
			for (let dy = -reach; dy <= reach; dy++)
				for (let dx = -reach; dx <= reach; dx++) {
					if (!dx && !dy) continue;
					const yy = y + dy;
					const xx = x + dx;
					if (yy < 0 || xx < 0 || yy >= rows || xx >= columns) continue;
					const other = values[yy * columns + xx];
					if (other >= value) max = false;
					if (other <= value) min = false;
					sum += other;
					count++;
				}
			// Clearly higher or lower than around it
			if ((max || min) && count && Math.abs(value - sum / count) >= 1.5)
				found.push({ gx: x, gy: y, value, high: max });
		}
	}
	return found;
}
