// Draws the Dash mode: the level around the player, the player, its effects and the bar
// of how far it got. The player, its vehicles, spikes, saws, orbs, pads, portals and
// checkpoints are sprites (sprites.webp, cut from the sprite sheet by
// scripts/dash-sprites.py); blocks, the ground and the scenery are drawn here, in colours
// that change with every part. Until the sprites have loaded, everything is drawn.

import { wallAt, hitbox, type Mode, type PlayerState, type Section, type Solid } from './physics';
import type { Level } from './generate';
import spritesUrl from './sprites.webp';
import { SPRITES, type SpriteName } from './sprites';

export { spritesUrl };

let atlas: HTMLImageElement | null = null;
/** The sprites, once they've loaded */
function sprites() {
	if (!atlas && typeof Image !== 'undefined') {
		atlas = new Image();
		atlas.src = spritesUrl;
	}
	return atlas?.complete && atlas.naturalWidth ? atlas : null;
}

/** How many blocks high the view is */
const VIEW = 11;

export interface Palette {
	top: string;
	bottom: string;
	ground: string;
	accent: string;
}

export const PALETTES: Palette[] = [
	{ top: '#3b2a96', bottom: '#120a36', ground: '#4b2fd0', accent: '#a78bfa' },
	{ top: '#1d56c4', bottom: '#071848', ground: '#2265e0', accent: '#7dd3fc' },
	{ top: '#0f8a80', bottom: '#032a28', ground: '#0fa596', accent: '#5eead4' },
	{ top: '#3a8f1f', bottom: '#0d2607', ground: '#45b52c', accent: '#bef264' },
	{ top: '#c25e0c', bottom: '#381402', ground: '#f08416', accent: '#fed7aa' },
	{ top: '#b3163f', bottom: '#2a0410', ground: '#ec2050', accent: '#fecdd3' },
	{ top: '#a3195a', bottom: '#2c0420', ground: '#e0308a', accent: '#fbcfe8' },
	{ top: '#0b6488', bottom: '#021722', ground: '#0aa0c6', accent: '#a5f3fc' }
];

export interface Icon {
	/** Its look; the colours are for the trail, the dust and the drawn vehicles */
	sprite: SpriteName;
	primary: string;
	secondary: string;
}

export const ICONS: Icon[] = [
	{ sprite: 'icon0', primary: '#7d6cff', secondary: '#7dff3a' },
	{ sprite: 'icon1', primary: '#9d7bff', secondary: '#21e0ff' },
	{ sprite: 'icon2', primary: '#a3abd0', secondary: '#21e0ff' },
	{ sprite: 'icon3', primary: '#7dff3a', secondary: '#21e0ff' },
	{ sprite: 'icon4', primary: '#ffd93d', secondary: '#ffe14d' },
	{ sprite: 'icon5', primary: '#21e0ff', secondary: '#1b62ff' },
	{ sprite: 'icon6', primary: '#ffe14d', secondary: '#ff5ec4' },
	{ sprite: 'icon7', primary: '#ff5ec4', secondary: '#ff4fd8' }
];

export interface Frame {
	level: Level;
	state: PlayerState;
	/** The song time (ms) it shows */
	time: number;
	attempt: number;
	/** 0–100 */
	progress: number;
	best: number;
	practice: boolean;
	checkpoints: { x: number; y: number }[];
	dead: boolean;
	/** ms since the player died */
	deadFor: number;
	complete: boolean;
	icon: Icon;
	/** When the player is frozen before a (re)start */
	waiting: boolean;
	/** No HUD (the start screen) */
	hud: boolean;
}

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	size: number;
	color: string;
	kind: 'square' | 'ring' | 'glow';
	gravity: number;
	spin: number;
}

const hex = (color: string) => {
	if (color.startsWith('rgb'))
		return color
			.match(/[\d.]+/g)!
			.slice(0, 3)
			.map(Number);
	const n = parseInt(color.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, f: number) => {
	const x = hex(a);
	const y = hex(b);
	const c = x.map((v, i) => Math.round(v + (y[i] - v) * f));
	return `rgb(${c[0]},${c[1]},${c[2]})`;
};
const rgba = (color: string, alpha: number) => {
	if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
	const [r, g, b] = hex(color);
	return `rgba(${r},${g},${b},${alpha})`;
};
const ease = (f: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, f)), 3);

/** A number from a place, always the same */
const noise = (n: number) => {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
};

