// Draws the gameplay images of Stosufy's own skin into src/lib/gameplay/stosufy (@2x PNGs and
// skin.ini). In a browser (Playwright's Chromium), with the app's font (Figtree) and the cat
// of the logo. Run it again after changing something here: node scripts/stosufy-skin.js
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = 'src/lib/gameplay/stosufy';
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const logo = dataUrl('static/logo.png', 'image/png');
const font = dataUrl(
	'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2',
	'font/woff2'
);

const SKIN_INI = `[General]
Name: Stosufy
Author: Stosufy
Version: 2.7
AllowSliderBallTint: 0
SpinnerFrequencyModulate: 1

[Colours]
Combo1: 139,92,246
Combo2: 236,72,153
Combo3: 56,189,248
Combo4: 52,211,153
SliderBorder: 255,255,255
SliderTrackOverride: 24,16,40

[Fonts]
HitCirclePrefix: default
HitCircleOverlap: 2
ScorePrefix: score
ScoreOverlap: 0
ComboPrefix: score
ComboOverlap: 0
`;

// Runs in the page: every image as a data URL, by file name without "@2x.png"
async function draw({ logo, font }) {
	const VIOLET = '#7c3aed';
	const LIGHT = '#8b5cf6';
	const LILAC = '#a78bfa';
	const PALE = '#c4b5fd';
	const DARK = '#120a20';
	const FONT = 'Figtree';

	const face = new FontFace(FONT, `url(${font})`, { weight: '300 900' });
	await face.load();
	document.fonts.add(face);

	const canvas = (w, h = w) => {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		return c.getContext('2d');
	};
	const out = {};
	const save = (name, c) => (out[name] = c.canvas.toDataURL('image/png'));

	// The cat of the logo: its silhouette (the head and the "S" on black), white
	const picture = new Image();
	picture.src = logo;
	await picture.decode();
	const cat = canvas(picture.width, picture.height);
	cat.drawImage(picture, 0, 0);
	const pixels = cat.getImageData(0, 0, picture.width, picture.height);
	let [left, top, right, bottom] = [Infinity, Infinity, -1, -1];
	for (let i = 0; i < pixels.data.length; i += 4) {
		const p = pixels.data;
		const a = Math.max(0, Math.min(1, (Math.max(p[i], p[i + 1], p[i + 2]) - 30) / 120));
		p[i] = p[i + 1] = p[i + 2] = 255;
		p[i + 3] = Math.round(a * 255);
		if (a > 0.5) {
			const x = (i / 4) % picture.width;
			const y = Math.floor(i / 4 / picture.width);
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
		}
	}
	cat.putImageData(pixels, 0, 0);
	const catWidth = right - left;
	// The head is round: its middle is half its width above the bottom
	const head = { x: (left + right) / 2, y: bottom - catWidth / 2 };

	/** The cat in a colour, its head (radius r) centred at x, y */
	function drawCat(c, x, y, r, colour) {
		const scale = (r * 2) / catWidth;
		const tinted = canvas(picture.width, picture.height);
		tinted.drawImage(cat.canvas, 0, 0);
		tinted.globalCompositeOperation = 'source-in';
		tinted.fillStyle = colour;
		tinted.fillRect(0, 0, picture.width, picture.height);
		c.drawImage(
			tinted.canvas,
			x - head.x * scale,
			y - head.y * scale,
			picture.width * scale,
			picture.height * scale
		);
	}
	/** The cat with a rim around it: drawn bigger in every direction underneath */
	function drawCatWithRim(c, x, y, r, colour, rim, rimColour) {
		for (let a = 0; a < Math.PI * 2; a += Math.PI / 16)
			drawCat(c, x + Math.cos(a) * rim, y + Math.sin(a) * rim, r, rimColour);
		drawCat(c, x, y, r, colour);
	}

	const ring = (c, x, y, r, width, colour) => {
		c.strokeStyle = colour;
		c.lineWidth = width;
		c.beginPath();
		c.arc(x, y, r, 0, Math.PI * 2);
		c.stroke();
	};
	const disc = (c, x, y, r, fill) => {
		c.fillStyle = fill;
		c.beginPath();
		c.arc(x, y, r, 0, Math.PI * 2);
		c.fill();
	};

	// --- Hit circles (white: the game colours them) -------------------------------------------

	let c = canvas(256);
	const shade = c.createLinearGradient(10, 10, 246, 246);
	shade.addColorStop(0, '#ffffff');
	shade.addColorStop(0.55, '#f6f6f8');
	shade.addColorStop(1, '#d8d8de');
	disc(c, 128, 128, 118, shade);
	save('hitcircle', c);

	c = canvas(256);
	ring(c, 128, 128, 110, 16, '#ffffff');
	save('hitcircleoverlay', c);

	c = canvas(256);
	ring(c, 128, 128, 116, 6, '#ffffff');
	save('approachcircle', c);

	// --- Sliders ----------------------------------------------------------------------------

	c = canvas(256);
	drawCatWithRim(c, 128, 140, 92, VIOLET, 7, '#ffffff');
	save('sliderb', c);

	c = canvas(512);
	c.shadowColor = LIGHT;
	c.shadowBlur = 18;
	ring(c, 256, 256, 228, 8, LIGHT);
	c.shadowBlur = 0;
	ring(c, 256, 256, 228, 4, '#ddd6fe');
	save('sliderfollowcircle', c);

	c = canvas(256);
	c.strokeStyle = '#ffffff';
	c.lineWidth = 22;
	c.lineCap = 'round';
	c.lineJoin = 'round';
	c.beginPath();
	c.moveTo(106, 80);
	c.lineTo(154, 128);
	c.lineTo(106, 176);
	c.stroke();
	save('reversearrow', c);

	c = canvas(32);
	disc(c, 16, 16, 11, '#ffffff');
	save('sliderscorepoint', c);

	c = canvas(64, 24);
	c.fillStyle = '#ffffff';
	c.beginPath();
	c.roundRect(12, 8, 40, 8, 4);
	c.fill();
	save('followpoint', c);

	// --- Cursor -----------------------------------------------------------------------------

	c = canvas(128);
	c.shadowColor = LIGHT;
	c.shadowBlur = 12;
	drawCat(c, 64, 70, 40, LILAC);
	c.shadowBlur = 0;
	disc(c, 64, 70, 31, '#ffffff');
	save('cursor', c);

	c = canvas(64);
	const glow = c.createRadialGradient(32, 32, 0, 32, 32, 30);
	glow.addColorStop(0, 'rgba(167, 139, 250, 1)');
	glow.addColorStop(0.3, 'rgba(139, 92, 246, 0.9)');
	glow.addColorStop(1, 'rgba(124, 58, 237, 0)');
	disc(c, 32, 32, 30, glow);
	save('cursortrail', c);

	// --- Spinner (the new style: bottom, top, middle, middle2, glow) ------------------------

	c = canvas(1024);
	disc(c, 512, 512, 500, 'rgba(18, 10, 32, 0.9)');
	ring(c, 512, 512, 495, 10, VIOLET);
	ring(c, 512, 512, 455, 3, VIOLET);
	ring(c, 512, 512, 330, 4, VIOLET);
	ring(c, 512, 512, 190, 4, VIOLET);
	save('spinner-bottom', c);

	c = canvas(1024);
	c.strokeStyle = '#ffffff';
	c.lineWidth = 10;
	c.lineCap = 'round';
	for (let i = 0; i < 60; i++) {
		const a = (i / 60) * Math.PI * 2;
		c.beginPath();
		c.moveTo(512 + Math.cos(a) * 400, 512 + Math.sin(a) * 400);
		c.lineTo(512 + Math.cos(a) * 436, 512 + Math.sin(a) * 436);
		c.stroke();
	}
	save('spinner-top', c);

	// Drawn over middle2 (and turning red over the spinner's time): a ring around it
	c = canvas(400);
	ring(c, 200, 200, 150, 10, '#ffffff');
	save('spinner-middle', c);

	c = canvas(260);
	disc(c, 130, 130, 112, '#ffffff');
	c.globalCompositeOperation = 'destination-out';
	drawCat(c, 130, 140, 58, '#000000');
	save('spinner-middle2', c);

	// Only blur: at 1x (the others are @2x)
	c = canvas(550);
	c.filter = 'blur(14px)';
	ring(c, 275, 275, 235, 18, 'rgba(221, 214, 254, 0.8)');
	save('spinner-glow', c);

	c = canvas(640);
	ring(c, 320, 320, 314, 6, '#ffffff');
	save('spinner-approachcircle', c);

	// --- Text -------------------------------------------------------------------------------

	/** A word in the font, as tight as it is (with room for its glow and outline) */
	function word(text, size, fill, { weight = 800, glow = null, outline = null } = {}) {
		const measure = canvas(1);
		measure.font = `${weight} ${size}px ${FONT}`;
		const m = measure.measureText(text);
		const pad = Math.ceil(size * 0.12 + (glow ? glow.blur : 0) + (outline ? outline.width : 0));
		const width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2;
		const height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2;
		const w = canvas(width, height);
		w.font = measure.font;
		const x = pad + m.actualBoundingBoxLeft;
		const y = pad + m.actualBoundingBoxAscent;
		if (outline) {
			w.lineJoin = 'round';
			w.lineWidth = outline.width * 2;
			w.strokeStyle = outline.colour;
			w.strokeText(text, x, y);
		}
		if (glow) {
			w.shadowColor = glow.colour;
			w.shadowBlur = glow.blur;
		}
		w.fillStyle = fill;
		w.fillText(text, x, y);
		return w;
	}

	save(
		'hit0',
		(() => {
			const x = canvas(160);
			x.strokeStyle = '#f43f5e';
			x.lineWidth = 18;
			x.lineCap = 'round';
			x.beginPath();
			x.moveTo(42, 42);
			x.lineTo(118, 118);
			x.moveTo(118, 42);
			x.lineTo(42, 118);
			x.stroke();
			return x;
		})()
	);
	save('hit50', word('50', 110, '#fbbf24'));
	save('hit100', word('100', 110, '#34d399'));
	save('hit300', word('300', 110, PALE, { glow: { colour: LIGHT, blur: 16 } }));
	out['hit100k'] = out['hit100'];
	out['hit300g'] = out['hit300'];
	out['hit300k'] = out['hit300'];

	save('spinner-spin', word('SPIN', 92, '#ffffff'));
	save('spinner-clear', word('CLEAR', 110, '#ffffff'));

	// The grades: SS silver (XH) and gold (X), S silver (SH) and gold, A–D
	const grades = {
		XH: ['SS', '#ffffff', { outline: { width: 6, colour: '#9ca3af' } }],
		X: ['SS', '#fde047'],
		SH: ['S', '#e5e7eb'],
		S: ['S', '#fde047'],
		A: ['A', '#34d399'],
		B: ['B', '#38bdf8'],
		C: ['C', '#a78bfa'],
		D: ['D', '#f43f5e']
	};
	/**
	 * Two letters overlapping, the second lower right with a gap cut around it: about as wide
	 * as it's tall, like the single letters (the results make every grade the same height)
	 */
	function overlapping(letter, stepX, stepY, gap) {
		const dx = Math.round(letter.canvas.width * stepX);
		const dy = Math.round(letter.canvas.height * stepY);
		const both = canvas(letter.canvas.width + dx, letter.canvas.height + dy);
		both.drawImage(letter.canvas, 0, 0);
		both.globalCompositeOperation = 'destination-out';
		for (let a = 0; a < Math.PI * 2; a += Math.PI / 16)
			both.drawImage(letter.canvas, dx + Math.cos(a) * gap, dy + Math.sin(a) * gap);
		both.globalCompositeOperation = 'source-over';
		both.drawImage(letter.canvas, dx, dy);
		return both;
	}
	for (const [grade, [text, colour, options]] of Object.entries(grades)) {
		const picture =
			text === 'SS'
				? overlapping(word('S', 360, colour, options), 0.36, 0.2, 14)
				: word(text, 360, colour, options);
		save(`ranking-${grade}`, picture);
	}

	// The box of the spinner's RPM: its label left, the number goes right of it
	c = canvas(560, 96);
	c.fillStyle = DARK;
	c.strokeStyle = VIOLET;
	c.lineWidth = 4;
	c.beginPath();
	c.roundRect(2, 2, 556, 92, 22);
	c.fill();
	c.stroke();
	c.font = `700 40px ${FONT}`;
	c.fillStyle = PALE;
	c.textBaseline = 'middle';
	c.fillText('RPM', 30, 50);
	save('spinner-rpm', c);

	// The key of the input overlay: light, the game writes on it in black and colours it
	// when pressed
	c = canvas(92);
	c.fillStyle = '#f5f3ff';
	c.strokeStyle = PALE;
	c.lineWidth = 4;
	c.beginPath();
	c.roundRect(8, 8, 76, 76, 16);
	c.fill();
	c.stroke();
	save('inputoverlay-key', c);

	// --- Fonts: all glyphs of one the same height (they're centred on a line), digits the
	// same width (numbers don't jump around while they count) -------------------------------

	function glyphs(prefix, size, { shadow = false } = {}) {
		const measure = canvas(1);
		measure.font = `800 ${size}px ${FONT}`;
		const digits = '0123456789'.split('');
		const ascent = Math.max(...digits.map((d) => measure.measureText(d).actualBoundingBoxAscent));
		const pad = Math.ceil(size * 0.08);
		const height = Math.ceil(ascent + size * 0.18) + pad * 2;
		const digitWidth = Math.max(...digits.map((d) => measure.measureText(d).width));
		const extras = { x: 'x', percent: '%', dot: '.', comma: ',' };
		const all = [
			...digits.map((d) => [d, d]),
			...(prefix === 'default' ? [] : Object.entries(extras))
		];
		for (const [file, char] of all) {
			const width = Math.ceil(/\d/.test(char) ? digitWidth : measure.measureText(char).width) + 4;
			const g = canvas(width, height);
			g.font = measure.font;
			g.textAlign = 'center';
			g.textBaseline = 'alphabetic';
			if (shadow) {
				g.shadowColor = 'rgba(0, 0, 0, 0.3)';
				g.shadowBlur = 6;
				g.shadowOffsetY = 2;
			}
			g.fillStyle = '#ffffff';
			g.fillText(char, width / 2, pad + ascent);
			save(`${prefix}-${file}`, g);
		}
	}
	glyphs('default', 100, { shadow: true });
	glyphs('score', 76);

	return out;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const images = await page.evaluate(draw, { logo, font });
await browser.close();

mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) rmSync(`${OUT}/${file}`);
const ONE_X = new Set(['spinner-glow']);
for (const [name, url] of Object.entries(images))
	writeFileSync(
		`${OUT}/${name}${ONE_X.has(name) ? '' : '@2x'}.png`,
		Buffer.from(url.split(',')[1], 'base64')
	);
writeFileSync(`${OUT}/skin.ini`, SKIN_INI);
console.log(`${Object.keys(images).length} images in ${OUT}`);
