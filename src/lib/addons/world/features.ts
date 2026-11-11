// Drawing what the trackers put on the map, and finding what's under the pointer. Areas
// first, then lines, then the shapes (the most important on top). The map can show the
// world more than once side by side: `shifts` are where it repeats.

import type { Feature } from './types';

type ToScreen = (lat: number, lon: number) => { x: number; y: number };

export interface DrawOptions {
	shifts?: number[];
	zoom: number;
	selected?: string | null;
	now?: number;
}

const withAlpha = (hex: string, alpha: number) =>
	hex.length === 7
		? hex +
			Math.round(Math.max(0, Math.min(1, alpha)) * 255)
				.toString(16)
				.padStart(2, '0')
		: hex;

/** Where a feature is now (things that move are asked) */
export function placeOf(feature: Feature, now: number) {
	if (!feature.at) return { lat: feature.lat, lon: feature.lon, heading: feature.heading };
	const at = feature.at(now);
	return at ? { heading: feature.heading, ...at } : null;
}

function path(
	c: CanvasRenderingContext2D,
	points: [number, number][],
	toScreen: ToScreen,
	shift: number
) {
	let previous: number | null = null;
	let offset = 0;
	points.forEach(([lon, lat], i) => {
		// Over the date line: on the same side, not back across the map
		if (previous !== null) offset += Math.round((previous - lon) / 360) * 360;
		previous = lon;
		const p = toScreen(lat, lon + offset);
		if (i) c.lineTo(p.x + shift, p.y);
		else c.moveTo(p.x + shift, p.y);
	});
}

function shape(c: CanvasRenderingContext2D, f: Feature, x: number, y: number, heading?: number) {
	const s = f.size ?? 4;
	c.beginPath();
	switch (f.shape ?? 'dot') {
		case 'ring':
		case 'dot':
			c.arc(x, y, s, 0, Math.PI * 2);
			break;
		case 'square':
			c.rect(x - s, y - s, s * 2, s * 2);
			break;
		case 'diamond':
			c.moveTo(x, y - s * 1.3);
			c.lineTo(x + s * 1.3, y);
			c.lineTo(x, y + s * 1.3);
			c.lineTo(x - s * 1.3, y);
			c.closePath();
			break;
		case 'triangle':
			c.moveTo(x, y - s * 1.3);
			c.lineTo(x + s * 1.2, y + s);
			c.lineTo(x - s * 1.2, y + s);
			c.closePath();
			break;
		case 'plus':
			c.rect(x - s, y - s / 3, s * 2, (s * 2) / 3);
			c.rect(x - s / 3, y - s, (s * 2) / 3, s * 2);
			break;
		case 'star':
			for (let i = 0; i < 10; i++) {
				const r = i % 2 ? s * 0.5 : s * 1.3;
				const a = (i * Math.PI) / 5 - Math.PI / 2;
				if (i) c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
				else c.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
			}
			c.closePath();
			break;
		case 'camera':
			c.roundRect(x - s * 1.3, y - s, s * 2.6, s * 2, s * 0.5);
			break;
		case 'arrow':
		case 'boat': {
			const a = (((heading ?? 0) - 90) * Math.PI) / 180;
			const cos = Math.cos(a);
			const sin = Math.sin(a);
			const point = (px: number, py: number) => [x + px * cos - py * sin, y + px * sin + py * cos];
			const outline =
				f.shape === 'boat'
					? [
							[s * 1.6, 0],
							[s * 0.4, s * 0.7],
							[-s * 1.2, s * 0.7],
							[-s * 1.2, -s * 0.7],
							[s * 0.4, -s * 0.7]
						]
					: [
							[s * 1.5, 0],
							[-s, s],
							[-s * 0.4, 0],
							[-s, -s]
						];
			outline.forEach(([px, py], i) => {
				const [sx, sy] = point(px, py);
				if (i) c.lineTo(sx, sy);
				else c.moveTo(sx, sy);
			});
			c.closePath();
			break;
		}
	}
}