export function createDashRenderer(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d')!;
	// (loading from now on, so they're there when the level starts)
	sprites();
	let width = 0;
	let height = 0;
	let scale = 1;
	let camX = 0;
	let camY = -2.2;
	let lastTime = 0;
	let lastFrame = 0;
	let particles: Particle[] = [];
	let trail: { x: number; y: number; time: number }[] = [];
	let shake = 0;
	let flash = 0;
	let flashColor = '#ffffff';
	let shipAngle = 0;
	let emit = 0;
	let lastMode: Mode | null = null;
	let lastKiai = false;
	let zoom = 0;

	function resize() {
		const ratio = Math.min(2, window.devicePixelRatio || 1);
		const rect = canvas.getBoundingClientRect();
		const w = Math.max(1, Math.round(rect.width * ratio));
		const h = Math.max(1, Math.round(rect.height * ratio));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		width = w;
		height = h;
		scale = Math.min(h / VIEW, w / 15);
	}

	const sx = (x: number) => (x - camX) * scale;
	const sy = (y: number) => height - (y - camY) * scale;

	/**
	 * Draws a sprite centred on a point (pixels), `w` wide and `h` high (as high as its shape
	 * makes it without); false while the sprites are still loading
	 */
	function sprite(name: SpriteName, x: number, y: number, w: number, h?: number) {
		const image = sprites();
		if (!image) return false;
		const [fx, fy, fw, fh] = SPRITES[name];
		const high = h ?? (w * fh) / fw;
		ctx.drawImage(image, fx, fy, fw, fh, x - w / 2, y - high / 2, w, high);
		return true;
	}

	function spawn(p: Partial<Particle> & { x: number; y: number }) {
		particles.push({
			vx: 0,
			vy: 0,
			life: 0,
			max: 0.5,
			size: 0.15,
			color: '#ffffff',
			kind: 'square',
			gravity: 0,
			spin: 0,
			...p
		});
		if (particles.length > 600) particles.splice(0, particles.length - 600);
	}

	/** Something happened: effects for it */
	function event(name: string, state: PlayerState, icon: Icon) {
		const { x, y } = state;
		if (name === 'death') {
			shake = 1;
			for (let i = 0; i < 34; i++) {
				const a = Math.random() * Math.PI * 2;
				const v = 3 + Math.random() * 9;
				spawn({
					x,
					y,
					vx: Math.cos(a) * v,
					vy: Math.sin(a) * v,
					max: 0.5 + Math.random() * 0.5,
					size: 0.12 + Math.random() * 0.22,
					color: i % 3 ? icon.primary : icon.secondary,
					gravity: -12,
					spin: (Math.random() - 0.5) * 20
				});
			}
			spawn({ x, y, kind: 'ring', max: 0.45, size: 2.6, color: '#ffffff' });
			spawn({ x, y, kind: 'glow', max: 0.35, size: 2.2, color: icon.primary });
		} else if (name === 'orb' || name === 'pad') {
			spawn({ x, y, kind: 'ring', max: 0.35, size: 1.6, color: '#fff3a0' });
		} else if (name === 'portal') {
			flash = 1;
			flashColor = '#ffffff';
			spawn({ x, y, kind: 'ring', max: 0.5, size: 3.2, color: '#ffffff' });
		} else if (name === 'land' && state.mode === 'cube') {
			for (let i = 0; i < 5; i++)
				spawn({
					x: x - 0.4 + Math.random() * 0.4,
					y: y - state.gravity * 0.5,
					vx: -2 - Math.random() * 3,
					vy: state.gravity * (1 + Math.random() * 2),
					max: 0.3,
					size: 0.08 + Math.random() * 0.08,
					color: 'rgba(255,255,255,0.8)'
				});
		} else if (name === 'checkpoint') {
			spawn({ x, y, kind: 'ring', max: 0.5, size: 1.8, color: '#5dff8b' });
		} else if (name === 'complete') {
			flash = 1;
			flashColor = '#ffffff';
			for (let i = 0; i < 60; i++) {
				const a = Math.random() * Math.PI * 2;
				const v = 2 + Math.random() * 10;
				spawn({
					x,
					y,
					vx: Math.cos(a) * v,
					vy: Math.sin(a) * v,
					max: 0.8 + Math.random() * 0.8,
					size: 0.1 + Math.random() * 0.18,
					color: ['#ffe14d', '#ffffff', icon.primary, icon.secondary][i % 4],
					gravity: -5,
					spin: (Math.random() - 0.5) * 10
				});
			}
		}
	}

	/** Restarting: no effects left over */
	function reset(state: PlayerState) {
		particles = particles.filter((p) => p.kind === 'ring' || p.kind === 'glow');
		trail = [];
		camX = state.x - (width * 0.3) / scale;
		shake = 0;
		shipAngle = 0;
		lastMode = state.mode;
	}

	// --- Colours --------------------------------------------------------------------------

	function paletteAt(level: Level, time: number): Palette {
		const sections = level.world.sections;
		const section = level.world.sectionAt(time);
		const current = PALETTES[section.palette];
		const before = sections[section.index - 1];
		const f = before ? ease((time - section.start) / 700) : 1;
		if (!before || f >= 1) return current;
		const old = PALETTES[before.palette];
		return {
			top: mix(old.top, current.top, f),
			bottom: mix(old.bottom, current.bottom, f),
			ground: mix(old.ground, current.ground, f),
			accent: mix(old.accent, current.accent, f)
		};
	}

	function beatPulse(level: Level, time: number) {
		const beats = level.beats;
		let low = 0;
		let high = beats.length - 1;
		if (!beats.length || time < beats[0].time) return 0;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (beats[mid].time <= time) low = mid;
			else high = mid - 1;
		}
		const beat = beats[low];
		const strength = beat.downbeat ? 1 : 0.6;
		return strength * Math.exp(-(time - beat.time) / 140);
	}

	// --- The scene ------------------------------------------------------------------------

	function background(p: Palette, pulse: number, kiai: boolean) {
		const gradient = ctx.createLinearGradient(0, 0, 0, height);
		gradient.addColorStop(0, p.top);
		gradient.addColorStop(1, p.bottom);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, width, height);
		if (kiai && pulse > 0.02) {
			ctx.fillStyle = `rgba(255,255,255,${pulse * 0.06})`;
			ctx.fillRect(0, 0, width, height);
		}
		// A big tiled wall far away, like the genre's backgrounds
		const size = scale * 4;
		const offset = (((camX * 0.1 * scale) % size) + size) % size;
		const offsetY = (((camY * 0.1 * scale) % size) + size) % size;
		const column0 = Math.floor((camX * 0.1 * scale) / size);
		for (let c = -1; c < width / size + 2; c++) {
			for (let r = -1; r < height / size + 2; r++) {
				const x = c * size - offset;
				const y = r * size + offsetY - size;
				const n = noise((column0 + c) * 3.7 + r * 11.3);
				ctx.fillStyle = `rgba(0,0,0,${0.05 + n * 0.08})`;
				ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
				ctx.strokeStyle = `rgba(255,255,255,${0.05 + (n > 0.85 ? pulse * 0.12 : 0)})`;
				ctx.lineWidth = Math.max(1, scale * 0.05);
				ctx.strokeRect(x + size * 0.18, y + size * 0.18, size * 0.64, size * 0.64);
			}
		}
		// Light from below, on the beat
		const glow = ctx.createLinearGradient(0, height * 0.35, 0, height);
		glow.addColorStop(0, 'rgba(255,255,255,0)');
		glow.addColorStop(1, `rgba(255,255,255,${0.05 + pulse * (kiai ? 0.1 : 0.04)})`);
		ctx.fillStyle = glow;
		ctx.fillRect(0, height * 0.35, width, height * 0.65);
	}

	/** Gears turning far behind, little squares floating up, rings on the beat in the kiai */
	function decorations(p: Palette, time: number, pulse: number, kiai: boolean) {
		// Gears (dark, slow, behind everything)
		const spacing = 9;
		const speed = 0.35;
		const offset = camX * speed;
		const first = Math.floor(offset / spacing) - 1;
		for (let k = first; k < first + width / scale / spacing + 3; k++) {
			const n = noise(k * 5.1 + 2);
			if (n < 0.45) continue;
			const cx = (k * spacing - offset + n * 3) * scale;
			const cy = height * (0.25 + noise(k * 9.7) * 0.4);
			const r = scale * (1.2 + n * 1.6);
			const teeth = 8 + Math.floor(n * 6);
			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate(((time / 1000) * (k % 2 ? 0.4 : -0.4) * (1 + pulse * 0.6)) % (Math.PI * 2));
			ctx.beginPath();
			for (let t = 0; t < teeth * 2; t++) {
				const a = (t / (teeth * 2)) * Math.PI * 2;
				const rr = t % 2 ? r * 0.82 : r;
				ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
			}
			ctx.closePath();
			ctx.moveTo(r * 0.35, 0);
			ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2, true);
			ctx.fillStyle = rgba(mix(p.bottom, '#000000', 0.3), 0.25);
			ctx.fill('evenodd');
			ctx.strokeStyle = rgba(p.accent, 0.08 + pulse * 0.08);
			ctx.lineWidth = Math.max(1, scale * 0.05);
			ctx.stroke();
			ctx.restore();
		}
		// Little squares floating up
		for (let k = 0; k < 26; k++) {
			const n = noise(k * 3.3 + 1);
			const life = ((time / 1000) * (0.08 + n * 0.08) + n) % 1;
			const x = (((noise(k * 7.1) * width * 1.3 - camX * scale * 0.15) % width) + width) % width;
			const y = height * (1 - life);
			const sz = scale * (0.08 + n * 0.14);
			ctx.fillStyle = rgba('#ffffff', 0.12 * Math.sin(life * Math.PI) + (kiai ? pulse * 0.1 : 0));
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(life * 6 + k);
			ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
			ctx.restore();
		}
		// In the kiai, a ring from the middle on every strong beat
		if (kiai && pulse > 0.05) {
			const r = (1 - pulse) * Math.max(width, height) * 0.6;
			ctx.beginPath();
			ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
			ctx.strokeStyle = rgba('#ffffff', pulse * 0.12);
			ctx.lineWidth = scale * 0.5 * pulse;
			ctx.stroke();
		}
	}

	/** Hills far away behind the level, and in the kiai beams of light on the beat */
	function scenery(p: Palette, floor: number, pulse: number, kiai: boolean) {
		const base = sy(floor);
		const layers = [
			{ speed: 0.25, cell: 7, high: 4.2, color: mix(p.bottom, p.top, 0.35), alpha: 0.55 },
			{ speed: 0.5, cell: 4.5, high: 2.6, color: mix(p.bottom, '#000000', 0.25), alpha: 0.7 }
		];
		if (kiai) {
			const spacing = 6;
			const offset = camX * 0.6;
			const first = Math.floor(offset / spacing);
			for (let k = first; k < first + width / scale / spacing + 2; k++) {
				const bx = (k * spacing - offset) * scale;
				const beam = ctx.createLinearGradient(0, base, 0, 0);
				beam.addColorStop(0, rgba(p.accent, 0.08 + pulse * 0.22));
				beam.addColorStop(1, rgba(p.accent, 0));
				ctx.fillStyle = beam;
				ctx.fillRect(bx - scale * 0.35, 0, scale * 0.7, base);
			}
		}
		for (const layer of layers) {
			const offset = camX * layer.speed;
			const first = Math.floor(offset / layer.cell) - 1;
			ctx.beginPath();
			ctx.moveTo(-10, height);
			for (let k = first; k < first + width / scale / layer.cell + 3; k++) {
				const x = (k * layer.cell - offset) * scale;
				const h = (0.35 + noise(k * 3.1 + layer.cell) * 0.65) * layer.high * scale;
				const nx = ((k + 1) * layer.cell - offset) * scale;
				ctx.lineTo(x, base - h * 0.4);
				ctx.quadraticCurveTo((x + nx) / 2, base - h * 1.6, nx, base - h * 0.4);
			}
			ctx.lineTo(width + 10, height);
			ctx.closePath();
			ctx.globalAlpha = layer.alpha;
			ctx.fillStyle = layer.color;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
	}

	function ground(p: Palette, y: number, side: 1 | -1, pulse: number, scroll: number) {
		const line = sy(y);
		const top = side === 1 ? line : 0;
		const bottom = side === 1 ? height : line;
		if (bottom - top <= 0) return;
		const gradient = ctx.createLinearGradient(0, line, 0, line + side * scale * 4);
		gradient.addColorStop(0, mix(p.ground, '#000000', 0.12));
		gradient.addColorStop(1, mix(p.ground, '#000000', 0.7));
		ctx.fillStyle = gradient;
		ctx.fillRect(0, top, width, bottom - top);
		// Squares in the ground
		const size = scale * 2;
		const offset = (((scroll * scale) % size) + size) % size;
		ctx.strokeStyle = 'rgba(0,0,0,0.18)';
		ctx.lineWidth = Math.max(1, scale * 0.06);
		for (let x = -offset; x < width + size; x += size) {
			for (let k = 0; k < 3; k++) {
				const ry =
					side === 1 ? line + k * size + size * 0.15 : line - (k + 1) * size + size * 0.85 - size;
				ctx.strokeRect(x + size * 0.12, ry, size * 0.76, size * 0.76);
			}
		}
		// The bright line on top
		const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
		lineGradient.addColorStop(0, 'rgba(255,255,255,0)');
		lineGradient.addColorStop(0.5, `rgba(255,255,255,${0.85 + pulse * 0.15})`);
		lineGradient.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = lineGradient;
		const thick = Math.max(2, scale * 0.06);
		ctx.fillRect(0, line - thick / 2, width, thick);
		ctx.fillStyle = `rgba(255,255,255,${0.12 + pulse * 0.12})`;
		ctx.fillRect(0, side === 1 ? line : line - scale * 0.35, width, scale * 0.35);
		const halo = ctx.createLinearGradient(0, line, 0, line - side * scale * 1.2);
		halo.addColorStop(0, rgba(p.accent, 0.22 + pulse * 0.2));
		halo.addColorStop(1, rgba(p.accent, 0));
		ctx.fillStyle = halo;
		ctx.fillRect(0, side === 1 ? line - scale * 1.2 : line, width, scale * 1.2);
	}

	/**
	 * One block, drawn once per size and colour and then stamped: a bevelled tile. The size goes
	 * in powers of two and the colour in coarse steps, so the beat's zoom and a palette fading
	 * into the next don't make a new one every frame.
	 */
	const tileCache = new Map<string, HTMLCanvasElement>();
	function tile(p: Palette) {
		const size = Math.max(16, 2 ** Math.ceil(Math.log2(scale)));
		const accent = `#${hex(p.accent)
			.map((v) => Math.min(255, Math.round(v / 24) * 24).toString(16).padStart(2, '0'))
			.join('')}`;
		const key = `${size}:${accent}`;
		const cached = tileCache.get(key);
		if (cached) return cached;
		if (tileCache.size > 24) tileCache.clear();
		p = { ...p, accent };
		const c = document.createElement('canvas');
		c.width = size;
		c.height = size;
		const t = c.getContext('2d')!;
		// Indigo with a lighter square in it and a cool light on the top left (as the sprites)
		const g = t.createLinearGradient(0, 0, 0, size);
		g.addColorStop(0, '#24245f');
		g.addColorStop(1, '#16163c');
		t.fillStyle = g;
		t.fillRect(0, 0, size, size);
		// The bevel: light on top and left, dark on the other sides
		const b = size * 0.1;
		t.fillStyle = 'rgba(154,224,241,0.2)';
		t.beginPath();
		t.moveTo(0, 0);
		t.lineTo(size, 0);
		t.lineTo(size - b, b);
		t.lineTo(b, b);
		t.lineTo(b, size - b);
		t.lineTo(0, size);
		t.closePath();
		t.fill();
		t.fillStyle = 'rgba(0,0,0,0.35)';
		t.beginPath();
		t.moveTo(size, size);
		t.lineTo(0, size);
		t.lineTo(b, size - b);
		t.lineTo(size - b, size - b);
		t.lineTo(size - b, b);
		t.lineTo(size, 0);
		t.closePath();
		t.fill();
		// The inner square
		t.fillStyle = rgba(mix('#46448b', p.accent, 0.3), 0.9);
		t.fillRect(size * 0.26, size * 0.26, size * 0.48, size * 0.48);
		t.strokeStyle = rgba(p.accent, 0.3);
		t.lineWidth = Math.max(1, size * 0.03);
		t.strokeRect(size * 0.26, size * 0.26, size * 0.48, size * 0.48);
		// The edge between tiles
		t.strokeStyle = 'rgba(0,0,0,0.6)';
		t.lineWidth = Math.max(1, size * 0.03);
		t.strokeRect(0, 0, size, size);
		tileCache.set(key, c);
		return c;
	}

	function solid(
		x0: number,
		x1: number,
		y0: number,
		y1: number,
		p: Palette,
		pulse: number,
		style: number
	) {
		const left = sx(x0);
		const right = sx(x1);
		const top = sy(y1);
		const bottom = sy(y0);
		if (right - left <= 0 || bottom - top <= 0) return;
		const image = tile(p);
		ctx.save();
		ctx.beginPath();
		ctx.rect(left, top, right - left, bottom - top);
		ctx.clip();
		const fromX = Math.max(Math.floor(x0), Math.floor(camX) - 1);
		const toX = Math.min(Math.ceil(x1), Math.ceil(camX + width / scale) + 1);
		for (let y = Math.floor(y0); y < y1; y++) {
			const ty = sy(y + 1);
			if (ty > height || ty + scale < 0) continue;
			for (let x = fromX; x < toX; x++) {
				const tx = sx(x);
				ctx.drawImage(image, tx, ty, scale + 0.6, scale + 0.6);
				// Some blocks light up on the beat
				const n = noise(x * 7.3 + y * 13.1);
				if (n < 0.1) {
					ctx.fillStyle = rgba(p.accent, 0.15 + pulse * 0.45);
					ctx.fillRect(tx + scale * 0.3, ty + scale * 0.3, scale * 0.4, scale * 0.4);
				}
			}
		}
		ctx.restore();
		// Floating platforms: chains holding them up
		if (style === 1) {
			ctx.strokeStyle = rgba('#ffffff', 0.25);
			ctx.lineWidth = Math.max(1, scale * 0.05);
			for (let x = Math.ceil(x0) + 0.5; x < x1; x += 3) {
				if (x < camX - 1 || x > camX + width / scale + 1) continue;
				for (let k = 0; k < 9; k++) {
					const cy = sy(y1) - scale * (0.3 + k * 0.4);
					ctx.beginPath();
					if (k % 2) ctx.ellipse(sx(x), cy, scale * 0.04, scale * 0.17, 0, 0, Math.PI * 2);
					else ctx.ellipse(sx(x), cy, scale * 0.1, scale * 0.17, 0, 0, Math.PI * 2);
					ctx.stroke();
				}
			}
		}
	}

	/** The outline of touching blocks as one shape: only the edges nothing else covers */
	function outlines(list: Solid[], section: Section, p: Palette, pulse: number, glow: boolean) {
		const EPS = 1e-6;
		const shines: { x0: number; x1: number; y: number; down: boolean }[] = [];
		const minus = (from: number, to: number, cuts: [number, number][]) => {
			let parts: [number, number][] = [[from, to]];
			for (const [a, b] of cuts)
				parts = parts.flatMap(([p0, p1]) => {
					if (b <= p0 + EPS || a >= p1 - EPS) return [[p0, p1]] as [number, number][];
					const out: [number, number][] = [];
					if (a > p0 + EPS) out.push([p0, a]);
					if (b < p1 - EPS) out.push([b, p1]);
					return out;
				});
			return parts;
		};
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = Math.max(1.5, scale * 0.07);
		ctx.lineCap = 'square';
		ctx.beginPath();
		for (const a of list) {
			const touching = list.filter((b) => b !== a);
			// Top and bottom
			for (const [y, other] of [
				[a.y1, 'y0'],
				[a.y0, 'y1']
			] as const) {
				if (Math.abs(y - section.floor) < EPS) continue;
				if (section.ceil !== null && Math.abs(y - section.ceil) < EPS) continue;
				if (y <= 0 + EPS && section.ceil === null) continue;
				const cuts = touching
					.filter((b) => Math.abs(b[other] - y) < EPS)
					.map((b) => [b.x0, b.x1] as [number, number]);
				for (const [p0, p1] of minus(a.x0, a.x1, cuts)) {
					ctx.moveTo(sx(p0), sy(y));
					ctx.lineTo(sx(p1), sy(y));
					shines.push({ x0: p0, x1: p1, y, down: other === 'y0' });
				}
			}
			// Left and right
			for (const [x, other] of [
				[a.x0, 'x1'],
				[a.x1, 'x0']
			] as const) {
				const cuts = touching
					.filter((b) => Math.abs(b[other] - x) < EPS)
					.map((b) => [b.y0, b.y1] as [number, number]);
				for (const [p0, p1] of minus(a.y0, a.y1, cuts)) {
					ctx.moveTo(sx(x), sy(p0));
					ctx.lineTo(sx(x), sy(p1));
				}
			}
		}
		const base = Math.max(1.5, scale * 0.07);
		if (glow) {
			// The outline's glow, behind the blocks (more on the beat)
			ctx.strokeStyle = rgba(p.accent, 0.14 + pulse * 0.12);
			ctx.lineWidth = base * 7;
			ctx.stroke();
			ctx.strokeStyle = rgba(p.accent, 0.3 + pulse * 0.2);
			ctx.lineWidth = base * 3.5;
			ctx.stroke();
			return;
		}
		// A light inside along the open tops (and bottoms), then the white line
		const depth = scale * 0.6;
		for (const sh of shines) {
			const y = sy(sh.y);
			const g = ctx.createLinearGradient(0, y, 0, sh.down ? y + depth : y - depth);
			g.addColorStop(0, rgba(p.accent, 0.14 + pulse * 0.16));
			g.addColorStop(1, rgba(p.accent, 0));
			ctx.fillStyle = g;
			ctx.fillRect(sx(sh.x0), sh.down ? y : y - depth, sx(sh.x1) - sx(sh.x0), depth);
		}
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = base;
		ctx.stroke();
	}

	function spike(x: number, y: number, dir: 1 | -1, small: boolean, p: Palette, pulse: number) {
		const h = (small ? 0.5 : 1) * dir;
		const w = small ? 0.42 : 0.5;
		ctx.save();
		ctx.translate(sx(x), sy(y));
		ctx.scale(1, dir);
		const drawn = small
			? sprite('spikeSmall', 0, -scale * 0.28, scale * 0.9, scale * 0.58)
			: sprite('spike', 0, -scale * 0.51, scale * 1.04, scale * 1.04);
		ctx.restore();
		if (drawn) {
			// It lights up on the beat
			ctx.beginPath();
			ctx.moveTo(sx(x - w * 0.4), sy(y + h * 0.14));
			ctx.lineTo(sx(x), sy(y + h * 0.58));
			ctx.lineTo(sx(x + w * 0.4), sy(y + h * 0.14));
			ctx.closePath();
			ctx.fillStyle = rgba(p.accent, pulse * 0.3);
			ctx.fill();
			return;
		}
		ctx.beginPath();
		ctx.moveTo(sx(x - w), sy(y));
		ctx.lineTo(sx(x), sy(y + h * 0.98));
		ctx.lineTo(sx(x + w), sy(y));
		ctx.closePath();
		const gradient = ctx.createLinearGradient(0, sy(y + h), 0, sy(y));
		gradient.addColorStop(0, '#1a1530');
		gradient.addColorStop(1, '#000000');
		ctx.fillStyle = gradient;
		ctx.fill();
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = Math.max(1.5, scale * 0.06);
		ctx.lineJoin = 'round';
		ctx.stroke();
		// The light in it
		ctx.beginPath();
		ctx.moveTo(sx(x - w * 0.45), sy(y + h * 0.12));
		ctx.lineTo(sx(x), sy(y + h * 0.62));
		ctx.lineTo(sx(x + w * 0.45), sy(y + h * 0.12));
		ctx.closePath();
		ctx.fillStyle = rgba(p.accent, 0.28 + pulse * 0.35);
		ctx.fill();
	}

	/** A saw: a toothed disc turning in the surface (only what's above it shows) */
	function saw(x: number, y: number, radius: number, p: Palette, pulse: number, time: number) {
		const r = radius * scale;
		ctx.save();
		ctx.translate(sx(x), sy(y));
		ctx.beginPath();
		ctx.rect(-r * 2, -r * 2, r * 4, r * 2);
		ctx.clip();
		const halo = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.6);
		halo.addColorStop(0, rgba(p.accent, 0.22 + pulse * 0.25));
		halo.addColorStop(1, rgba(p.accent, 0));
		ctx.fillStyle = halo;
		ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 1.6);
		ctx.rotate((time / 1000) * 5);
		if (sprite(radius >= 1 ? 'sawBig' : 'saw', 0, 0, r * 2.15, r * 2.15)) {
			ctx.restore();
			return;
		}
		const teeth = 14;
		ctx.beginPath();
		for (let k = 0; k < teeth * 2; k++) {
			const a = (k / (teeth * 2)) * Math.PI * 2;
			const reach = k % 2 ? r * 0.8 : r;
			if (k) ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
			else ctx.moveTo(reach, 0);
		}
		ctx.closePath();
		ctx.fillStyle = '#120f1f';
		ctx.fill();
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = Math.max(1.5, scale * 0.06);
		ctx.lineJoin = 'round';
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
		ctx.strokeStyle = rgba(p.accent, 0.55 + pulse * 0.35);
		ctx.stroke();
		for (let k = 0; k < 3; k++) {
			const a = (k / 3) * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
			ctx.lineTo(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46);
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
		ctx.fillStyle = rgba(p.accent, 0.9);
		ctx.fill();
		ctx.restore();
	}

	function orb(x: number, y: number, kind: string, used: boolean, time: number, pulse: number) {
		const colors: Record<string, [string, string]> = {
			yellow: ['#ffe14d', '#fff8c2'],
			pink: ['#ff5ec4', '#ffd0ef'],
			blue: ['#3ad7ff', '#d2f6ff'],
			red: ['#ff3b3b', '#ffc2c2'],
			green: ['#4dff6a', '#d4ffd9'],
			black: ['#1b1b24', '#8a8aa0']
		};
		const [main, light] = colors[kind] ?? colors.yellow;
		const r = (0.42 + pulse * 0.05) * scale;
		const cx = sx(x);
		const cy = sy(y);
		const halo = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.4);
		halo.addColorStop(0, rgba(main, used ? 0.15 : 0.55));
		halo.addColorStop(1, rgba(main, 0));
		ctx.fillStyle = halo;
		ctx.fillRect(cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
		const look = ORB_SPRITES[kind];
		if (look) {
			ctx.globalAlpha = used ? 0.35 : 1;
			const drawn = sprite(look, cx, cy, r * 2.9);
			ctx.globalAlpha = 1;
			if (drawn) return;
		}
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		const fill = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
		fill.addColorStop(0, light);
		fill.addColorStop(1, main);
		ctx.fillStyle = used ? rgba(main, 0.35) : fill;
		ctx.fill();
		ctx.lineWidth = Math.max(2, scale * 0.08);
		ctx.strokeStyle = '#000000';
		ctx.stroke();
		// A ring that turns
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(time / 500);
		ctx.strokeStyle = rgba(light, used ? 0.2 : 0.9);
		ctx.lineWidth = Math.max(1.5, scale * 0.05);
		for (let k = 0; k < 4; k++) {
			ctx.beginPath();
			ctx.arc(0, 0, r * 1.45, (k * Math.PI) / 2, (k * Math.PI) / 2 + 0.9);
			ctx.stroke();
		}
		ctx.restore();
	}

	function pad(x: number, y: number, dir: 1 | -1, kind: string, used: boolean, pulse: number) {
		const main =
			kind === 'pink'
				? '#ff5ec4'
				: kind === 'red'
					? '#ff3b3b'
					: kind === 'blue'
						? '#3ad7ff'
						: '#ffe14d';
		const cx = sx(x);
		const base = sy(y);
		const w = 0.48 * scale;
		const h = (0.24 + pulse * 0.04) * scale * dir;
		const look = PAD_SPRITES[kind];
		if (look && sprites()) {
			const glow = ctx.createLinearGradient(0, base, 0, base - dir * scale * 1.6);
			glow.addColorStop(0, rgba(main, used ? 0.1 : 0.4 + pulse * 0.2));
			glow.addColorStop(1, rgba(main, 0));
			ctx.fillStyle = glow;
			ctx.fillRect(cx - w, Math.min(base, base - dir * scale * 1.6), w * 2, scale * 1.6);
			ctx.save();
			ctx.translate(cx, base);
			ctx.scale(1, dir);
			ctx.globalAlpha = used ? 0.45 : 1;
			sprite(look, 0, -scale * 0.24, scale * 0.98, scale * 0.5);
			ctx.restore();
			return;
		}
		ctx.beginPath();
		ctx.moveTo(cx - w, base);
		ctx.quadraticCurveTo(cx, base - h * 2, cx + w, base);
		ctx.closePath();
		ctx.fillStyle = used ? rgba(main, 0.4) : main;
		ctx.fill();
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = Math.max(1.5, scale * 0.05);
		ctx.stroke();
		const glow = ctx.createLinearGradient(0, base, 0, base - dir * scale * 1.6);
		glow.addColorStop(0, rgba(main, used ? 0.1 : 0.4));
		glow.addColorStop(1, rgba(main, 0));
		ctx.fillStyle = glow;
		ctx.fillRect(cx - w, Math.min(base, base - dir * scale * 1.6), w * 2, scale * 1.6);
	}

	const ORB_SPRITES: Record<string, SpriteName> = {
		yellow: 'orbYellow',
		pink: 'orbPink',
		red: 'orbRed',
		blue: 'orbBlue',
		green: 'orbGreen',
		black: 'orbBlack'
	};
	/** (The sheet has no red and blue pads: those are drawn) */
	const PAD_SPRITES: Record<string, SpriteName> = { yellow: 'padYellow', pink: 'padPink' };
	const PORTAL_SPRITES: Record<Mode, SpriteName> = {
		cube: 'portalCube',
		ship: 'portalShip',
		ball: 'portalBall',
		wave: 'portalWave',
		ufo: 'portalUfo',
		swing: 'portalSwing',
		spider: 'portalSpider'
	};

	const PORTAL_COLORS: Record<Mode, string> = {
		cube: '#5dff5a',
		ship: '#ff4fd8',
		ball: '#ff9a1f',
		wave: '#3ad7ff',
		ufo: '#ffd93d',
		swing: '#ffe14d',
		spider: '#b14dff'
	};

	function portal(
		x: number,
		y: number,
		color: string,
		time: number,
		label: string,
		look?: SpriteName
	) {
		const cx = sx(x);
		const cy = sy(y);
		const rx = 0.45 * scale;
		const ry = 1.55 * scale;
		const halo = ctx.createRadialGradient(cx, cy, ry * 0.2, cx, cy, ry * 1.4);
		halo.addColorStop(0, rgba(color, 0.35));
		halo.addColorStop(1, rgba(color, 0));
		ctx.fillStyle = halo;
		ctx.fillRect(cx - ry * 1.4, cy - ry * 1.4, ry * 2.8, ry * 2.8);
		const [, , fw, fh] = look ? SPRITES[look] : [0, 0, 1, 1];
		if (!look || !sprite(look, cx, cy, (ry * 2.2 * fw) / fh, ry * 2.2))
			for (const [w, c, lw] of [
				[1, '#000000', 0.32],
				[1, color, 0.2],
				[0.62, rgba('#ffffff', 0.85), 0.07]
			] as const) {
				ctx.beginPath();
				ctx.ellipse(cx, cy, rx * w, ry * w, 0, 0, Math.PI * 2);
				ctx.strokeStyle = c;
				ctx.lineWidth = scale * lw;
				ctx.stroke();
			}
		// Sparks drawn in
		for (let k = 0; k < 6; k++) {
			const f = (((time / 700 + k / 6) % 1) + 1) % 1;
			const a = k * 1.7 + 0.3;
			const d = (1 - f) * 1.6;
			ctx.fillStyle = rgba(color, f);
			const px = cx + Math.cos(a) * d * scale * 0.6;
			const py = cy + Math.sin(a) * d * scale * 1.1;
			ctx.fillRect(px - scale * 0.06, py - scale * 0.06, scale * 0.12, scale * 0.12);
		}
		if (label) {
			ctx.fillStyle = '#ffffff';
			ctx.font = `800 ${Math.round(scale * 0.32)}px Figtree Variable, sans-serif`;
			ctx.textAlign = 'center';
			ctx.fillText(label, cx, cy - ry - scale * 0.25);
		}
	}

	function speedPortal(x: number, y: number, index: number) {
		const colors = ['#ffb347', '#5ad1ff', '#5dff8b', '#ff5ec4', '#ff4040'];
		const color = colors[index] ?? '#ffffff';
		const arrows = index === 0 ? 1 : index;
		const cx = sx(x);
		const cy = sy(y);
		ctx.lineJoin = 'round';
		for (let k = 0; k < arrows; k++) {
			const ox = cx + (k - (arrows - 1) / 2) * scale * 0.42;
			ctx.beginPath();
			const dir = index === 0 ? -1 : 1;
			ctx.moveTo(ox - dir * scale * 0.25, cy - scale * 0.6);
			ctx.lineTo(ox + dir * scale * 0.2, cy);
			ctx.lineTo(ox - dir * scale * 0.25, cy + scale * 0.6);
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = scale * 0.3;
			ctx.stroke();
			ctx.strokeStyle = color;
			ctx.lineWidth = scale * 0.17;
			ctx.stroke();
		}
	}

	function walls(
		walls: Level['world']['walls']['items'][number],
		section: Section,
		p: Palette,
		pulse: number
	) {
		const top = section.ceil ?? 9;
		const from = Math.max(walls.x0, camX - 1);
		const to = Math.min(walls.x1, camX + width / scale + 1);
		if (to <= from) return;
		const xs: number[] = [from];
		for (const x of walls.xs) if (x > from && x < to) xs.push(x);
		xs.push(to);
		for (const side of ['lo', 'hi'] as const) {
			ctx.beginPath();
			const edge = side === 'lo' ? section.floor - 0.1 : top + 0.1;
			ctx.moveTo(sx(from), sy(edge));
			for (const x of xs) {
				const at = wallAt(walls, x)[side];
				ctx.lineTo(sx(x), sy(side === 'lo' ? Math.max(edge, at) : Math.min(edge, at)));
			}
			ctx.lineTo(sx(to), sy(edge));
			ctx.closePath();
			const image = tile(p);
			const pattern = ctx.createPattern(image, 'repeat');
			if (pattern) {
				const k = scale / image.width;
				pattern.setTransform(new DOMMatrix([k, 0, 0, k, sx(0), sy(0)]));
				ctx.fillStyle = pattern;
			} else ctx.fillStyle = '#0b0918';
			ctx.fill();
			ctx.save();
			ctx.clip();
			// The slopes' blocks
			ctx.strokeStyle = rgba(p.accent, 0.12);
			ctx.lineWidth = Math.max(1, scale * 0.035);
			ctx.beginPath();
			for (let y = Math.ceil(section.floor); y < top; y++) {
				ctx.moveTo(sx(from), sy(y));
				ctx.lineTo(sx(to), sy(y));
			}
			ctx.stroke();
			ctx.restore();
			// The edge
			ctx.beginPath();
			xs.forEach((x, k) => {
				const at = wallAt(walls, x)[side];
				const y = side === 'lo' ? Math.max(edge, at) : Math.min(edge, at);
				if (k) ctx.lineTo(sx(x), sy(y));
				else ctx.moveTo(sx(x), sy(y));
			});
			ctx.strokeStyle = rgba(p.accent, 0.5 + pulse * 0.3);
			ctx.lineWidth = scale * 0.22;
			ctx.stroke();
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = Math.max(1.5, scale * 0.07);
			ctx.stroke();
		}
	}

	// --- The player -------------------------------------------------------------------------

	function cubeShape(size: number, icon: Icon) {
		const s = size * scale;
		const r = s * 0.08;
		const round = (x: number, y: number, w: number, h: number, radius: number) => {
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, radius);
		};
		round(-s / 2, -s / 2, s, s, r);
		ctx.fillStyle = icon.primary;
		ctx.fill();
		ctx.lineWidth = s * 0.09;
		ctx.strokeStyle = '#000000';
		ctx.stroke();
		round(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6, r * 0.6);
		ctx.fillStyle = icon.secondary;
		ctx.fill();
		ctx.lineWidth = s * 0.07;
		ctx.stroke();
		round(-s * 0.13, -s * 0.13, s * 0.26, s * 0.26, r * 0.4);
		ctx.fillStyle = icon.primary;
		ctx.fill();
		ctx.stroke();
		// A glint
		ctx.fillStyle = 'rgba(255,255,255,0.45)';
		ctx.fillRect(-s * 0.4, -s * 0.4, s * 0.18, s * 0.07);
	}

	function drawPlayer(state: PlayerState, icon: Icon, dt: number, time: number) {
		const cx = sx(state.x);
		const cy = sy(state.y);
		ctx.save();
		ctx.translate(cx, cy);
		const glow = ctx.createRadialGradient(0, 0, scale * 0.2, 0, 0, scale * 1.3);
		glow.addColorStop(0, rgba(icon.primary, 0.32));
		glow.addColorStop(1, rgba(icon.primary, 0));
		ctx.fillStyle = glow;
		ctx.fillRect(-scale * 1.3, -scale * 1.3, scale * 2.6, scale * 2.6);
		if (state.mini) ctx.scale(0.6, 0.6);
		// The sprites (the vehicles carry their own little cube); drawn by hand below while
		// they load
		if (sprites()) {
			const s = scale;
			if (state.mode === 'cube') {
				ctx.rotate(state.rotation);
				sprite(icon.sprite, 0, 0, s * 1.02, s * 1.02);
			} else if (state.mode === 'ship' || state.mode === 'swing') {
				const ship = state.mode === 'ship';
				const target = -Math.atan2(state.vy, ship ? 10 : 12) * (ship ? 0.85 : 0.6);
				shipAngle += (target - shipAngle) * Math.min(1, dt * (ship ? 18 : 14));
				ctx.rotate(shipAngle);
				if (state.gravity < 0) ctx.scale(1, -1);
				if (ship) sprite('ship', -s * 0.04, -s * 0.12, s * 1.55);
				else sprite('swing', 0, -s * 0.08, s * 1.4);
			} else if (state.mode === 'ufo' || state.mode === 'spider') {
				if (state.gravity < 0) ctx.scale(1, -1);
				if (state.mode === 'ufo') sprite('ufo', 0, -s * 0.08, s * 1.4);
				else sprite('spider', 0, -s * 0.02, s * 1.32);
			} else if (state.mode === 'ball') {
				ctx.rotate(state.rotation);
				sprite('ball', 0, 0, s * 1.1);
			} else {
				const up = state.held ? 1 : -1;
				ctx.rotate((-up * state.gravity * Math.PI) / 4);
				sprite('wave', -s * 0.1, 0, s * 1.05);
			}
			ctx.restore();
			return;
		}
		if (state.mode === 'cube') {
			ctx.rotate(state.rotation);
			cubeShape(1, icon);
		} else if (state.mode === 'ship') {
			const target = -Math.atan2(state.vy, 10) * 0.85;
			shipAngle += (target - shipAngle) * Math.min(1, dt * 18);
			ctx.rotate(shipAngle);
			if (state.gravity < 0) ctx.scale(1, -1);
			// The little cube riding it
			ctx.save();
			ctx.translate(-scale * 0.08, -scale * 0.3);
			cubeShape(0.52, icon);
			ctx.restore();
			const s = scale;
			ctx.beginPath();
			ctx.moveTo(-0.62 * s, 0.05 * s);
			ctx.lineTo(-0.45 * s, -0.12 * s);
			ctx.lineTo(0.2 * s, -0.12 * s);
			ctx.quadraticCurveTo(0.62 * s, -0.05 * s, 0.66 * s, 0.12 * s);
			ctx.lineTo(0.15 * s, 0.32 * s);
			ctx.lineTo(-0.5 * s, 0.32 * s);
			ctx.closePath();
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.lineWidth = s * 0.08;
			ctx.strokeStyle = '#000000';
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(-0.38 * s, 0.1 * s);
			ctx.lineTo(0.38 * s, 0.1 * s);
			ctx.lineTo(0.2 * s, 0.22 * s);
			ctx.lineTo(-0.38 * s, 0.22 * s);
			ctx.closePath();
			ctx.fillStyle = icon.secondary;
			ctx.fill();
			ctx.lineWidth = s * 0.05;
			ctx.stroke();
		} else if (state.mode === 'ufo') {
			if (state.gravity < 0) ctx.scale(1, -1);
			const s = scale;
			ctx.save();
			ctx.translate(0, -s * 0.18);
			cubeShape(0.5, icon);
			ctx.restore();
			// The glass dome and the saucer
			ctx.beginPath();
			ctx.arc(0, -s * 0.05, s * 0.36, Math.PI, 0);
			ctx.fillStyle = 'rgba(190,240,255,0.35)';
			ctx.fill();
			ctx.lineWidth = s * 0.06;
			ctx.strokeStyle = '#000000';
			ctx.stroke();
			ctx.beginPath();
			ctx.ellipse(0, s * 0.12, s * 0.62, s * 0.2, 0, 0, Math.PI * 2);
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.lineWidth = s * 0.08;
			ctx.stroke();
			ctx.beginPath();
			ctx.ellipse(0, s * 0.16, s * 0.4, s * 0.08, 0, 0, Math.PI * 2);
			ctx.fillStyle = icon.secondary;
			ctx.fill();
		} else if (state.mode === 'swing') {
			const target = -Math.atan2(state.vy, 12) * 0.6;
			shipAngle += (target - shipAngle) * Math.min(1, dt * 14);
			ctx.rotate(shipAngle);
			const s = scale;
			// Round body with fins that point the way it falls
			const fin = state.gravity > 0 ? 1 : -1;
			for (const side of [-1, 1]) {
				ctx.beginPath();
				ctx.moveTo(-s * 0.2, side * s * 0.3);
				ctx.lineTo(-s * 0.62, side * s * (0.3 + (side === fin ? 0.32 : 0.12)));
				ctx.lineTo(-s * 0.42, side * s * 0.12);
				ctx.closePath();
				ctx.fillStyle = icon.secondary;
				ctx.fill();
				ctx.lineWidth = s * 0.06;
				ctx.strokeStyle = '#000000';
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.lineWidth = s * 0.08;
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(s * 0.08, 0, s * 0.18, 0, Math.PI * 2);
			ctx.fillStyle = icon.secondary;
			ctx.fill();
			ctx.lineWidth = s * 0.05;
			ctx.stroke();
		} else if (state.mode === 'spider') {
			if (state.gravity < 0) ctx.scale(1, -1);
			const s = scale;
			// Legs that step as it runs
			const stepping = Math.sin(time / 45) * s * 0.08;
			ctx.lineWidth = s * 0.09;
			ctx.lineCap = 'round';
			for (const [x0, x1, phase] of [
				[-0.22, -0.5, 1],
				[-0.05, -0.2, -1],
				[0.1, 0.25, 1],
				[0.22, 0.52, -1]
			]) {
				ctx.beginPath();
				ctx.moveTo(x0 * s, s * 0.05);
				ctx.lineTo(((x0 + x1) / 2) * s + phase * stepping, s * 0.28);
				ctx.lineTo(x1 * s + phase * stepping, s * 0.5);
				ctx.strokeStyle = '#000000';
				ctx.lineWidth = s * 0.14;
				ctx.stroke();
				ctx.strokeStyle = icon.secondary;
				ctx.lineWidth = s * 0.07;
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.ellipse(0, -s * 0.05, s * 0.44, s * 0.3, 0, 0, Math.PI * 2);
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.lineWidth = s * 0.08;
			ctx.strokeStyle = '#000000';
			ctx.stroke();
			ctx.fillStyle = icon.secondary;
			ctx.fillRect(s * 0.1, -s * 0.15, s * 0.14, s * 0.1);
		} else if (state.mode === 'ball') {
			ctx.rotate(state.rotation);
			const r = hitbox('ball', state.mini).h * scale * 1.05;
			ctx.beginPath();
			ctx.arc(0, 0, r, 0, Math.PI * 2);
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.lineWidth = r * 0.16;
			ctx.strokeStyle = '#000000';
			ctx.stroke();
			for (let k = 0; k < 2; k++) {
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.arc(0, 0, r * 0.72, k * Math.PI, k * Math.PI + Math.PI / 2);
				ctx.closePath();
				ctx.fillStyle = icon.secondary;
				ctx.fill();
				ctx.lineWidth = r * 0.1;
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.stroke();
		} else {
			const up = state.held ? 1 : -1;
			ctx.rotate((-up * state.gravity * Math.PI) / 4);
			const s = scale * 0.62;
			ctx.beginPath();
			ctx.moveTo(s * 0.75, 0);
			ctx.lineTo(-s * 0.55, -s * 0.5);
			ctx.lineTo(-s * 0.3, 0);
			ctx.lineTo(-s * 0.55, s * 0.5);
			ctx.closePath();
			ctx.fillStyle = icon.primary;
			ctx.fill();
			ctx.lineWidth = s * 0.14;
			ctx.strokeStyle = '#000000';
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(s * 0.35, 0);
			ctx.lineTo(-s * 0.25, -s * 0.22);
			ctx.lineTo(-s * 0.12, 0);
			ctx.lineTo(-s * 0.25, s * 0.22);
			ctx.closePath();
			ctx.fillStyle = icon.secondary;
			ctx.fill();
		}
		ctx.restore();
		void time;
	}

	function drawTrail(state: PlayerState, icon: Icon, time: number) {
		const wave = state.mode === 'wave';
		const boosted = time - state.boostedAt < 450;
		trail.push({ x: state.x, y: state.y, time });
		const keep = wave ? 900 : 260;
		while (trail.length && time - trail[0].time > keep) trail.shift();
		if (trail.length < 2 || (!wave && !boosted && state.mode !== 'ship')) return;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		const width = wave ? 0.3 : 0.5;
		for (const [w, color] of [
			[width * 1.9, rgba(icon.primary, 0.25)],
			[width, wave ? icon.primary : rgba(icon.secondary, 0.6)]
		] as const) {
			ctx.beginPath();
			trail.forEach((p, k) => {
				if (k) ctx.lineTo(sx(p.x), sy(p.y));
				else ctx.moveTo(sx(p.x), sy(p.y));
			});
			ctx.strokeStyle = color;
			ctx.lineWidth = w * scale * (wave ? 1 : 0.6);
			ctx.stroke();
		}
	}

	function updateParticles(dt: number, state: PlayerState, icon: Icon, frame: Frame) {
		// The dust it kicks up, the ship's fire
		if (!frame.dead && !frame.waiting && frame.hud) {
			emit += dt;
			const every = state.mode === 'ship' ? 1 / 70 : 1 / 30;
			while (emit > every) {
				emit -= every;
				if (state.mode === 'ship') {
					const a = shipAngle;
					spawn({
						x: state.x - Math.cos(a) * 0.6,
						y: state.y + Math.sin(a) * 0.6 - 0.05,
						vx: -4 - Math.random() * 3,
						vy: (Math.random() - 0.5) * 2 + (state.held ? -2 : 0),
						max: 0.3,
						size: 0.12 + Math.random() * 0.12,
						color: Math.random() < 0.5 ? '#ffb347' : icon.secondary,
						kind: 'glow'
					});
				} else if (state.grounded && (state.mode === 'cube' || state.mode === 'ball')) {
					spawn({
						x: state.x - 0.45,
						y: state.y - state.gravity * 0.45,
						vx: -1.5 - Math.random() * 2,
						vy: state.gravity * (0.5 + Math.random() * 1.5),
						max: 0.35,
						size: 0.06 + Math.random() * 0.08,
						color: 'rgba(255,255,255,0.7)'
					});
				}
			}
		}
		for (const p of particles) {
			p.life += dt;
			p.vy += p.gravity * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
		}
		particles = particles.filter((p) => p.life < p.max);
	}

	function drawParticles() {
		for (const p of particles) {
			const f = p.life / p.max;
			const alpha = 1 - f;
			const x = sx(p.x);
			const y = sy(p.y);
			if (p.kind === 'ring') {
				ctx.beginPath();
				ctx.arc(x, y, p.size * scale * ease(f), 0, Math.PI * 2);
				ctx.strokeStyle = rgba(p.color, alpha * 0.9);
				ctx.lineWidth = scale * 0.12 * (1 - f) + 1;
				ctx.stroke();
			} else if (p.kind === 'glow') {
				const r = p.size * scale * (1 + f);
				const g = ctx.createRadialGradient(x, y, 0, x, y, r);
				g.addColorStop(0, rgba(p.color.startsWith('#') ? p.color : '#ffffff', alpha * 0.8));
				g.addColorStop(1, rgba(p.color.startsWith('#') ? p.color : '#ffffff', 0));
				ctx.fillStyle = g;
				ctx.fillRect(x - r, y - r, r * 2, r * 2);
			} else {
				const s = p.size * scale * (1 - f * 0.5);
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(p.spin * p.life);
				ctx.globalAlpha = alpha;
				ctx.fillStyle = p.color;
				ctx.fillRect(-s / 2, -s / 2, s, s);
				ctx.restore();
			}
		}
		ctx.globalAlpha = 1;
	}

	// --- Text and the bar -----------------------------------------------------------------

	function worldText(text: string, x: number, y: number, size: number, alpha = 1) {
		ctx.font = `900 ${Math.round(size * scale)}px Figtree Variable, sans-serif`;
		ctx.textAlign = 'left';
		ctx.lineJoin = 'round';
		ctx.lineWidth = size * scale * 0.18;
		ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.85})`;
		ctx.strokeText(text, sx(x), sy(y));
		ctx.fillStyle = `rgba(255,255,255,${alpha})`;
		ctx.fillText(text, sx(x), sy(y));
	}

	function hud(frame: Frame) {
		const barW = Math.min(width * 0.42, 560 * (window.devicePixelRatio || 1));
		const barH = Math.max(8, height * 0.016);
		const x = (width - barW) / 2;
		const y = height * 0.03;
		ctx.fillStyle = 'rgba(0,0,0,0.45)';
		ctx.beginPath();
		ctx.roundRect(x - 3, y - 3, barW + 6, barH + 6, barH);
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,255,255,0.7)';
		ctx.lineWidth = 2;
		ctx.stroke();
		if (frame.best > 0) {
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			ctx.beginPath();
			ctx.roundRect(x, y, (barW * frame.best) / 100, barH, barH / 2);
			ctx.fill();
		}
		const fill = ctx.createLinearGradient(x, 0, x + barW, 0);
		fill.addColorStop(0, frame.practice ? '#5dff8b' : '#7dff3a');
		fill.addColorStop(1, frame.practice ? '#3ad7ff' : '#ffe14d');
		ctx.fillStyle = fill;
		ctx.beginPath();
		ctx.roundRect(x, y, Math.max(barH, (barW * frame.progress) / 100), barH, barH / 2);
		ctx.fill();
		ctx.font = `900 ${Math.round(barH * 1.9)}px Figtree Variable, sans-serif`;
		ctx.textAlign = 'left';
		ctx.lineWidth = barH * 0.35;
		ctx.strokeStyle = 'rgba(0,0,0,0.8)';
		const label = `${Math.floor(frame.progress)}%`;
		ctx.strokeText(label, x + barW + barH * 1.2, y + barH * 1.05);
		ctx.fillStyle = '#ffffff';
		ctx.fillText(label, x + barW + barH * 1.2, y + barH * 1.05);
	}

	// --- A frame ----------------------------------------------------------------------------

	function draw(frame: Frame) {
		resize();
		const { level, state, time, icon } = frame;
		const now = performance.now();
		const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
		lastFrame = now;
		if (Math.abs(time - lastTime) > 1500) reset(state);
		lastTime = time;
		const world = level.world;
		const section = world.sectionAt(state.time);
		if (lastMode !== state.mode) lastMode = state.mode;
		// The drop: a flash and a kick of the camera
		if (section.kiai && !lastKiai && !frame.waiting && time > level.start + 500) {
			flash = 1;
			flashColor = '#ffffff';
			zoom = 1;
			shake = Math.max(shake, 0.6);
		}
		lastKiai = section.kiai;
		zoom = Math.max(0, zoom - dt * 2.5);
		scale *= 1 + zoom * 0.05 + beatPulse(level, time) * (section.kiai ? 0.012 : 0);

		// The camera
		const x = frame.dead ? state.x : world.xAt(Math.max(time, level.start));
		const playerX = frame.waiting || frame.dead ? state.x : x;
		camX = playerX - (width * 0.3) / scale;
		let targetY: number;
		if (section.ceil !== null) targetY = section.floor + section.ceil / 2 - VIEW / 2;
		else targetY = Math.max(-2.2, state.y - 7.2);
		camY += (targetY - camY) * Math.min(1, dt * (section.ceil !== null ? 5 : 3.5));
		const shaking = shake > 0 ? shake * scale * 0.12 : 0;
		shake = Math.max(0, shake - dt * 3);

		const p = paletteAt(level, state.time);
		const pulse = beatPulse(level, time);
		ctx.save();
		if (shaking) ctx.translate((Math.random() - 0.5) * shaking, (Math.random() - 0.5) * shaking);
		background(p, pulse, section.kiai);
		decorations(p, time, pulse, section.kiai);
		scenery(p, section.floor, pulse, section.kiai);
		// The floor and the ceiling (it comes in from above at the start of a part)
		const ceilingF = ease((state.time - section.start) / 450);
		if (section.ceil !== null) ground(p, section.ceil + (1 - ceilingF) * 8, -1, pulse, camX);
		else {
			const before = world.sections[section.index - 1];
			if (before?.ceil != null && ceilingF < 1)
				ground(p, before.ceil + ceilingF * 8, -1, pulse, camX);
		}
		ground(p, section.floor, 1, pulse, camX);

		const left = camX - 1;
		const right = camX + width / scale + 1;

		// Walls of the wave parts
		for (const w of world.walls.near(left, right)) {
			const sec = world.sectionAt(world.timeAt((w.x0 + w.x1) / 2));
			walls(w, sec, p, pulse);
		}

		// Blocks
		const solids = world.solids.near(left, right);
		outlines(solids, section, p, pulse, true);
		for (const s of solids) solid(s.x0, s.x1, s.y0, s.y1, p, pulse, s.style);
		outlines(solids, section, p, pulse, false);

		// Spikes and saws (their outlines glow together)
		const spikes = world.hazards.near(left, right).filter((h) => h.kind !== 'saw');
		ctx.beginPath();
		for (const h of spikes) {
			const sh = (h.kind === 'small' ? 0.5 : 1) * h.dir;
			const sw = h.kind === 'small' ? 0.42 : 0.5;
			ctx.moveTo(sx(h.x - sw), sy(h.y));
			ctx.lineTo(sx(h.x), sy(h.y + sh * 0.98));
			ctx.lineTo(sx(h.x + sw), sy(h.y));
		}
		ctx.lineJoin = 'round';
		ctx.strokeStyle = rgba(p.accent, 0.14 + pulse * 0.12);
		ctx.lineWidth = Math.max(4, scale * 0.4);
		ctx.stroke();
		ctx.strokeStyle = rgba(p.accent, 0.35 + pulse * 0.2);
		ctx.lineWidth = Math.max(2, scale * 0.18);
		ctx.stroke();
		for (const h of spikes) {
			spike(h.x, h.y, h.dir, h.kind === 'small', p, pulse);
		}
		for (const h of world.hazards.near(left, right))
			if (h.kind === 'saw') saw(h.x, h.y, h.size, p, pulse, time);

		// Pads, orbs, portals
		for (const pd of world.pads.near(left, right))
			pad(pd.x, pd.y, pd.dir, pd.kind, state.used.includes(pd.id), pulse);
		for (const o of world.orbs.near(left, right))
			orb(o.x, o.y, o.kind, state.used.includes(o.id), time, pulse);
		for (const portalItem of level.portals) {
			if (portalItem.x1 < left || portalItem.x0 > right) continue;
			if (portalItem.kind === 'mode' && portalItem.mode) {
				const sec = world.sectionAt(world.timeAt(portalItem.x + 0.01));
				const y = sec.ceil !== null ? sec.floor + sec.ceil / 2 : Math.max(1.6, portalItem.y);
				portal(
					portalItem.x,
					y,
					PORTAL_COLORS[portalItem.mode],
					time,
					'',
					PORTAL_SPRITES[portalItem.mode]
				);
				if (portalItem.mini) portal(portalItem.x + 1.3, y, '#ff6ad5', time + 300, '');
			} else speedPortal(portalItem.x, Math.max(1.2, portalItem.y), portalItem.speedIndex ?? 1);
		}

		// The end
		if (level.xEnd < right) {
			const ex = level.xEnd;
			const g = ctx.createLinearGradient(sx(ex), 0, sx(ex + 4), 0);
			g.addColorStop(0, 'rgba(255,255,255,0)');
			g.addColorStop(1, 'rgba(255,255,255,0.85)');
			ctx.fillStyle = g;
			ctx.fillRect(sx(ex), 0, scale * 4, height);
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(sx(ex + 4), 0, width, height);
		}

		// Checkpoints
		for (const c of frame.checkpoints) {
			if (c.x < left || c.x > right) continue;
			const cx = sx(c.x);
			const cy = sy(c.y);
			if (sprite('checkpoint', cx, cy, scale * 0.6)) continue;
			ctx.beginPath();
			ctx.moveTo(cx, cy - scale * 0.38);
			ctx.lineTo(cx + scale * 0.26, cy);
			ctx.lineTo(cx, cy + scale * 0.38);
			ctx.lineTo(cx - scale * 0.26, cy);
			ctx.closePath();
			ctx.fillStyle = 'rgba(93,255,139,0.85)';
			ctx.fill();
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = scale * 0.06;
			ctx.stroke();
		}

		// The attempt, written at the start
		if (frame.hud) {
			const startX = world.xAt(level.start);
			worldText(`Attempt ${frame.attempt}`, startX + 3.2, 4.4, 0.9);
		}

		updateParticles(dt, state, icon, frame);
		if (!frame.dead) {
			drawTrail(state, icon, time);
			if (!(frame.waiting && Math.floor(now / 120) % 2)) drawPlayer(state, icon, dt, time);
		}
		drawParticles();
		ctx.restore();

		if (flash > 0) {
			ctx.fillStyle = rgba(flashColor, flash * 0.35);
			ctx.fillRect(0, 0, width, height);
			flash = Math.max(0, flash - dt * 4);
		}
		if (frame.hud) hud(frame);
	}

	return { draw, event, reset, resize };
}

export type DashRenderer = ReturnType<typeof createDashRenderer>;
