// A level in the colours of its beatmap's background: the hues that stand out in the picture
// (how much of it they colour, and how vivid), each made into a level's palette (a dark sky over
// it, a ground in it, a light accent). A picture without colour keeps the usual palettes.

import type { Palette } from './render';

/** A colour (hue, saturation, lightness 0–1) as #rrggbb */
export function hsl(h: number, s: number, l: number) {
	h = ((h % 1) + 1) % 1;
	s = Math.max(0, Math.min(1, s));
	l = Math.max(0, Math.min(1, l));
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const channel = (t: number) => {
		t = ((t % 1) + 1) % 1;
		const v =
			t < 1 / 6
				? p + (q - p) * 6 * t
				: t < 1 / 2
					? q
					: t < 2 / 3
						? p + (q - p) * (2 / 3 - t) * 6
						: p;
		return Math.round(v * 255)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

/** A colour (0–255 each) as hue, saturation and lightness (0–1) */
function toHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === r
			? ((g - b) / d + (g < b ? 6 : 0)) / 6
			: max === g
				? ((b - r) / d + 2) / 6
				: ((r - g) / d + 4) / 6;
	return [h, s, l];
}

const BINS = 24;

/**
 * The level's palettes from a picture's pixels (RGBA, as getImageData gives them): its strongest
 * hues, up to four of them at least 45° apart, by how much of the picture they colour and how
 * vividly (grey, black and white count little). Null where the picture has hardly any colour.
 */
export function palettesFromPixels(data: ArrayLike<number>): Palette[] | null {
	const weight = new Float64Array(BINS);
	const saturation = new Float64Array(BINS);
	let pixels = 0;
	for (let i = 0; i + 3 < data.length; i += 4) {
		if (data[i + 3] < 128) continue;
		pixels++;
		const [h, s, l] = toHsl(data[i], data[i + 1], data[i + 2]);
		const w = s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.7);
		if (w <= 0.03) continue;
		const bin = Math.floor(h * BINS) % BINS;
		weight[bin] += w;
		saturation[bin] += s * w;
	}
	const total = weight.reduce((a, b) => a + b, 0);
	if (!pixels || total < pixels * 0.04) return null;
	// (smoothed around the circle: a hue between two bins counts for both)
	const smooth = weight.map(
		(w, i) => w + 0.5 * (weight[(i + BINS - 1) % BINS] + weight[(i + 1) % BINS])
	);
	const order = [...smooth.keys()].sort((a, b) => smooth[b] - smooth[a]);
	const picks: { hue: number; sat: number }[] = [];
	for (const bin of order) {
		if (picks.length >= 4 || smooth[bin] < smooth[order[0]] * 0.15) break;
		const near = picks.some((p) => {
			const d = Math.abs(p.hue * BINS - (bin + 0.5));
			return Math.min(d, BINS - d) < 3;
		});
		if (near) continue;
		const sat = weight[bin] > 0 ? saturation[bin] / weight[bin] : 0.5;
		picks.push({ hue: (bin + 0.5) / BINS, sat: Math.max(0.45, Math.min(0.9, sat)) });
	}
	if (!picks.length) return null;
	// Eight palettes (the parts take turns as before), the picture's hues by turns, a bit lighter
	// or darker the second time round
	return Array.from({ length: 8 }, (_, k) => {
		const { hue, sat } = picks[k % picks.length];
		const round = Math.floor(k / picks.length) % 2;
		const lift = round ? 0.05 : 0;
		const turn = round ? 0.02 : 0;
		return {
			top: hsl(hue + turn, sat * 0.85, 0.3 + lift),
			bottom: hsl(hue + turn + 0.03, sat * 0.75, 0.08),
			ground: hsl(hue + turn, sat, 0.43 + lift),
			accent: hsl(hue + turn, Math.min(1, sat + 0.15), 0.8)
		};
	});
}