/** Areas and lines (drawn under everything else; they don't move) */
export function drawShapesUnder(
	c: CanvasRenderingContext2D,
	list: Feature[],
	toScreen: ToScreen,
	{ shifts = [0], selected = null }: DrawOptions
) {
	for (const f of list) {
		if (!f.area?.length) continue;
		for (const shift of shifts) {
			c.beginPath();
			for (const ring of f.area) {
				path(c, ring, toScreen, shift);
				c.closePath();
			}
			c.fillStyle = withAlpha(f.colour, f.id === selected ? 0.4 : 0.22);
			c.fill('evenodd');
			c.strokeStyle = withAlpha(f.colour, 0.85);
			c.lineWidth = f.id === selected ? 2.5 : 1.2;
			c.stroke();
		}
	}
	c.lineJoin = 'round';
	for (const f of list) {
		if (!f.line || f.line.length < 2) continue;
		for (const shift of shifts) {
			c.beginPath();
			path(c, f.line, toScreen, shift);
			c.strokeStyle = withAlpha(f.lineColour ?? f.colour, f.id === selected ? 0.95 : 0.6);
			c.lineWidth = f.id === selected ? 3 : 1.6;
			c.stroke();
		}
	}
}

/** The shapes, the most important on top; new ones pulse, the one picked is ringed */
export function drawShapes(
	c: CanvasRenderingContext2D,
	list: Feature[],
	toScreen: ToScreen,
	width: number,
	height: number,
	{ shifts = [0], zoom, selected = null, now = Date.now() }: DrawOptions
) {
	const pulse = (now % 2000) / 2000;
	const sorted = list.some((f) => f.rank)
		? [...list].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
		: list;
	let picked: { f: Feature; x: number; y: number } | null = null;
	c.font = '600 10px system-ui, sans-serif';
	c.textBaseline = 'middle';
	for (const f of sorted) {
		const at = placeOf(f, now);
		if (!at) continue;
		const p = toScreen(at.lat, at.lon);
		const s = f.size ?? 4;
		for (const shift of shifts) {
			const x = p.x + shift;
			const y = p.y;
			if (x < -s - 30 || y < -s - 30 || x > width + s + 30 || y > height + s + 30) continue;
			if (f.id === selected) {
				picked = { f, x, y };
				continue;
			}
			if (f.pulse) {
				c.beginPath();
				c.arc(x, y, s + pulse * (10 + s), 0, Math.PI * 2);
				c.strokeStyle = withAlpha(f.colour, (1 - pulse) * 0.8);
				c.lineWidth = 2;
				c.stroke();
			}
			shape(c, f, x, y, at.heading);
			if (f.shape === 'ring') {
				c.strokeStyle = f.colour;
				c.lineWidth = 2;
				c.stroke();
			} else {
				c.fillStyle = f.colour;
				c.fill();
				if (s >= 3) {
					c.strokeStyle = 'rgba(0, 0, 0, 0.6)';
					c.lineWidth = 1;
					c.stroke();
				}
			}
			if (f.label && zoom >= (f.labelZoom ?? 0)) {
				c.fillStyle = 'rgba(255, 255, 255, 0.85)';
				c.strokeStyle = 'rgba(0, 0, 0, 0.7)';
				c.lineWidth = 3;
				c.strokeText(f.label, x + s + 4, y);
				c.fillText(f.label, x + s + 4, y);
			}
		}
	}
	if (picked) {
		const { f, x, y } = picked;
		const s = f.size ?? 4;
		c.beginPath();
		c.arc(x, y, s + 7, 0, Math.PI * 2);
		c.fillStyle = 'rgba(255, 255, 255, 0.15)';
		c.fill();
		c.strokeStyle = '#ffffff';
		c.lineWidth = 2.5;
		c.stroke();
		shape(c, f, x, y, placeOf(f, now)?.heading);
		c.fillStyle = f.colour;
		c.fill();
		c.strokeStyle = '#ffffff';
		c.lineWidth = 1.5;
		c.stroke();
		if (f.label) {
			c.font = '700 11px system-ui, sans-serif';
			const w = c.measureText(f.label).width + 10;
			c.fillStyle = 'rgba(0, 0, 0, 0.75)';
			c.beginPath();
			c.roundRect(x + s + 9, y - 9, w, 18, 5);
			c.fill();
			c.fillStyle = '#ffffff';
			c.fillText(f.label, x + s + 14, y + 0.5);
		}
	}
	c.textBaseline = 'alphabetic';
}

/** Whether a place is inside rings of [lon, lat] (even-odd, like they're drawn) */
function inside(lat: number, lon: number, rings: [number, number][][]) {
	let hit = false;
	for (const ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
		}
	}
	return hit;
}

/**
 * The feature under a point of the map: the nearest shape within a finger's width, else
 * an area it's inside
 */
