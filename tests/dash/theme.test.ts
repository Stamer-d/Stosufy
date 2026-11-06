// A level in the colours of its beatmap's background (theme.ts): the picture's strong hues make
// its palettes; a picture without colour keeps the usual ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hsl, palettesFromPixels } from '../../src/lib/dash/theme';

/** Pixels (RGBA) of a picture: so many of each colour */
function picture(...parts: [string, number][]) {
	const data: number[] = [];
	for (const [color, count] of parts) {
		const n = parseInt(color.slice(1), 16);
		for (let k = 0; k < count; k++) data.push(n >> 16, (n >> 8) & 255, n & 255, 255);
	}
	return data;
}

/** A colour's hue (0–360) */
function hue(color: string) {
	const n = parseInt(color.slice(1), 16);
	const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === min) return 0;
	const d = max - min;
	const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return h * 60;
}
const near = (a: number, b: number, by: number) =>
	Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= by;

test('a red picture makes red palettes: a dark sky, a ground in it, a light accent', () => {
	const palettes = palettesFromPixels(picture(['#c0202a', 800], ['#202020', 200]))!;
	assert.equal(palettes.length, 8);
	for (const p of palettes) {
		assert.ok(near(hue(p.ground), 0, 25), p.ground);
		assert.ok(parseInt(p.bottom.slice(1), 16) < parseInt(p.ground.slice(1), 16));
	}
});

test('a picture of two colours takes both by turns, the larger first', () => {
	const palettes = palettesFromPixels(picture(['#1e6fd9', 600], ['#e88a1a', 300]))!;
	assert.ok(near(hue(palettes[0].ground), hue('#1e6fd9'), 20), palettes[0].ground);
	assert.ok(near(hue(palettes[1].ground), hue('#e88a1a'), 20), palettes[1].ground);
});

test('a picture without colour keeps the usual palettes', () => {
	assert.equal(
		palettesFromPixels(picture(['#808080', 500], ['#f0f0f0', 300], ['#101010', 200])),
		null
	);
	assert.equal(palettesFromPixels([]), null);
});

test('colours are written as #rrggbb', () => {
	assert.equal(hsl(0, 1, 0.5), '#ff0000');
	assert.equal(hsl(1 / 3, 1, 0.5), '#00ff00');
	assert.equal(hsl(0, 0, 1), '#ffffff');
});
