// Draws the Dash mode: the level around the player, the player, its effects and the bar
// of how far it got. Everything is drawn here (no images): blocks with bright edges,
// spikes, orbs, pads and portals that glow, colours that change with every part.

import { wallAt, HITBOX, type Mode, type PlayerState, type Section } from './physics';
import type { Level } from './generate';

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
	primary: string;
	secondary: string;
}

export const ICONS: Icon[] = [
	{ primary: '#7dff3a', secondary: '#21e0ff' },
	{ primary: '#ffd93d', secondary: '#ff5ec4' },
	{ primary: '#a78bfa', secondary: '#ffffff' },
	{ primary: '#ff7a1a', secondary: '#ffe14d' },
	{ primary: '#36f5c8', secondary: '#1b62ff' },
	{ primary: '#ff4d6d', secondary: '#ffffff' }
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
		// Two layers of big squares, far away
		const layers = [
			{ speed: 0.08, size: 6, alpha: 0.07, rows: 3 },
			{ speed: 0.2, size: 3.2, alpha: 0.09, rows: 5 }
		];
		ctx.lineWidth = Math.max(1, scale * 0.05);
		for (const layer of layers) {
			const size = layer.size * scale;
			const offset = (camX * layer.speed * scale) % (size * 2);
			ctx.strokeStyle = `rgba(255,255,255,${layer.alpha})`;
			ctx.fillStyle = `rgba(0,0,0,${layer.alpha * 0.9})`;
			const startColumn = Math.floor((camX * layer.speed * scale) / (size * 2));
			for (let c = -1; c < width / (size * 2) + 2; c++) {
				const column = startColumn + c;
				for (let r = 0; r < layer.rows; r++) {
					const n = noise(column * 13 + r * 7 + layer.size);
					if (n < 0.45) continue;
					const x = c * size * 2 - offset + (n - 0.45) * size;
					const y = height - (r + 1) * size * 1.3 - noise(column + r) * size * 0.6 - scale * 2;
					const s = size * (0.6 + n * 0.5);
					ctx.fillRect(x, y, s, s);
					ctx.strokeRect(x, y, s, s);
				}
			}
		}
		// Light from below, on the beat
		const glow = ctx.createLinearGradient(0, height * 0.35, 0, height);
		glow.addColorStop(0, 'rgba(255,255,255,0)');
		glow.addColorStop(1, `rgba(255,255,255,${0.05 + pulse * (kiai ? 0.1 : 0.04)})`);
		ctx.fillStyle = glow;
		ctx.fillRect(0, height * 0.35, width, height * 0.65);
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
		const w = right - left;
		const h = bottom - top;
		if (w <= 0 || h <= 0) return;
		const gradient = ctx.createLinearGradient(0, top, 0, bottom);
		gradient.addColorStop(0, 'rgba(10,8,24,0.94)');
		gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
		ctx.fillStyle = gradient;
		ctx.fillRect(left, top, w, h);
		// The blocks inside
		ctx.strokeStyle = rgba(p.accent, 0.13);
		ctx.lineWidth = Math.max(1, scale * 0.035);
		ctx.beginPath();
		for (let y = Math.ceil(y0) + 1; y < y1; y++) {
			ctx.moveTo(left, sy(y));
			ctx.lineTo(right, sy(y));
		}
		for (let x = Math.ceil(x0 + 0.5); x < x1 - 0.5; x++) {
			ctx.moveTo(sx(x), top);
			ctx.lineTo(sx(x), bottom);
		}
		ctx.stroke();
		// A glow on the side the player meets
		const shine = ctx.createLinearGradient(0, top, 0, top + Math.min(h, scale * 0.9));
		shine.addColorStop(0, rgba(p.accent, 0.35 + pulse * 0.2));
		shine.addColorStop(1, rgba(p.accent, 0));
		ctx.fillStyle = shine;
		ctx.fillRect(left, top, w, Math.min(h, scale * 0.9));
		if (style === 2) {
			const under = ctx.createLinearGradient(0, bottom, 0, bottom - Math.min(h, scale * 0.9));
			under.addColorStop(0, rgba(p.accent, 0.3 + pulse * 0.2));
			under.addColorStop(1, rgba(p.accent, 0));
			ctx.fillStyle = under;
			ctx.fillRect(left, bottom - Math.min(h, scale * 0.9), w, Math.min(h, scale * 0.9));
		}
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = Math.max(1.5, scale * 0.07);
		ctx.strokeRect(left, top, w, h);
	}

	function spike(x: number, y: number, dir: 1 | -1, small: boolean, p: Palette, pulse: number) {
		const h = (small ? 0.5 : 1) * dir;
		const w = small ? 0.42 : 0.5;
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

	function orb(x: number, y: number, kind: string, used: boolean, time: number, pulse: number) {
		const colors: Record<string, [string, string]> = {
			yellow: ['#ffe14d', '#fff8c2'],
			pink: ['#ff5ec4', '#ffd0ef'],
			blue: ['#3ad7ff', '#d2f6ff']
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
		const main = kind === 'pink' ? '#ff5ec4' : '#ffe14d';
		const cx = sx(x);
		const base = sy(y);
		const w = 0.48 * scale;
		const h = (0.24 + pulse * 0.04) * scale * dir;
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

	const PORTAL_COLORS: Record<Mode, string> = {
		cube: '#5dff5a',
		ship: '#ff4fd8',
		ball: '#ff9a1f',
		wave: '#3ad7ff'
	};

	function portal(x: number, y: number, color: string, time: number, label: string) {
		const cx = sx(x);
		const cy = sy(y);
		const rx = 0.45 * scale;
		const ry = 1.55 * scale;
		const halo = ctx.createRadialGradient(cx, cy, ry * 0.2, cx, cy, ry * 1.4);
		halo.addColorStop(0, rgba(color, 0.35));
		halo.addColorStop(1, rgba(color, 0));
		ctx.fillStyle = halo;
		ctx.fillRect(cx - ry * 1.4, cy - ry * 1.4, ry * 2.8, ry * 2.8);
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
			const fill = ctx.createLinearGradient(0, sy(top), 0, sy(section.floor));
			fill.addColorStop(0, mix(p.bottom, '#000000', 0.55));
			fill.addColorStop(0.5, mix(p.bottom, '#000000', 0.8));
			fill.addColorStop(1, mix(p.bottom, '#000000', 0.55));
			ctx.fillStyle = fill;
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
		} else if (state.mode === 'ball') {
			ctx.rotate(state.rotation);
			const r = HITBOX.ball.h * scale * 1.05;
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
		if (!frame.dead && !frame.waiting) {
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

		const left = camX - 1;
		const right = camX + width / scale + 1;

		// Walls of the wave parts
		for (const w of world.walls.near(left, right)) {
			const sec = world.sectionAt(world.timeAt((w.x0 + w.x1) / 2));
			walls(w, sec, p, pulse);
		}

		// Blocks
		for (const s of world.solids.near(left, right))
			solid(s.x0, s.x1, s.y0, s.y1, p, pulse, s.style);

		// Spikes and saws
		for (const h of world.hazards.near(left, right)) {
			if (h.kind === 'saw') continue;
			spike(h.x, h.y, h.dir, h.kind === 'small', p, pulse);
		}

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
				portal(portalItem.x, y, PORTAL_COLORS[portalItem.mode], time, '');
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

		// The floor and the ceiling (it comes in from above at the start of a part)
		const ceilingF = ease((state.time - section.start) / 450);
		if (section.ceil !== null) ground(p, section.ceil + (1 - ceilingF) * 8, -1, pulse, camX);
		else {
			const before = world.sections[section.index - 1];
			if (before?.ceil != null && ceilingF < 1)
				ground(p, before.ceil + ceilingF * 8, -1, pulse, camX);
		}
		ground(p, section.floor, 1, pulse, camX);

		// Checkpoints
		for (const c of frame.checkpoints) {
			if (c.x < left || c.x > right) continue;
			const cx = sx(c.x);
			const cy = sy(c.y);
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