export function featureAt(
	list: Feature[],
	toScreen: ToScreen,
	x: number,
	y: number,
	place: { lat: number; lon: number },
	{ shifts = [0], now = Date.now() }: { shifts?: number[]; now?: number } = {}
) {
	let best: Feature | null = null;
	let bestDistance = Infinity;
	for (const f of list) {
		const at = placeOf(f, now);
		if (!at) continue;
		const p = toScreen(at.lat, at.lon);
		const reach = Math.max(9, (f.size ?? 4) + 4);
		for (const shift of shifts) {
			const distance = Math.hypot(p.x + shift - x, p.y - y);
			if (distance <= reach && distance < bestDistance) {
				best = f;
				bestDistance = distance;
			}
		}
	}
	if (best) return best;
	const lon = ((((place.lon + 180) % 360) + 360) % 360) - 180;
	return [...list].reverse().find((f) => f.area?.length && inside(place.lat, lon, f.area)) ?? null;
}

// --- Helpers for the trackers ----------------------------------------------------------------

/** A Google encoded polyline as [lon, lat] points */
export function decodePolyline(text: string, precision = 5): [number, number][] {
	const factor = 10 ** precision;
	const points: [number, number][] = [];
	let lat = 0;
	let lon = 0;
	let i = 0;
	const next = () => {
		let result = 0;
		let shift = 0;
		let byte;
		do {
			byte = text.charCodeAt(i++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20 && i < text.length + 1);
		return result & 1 ? ~(result >> 1) : result >> 1;
	};
	while (i < text.length) {
		lat += next();
		lon += next();
		points.push([lon / factor, lat / factor]);
	}
	return points;
}

/** Where along a line ([lon, lat]) a share of its length is, and which way it goes there */
export function alongLine(line: [number, number][], share: number) {
	if (line.length === 1) return { lat: line[0][1], lon: line[0][0], heading: 0 };
	const lengths: number[] = [];
	let total = 0;
	for (let i = 1; i < line.length; i++) {
		const dx = (line[i][0] - line[i - 1][0]) * Math.cos((line[i][1] * Math.PI) / 180);
		const dy = line[i][1] - line[i - 1][1];
		const length = Math.hypot(dx, dy);
		lengths.push(length);
		total += length;
	}
	let left = Math.max(0, Math.min(1, share)) * total;
	for (let i = 0; i < lengths.length; i++) {
		if (left <= lengths[i] || i === lengths.length - 1) {
			const t = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
			const [lon0, lat0] = line[i];
			const [lon1, lat1] = line[i + 1];
			const heading =
				(Math.atan2((lon1 - lon0) * Math.cos((lat0 * Math.PI) / 180), lat1 - lat0) * 180) / Math.PI;
			return { lat: lat0 + (lat1 - lat0) * t, lon: lon0 + (lon1 - lon0) * t, heading };
		}
		left -= lengths[i];
	}
	const [lon, lat] = line[line.length - 1];
	return { lat, lon, heading: 0 };
}

/** On from where it was seen, along its course at its speed (for a while) */
export function deadReckoning(
	from: { lat: number; lon: number; time: number },
	speedKmh: number,
	heading: number,
	maxSeconds = 120
) {
	return (now: number) => {
		const seconds = Math.max(0, Math.min(maxSeconds, (now - from.time) / 1000));
		const km = (speedKmh * seconds) / 3600;
		const rad = (heading * Math.PI) / 180;
		return {
			lat: from.lat + (km * Math.cos(rad)) / 111.32,
			lon: from.lon + (km * Math.sin(rad)) / (111.32 * Math.cos((from.lat * Math.PI) / 180)),
			heading
		};
	};
}

/** 5 min ago, 3 h ago, 2 d ago (or in 5 min) */
export function ago(time: number, now = Date.now()) {
	const minutes = Math.round((now - time) / 60000);
	const abs = Math.abs(minutes);
	const text =
		abs < 60
			? `${abs} min`
			: abs < 48 * 60
				? `${Math.round(abs / 60)} h`
				: `${Math.round(abs / 1440)} d`;
	if (abs === 0) return 'just now';
	return minutes > 0 ? `${text} ago` : `in ${text}`;
}

/** A time in the user's way */
export const clockTime = (ms: number) =>
	new Date(ms).toLocaleString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

/** A colour scale: stops of [value, [r, g, b, a]], in between blended */
export function scale(stops: [number, [number, number, number, number]][], value: number) {
	if (!isFinite(value) || value <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [at, colour] = stops[i];
		if (value <= at) {
			const [from, previous] = stops[i - 1];
			const t = (value - from) / (at - from);
			return previous.map((v, k) => v + (colour[k] - v) * t) as [number, number, number, number];
		}
	}
	return stops[stops.length - 1][1];
}

/** A colour of a scale as css */
export const css = ([r, g, b, a]: number[]) =>
	`rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.max(a, 0.7)})`;
