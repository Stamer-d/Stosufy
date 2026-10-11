// Draws a beatmap's gameplay like osu!'s autoplay: hit circles with approach circles and
// combo numbers, sliders with their ball, spinners and the cursor moving from object to
// object. With the skin's images where it has them, simple shapes where it doesn't.

import { sliderBall, type GameplayBeatmap, type HitObject } from './beatmap';
import type { GameplaySkin, SkinImage } from './skin';

type Colour = [number, number, number];

const DEFAULT_COLOURS: Colour[] = [
	[255, 192, 0],
	[0, 202, 0],
	[18, 124, 255],
	[242, 24, 57]
];
/** How long a hit object takes to fade out after it's hit (ms) */
const HIT_FADE = 240;
const TRAIL_LENGTH = 12;

const css = ([r, g, b]: Colour, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export interface GameplayRenderer {
	draw(time: number): void;
}

export function createGameplayRenderer(
	canvas: HTMLCanvasElement,
	beatmap: GameplayBeatmap,
	skin: GameplaySkin
): GameplayRenderer {
	const ctx = canvas.getContext('2d')!;
	const colours = skin.colours.length
		? skin.colours
		: beatmap.colours.length
			? beatmap.colours
			: DEFAULT_COLOURS;
	const colourOf = (object: HitObject) => colours[object.colour % colours.length];
	const { objects, radius, preempt, fadeIn } = beatmap;

	// Tinted copies of the skin's white images, once per colour
	const tinted = new Map<string, HTMLCanvasElement>();
	function tint(name: string, source: SkinImage, colour: Colour) {
		const key = `${name}:${colour}`;
		let canvasTinted = tinted.get(key);
		if (!canvasTinted) {
			canvasTinted = document.createElement('canvas');
			canvasTinted.width = source.image.width;
			canvasTinted.height = source.image.height;
			const c = canvasTinted.getContext('2d')!;
			c.drawImage(source.image, 0, 0);
			c.globalCompositeOperation = 'multiply';
			c.fillStyle = css(colour);
			c.fillRect(0, 0, canvasTinted.width, canvasTinted.height);
			c.globalCompositeOperation = 'destination-in';
			c.drawImage(source.image, 0, 0);
			tinted.set(key, canvasTinted);
		}
		return canvasTinted;
	}

	/** Draws a skin image centred at a point, scaled like osu! (1 = the skin's size at 1x) */
	function image(
		source: SkinImage | undefined,
		x: number,
		y: number,
		size: number,
		alpha: number,
		colour?: Colour,
		name = '',
		rotation = 0
	) {
		if (!source || alpha <= 0) return false;
		const picture = colour ? tint(name, source, colour) : source.image;
		const w = source.image.width * source.scale * size;
		const h = source.image.height * source.scale * size;
		ctx.save();
		ctx.globalAlpha = Math.min(1, alpha);
		ctx.translate(x, y);
		if (rotation) ctx.rotate(rotation);
		ctx.drawImage(picture, -w / 2, -h / 2, w, h);
		ctx.restore();
		return true;
	}

	// The hit circle images are 128 px wide at 1x for a circle of radius 64
	const circleScale = radius / 64;

	function drawCircle(object: HitObject, x: number, y: number, time: number, number = true) {
		const appear = object.time - preempt;
		let alpha = Math.min(1, (time - appear) / fadeIn);
		let grow = 1;
		if (time > object.time) {
			const t = (time - object.time) / HIT_FADE;
			alpha = 1 - t;
			grow = 1 + 0.4 * t;
		}
		if (alpha <= 0) return;
		const colour = colourOf(object);
		const size = circleScale * grow;
		if (!image(skin.images.hitcircle, x, y, size, alpha, colour, 'hitcircle')) {
			ctx.globalAlpha = alpha;
			ctx.fillStyle = css(colour, 0.85);
			ctx.beginPath();
			ctx.arc(x, y, radius * grow * 0.92, 0, Math.PI * 2);
			ctx.fill();
		}
		if (!image(skin.images.hitcircleoverlay, x, y, size, alpha)) {
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = 'white';
			ctx.lineWidth = radius * 0.12 * grow;
			ctx.beginPath();
			ctx.arc(x, y, radius * grow * 0.92, 0, Math.PI * 2);
			ctx.stroke();
		}
		if (number && time <= object.time) drawNumber(object.combo, x, y, alpha);
		ctx.globalAlpha = 1;
	}

	function drawNumber(combo: number, x: number, y: number, alpha: number) {
		const digits = String(combo).split('').map(Number);
		const images = digits.map((d) => skin.numbers[d]);
		if (images.every(Boolean)) {
			const scale = circleScale * 0.8;
			const widths = images.map((img) => img!.image.width * img!.scale * scale);
			const overlap = skin.numberOverlap * scale;
			const total = widths.reduce((a, b) => a + b, 0) - overlap * (widths.length - 1);
			let left = x - total / 2;
			images.forEach((img, i) => {
				image(img!, left + widths[i] / 2, y, scale, alpha);
				left += widths[i] - overlap;
			});
			return;
		}
		ctx.globalAlpha = alpha;
		ctx.fillStyle = 'white';
		ctx.font = `bold ${Math.round(radius * 0.8)}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(combo), x, y + 1);
		ctx.globalAlpha = 1;
	}

	function drawApproach(object: HitObject, x: number, y: number, time: number) {
		if (time > object.time) return;
		const appear = object.time - preempt;
		const progress = (time - appear) / preempt;
		const alpha = Math.min(0.9, ((time - appear) / Math.min(fadeIn * 2, preempt)) * 0.9);
		const size = circleScale * (4 - 3 * progress);
		const colour = colourOf(object);
		if (!image(skin.images.approachcircle, x, y, size, alpha, colour, 'approachcircle')) {
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = css(colour);
			ctx.lineWidth = radius * 0.1;
			ctx.beginPath();
			ctx.arc(x, y, radius * (4 - 3 * progress), 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	function drawSlider(object: HitObject, time: number) {
		const slider = object.slider!;
		const appear = object.time - preempt;
		let alpha = Math.min(1, (time - appear) / fadeIn);
		if (time > object.endTime) alpha = 1 - (time - object.endTime) / HIT_FADE;
		if (alpha <= 0) return;
		const colour = colourOf(object);
		const points = slider.path.points;
		ctx.save();
		ctx.globalAlpha = alpha * 0.9;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const p of points) ctx.lineTo(p.x, p.y);
		ctx.strokeStyle = css(skin.sliderBorder ?? [255, 255, 255]);
		ctx.lineWidth = radius * 2 * 0.95;
		ctx.stroke();
		const track = skin.sliderTrack ?? (colour.map((c) => Math.round(c * 0.4)) as Colour);
		ctx.strokeStyle = css(track);
		ctx.lineWidth = radius * 2 * 0.8;
		ctx.stroke();
		ctx.restore();

		// The end of the slider and the arrows where it turns around
		const end = slider.path.at(1);
		if (time < object.endTime) {
			drawCircle(object, end.x, end.y, Math.min(time, object.time), false);
			const remainingTurns =
				slider.slides - 1 - Math.max(0, Math.floor((time - object.time) / slider.spanDuration));
			if (remainingTurns > 0) {
				const elapsedSpans = Math.max(0, Math.floor((time - object.time) / slider.spanDuration));
				const atEnd = elapsedSpans % 2 === 0;
				const where = atEnd ? end : slider.path.at(0);
				const angle = atEnd ? slider.path.angleAt(1) + Math.PI : slider.path.angleAt(0);
				if (
					!image(
						skin.images.reversearrow,
						where.x,
						where.y,
						circleScale,
						alpha,
						undefined,
						'',
						angle
					)
				) {
					ctx.save();
					ctx.globalAlpha = alpha;
					ctx.translate(where.x, where.y);
					ctx.rotate(angle);
					ctx.fillStyle = 'white';
					ctx.beginPath();
					ctx.moveTo(radius * 0.45, 0);
					ctx.lineTo(-radius * 0.3, -radius * 0.35);
					ctx.lineTo(-radius * 0.3, radius * 0.35);
					ctx.fill();
					ctx.restore();
				}
			}
		}

		// The head, then the ball while it slides
		drawCircle(object, object.x, object.y, time);
		if (time <= object.time) drawApproach(object, object.x, object.y, time);
		if (time >= object.time && time <= object.endTime) {
			const ball = sliderBall(object, time);
			const sliderb = skin.images.sliderb0 ?? skin.images.sliderb;
			if (!image(sliderb, ball.x, ball.y, circleScale, 1)) {
				ctx.fillStyle = css(colour);
				ctx.beginPath();
				ctx.arc(ball.x, ball.y, radius * 0.85, 0, Math.PI * 2);
				ctx.fill();
			}
			if (!image(skin.images.sliderfollowcircle, ball.x, ball.y, circleScale, 1)) {
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
				ctx.lineWidth = radius * 0.08;
				ctx.beginPath();
				ctx.arc(ball.x, ball.y, radius * 2, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	}

	function drawSpinner(object: HitObject, time: number) {
		const appear = object.time - fadeIn;
		let alpha = Math.min(1, (time - appear) / fadeIn);
		if (time > object.endTime) alpha = 1 - (time - object.endTime) / HIT_FADE;
		if (alpha <= 0) return;
		const progress = Math.max(
			0,
			Math.min(1, (time - object.time) / (object.endTime - object.time || 1))
		);
		const spin = Math.max(0, time - object.time) * 0.012;
		if (!image(skin.images['spinner-circle'], 256, 192, 0.8, alpha, undefined, '', spin)) {
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(256, 192);
			ctx.rotate(spin);
			ctx.strokeStyle = 'white';
			ctx.lineWidth = 6;
			ctx.beginPath();
			ctx.arc(0, 0, 150, 0, Math.PI * 1.6);
			ctx.stroke();
			ctx.restore();
		}
		if (!image(skin.images['spinner-approachcircle'], 256, 192, 1 - progress * 0.95, alpha)) {
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(256, 192, Math.max(4, 190 * (1 - progress)), 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	// --- Autoplay cursor -----------------------------------------------------------------

	function cursorAt(time: number) {
		// The object being played, or the last one before this time
		let index = -1;
		for (let low = 0, high = objects.length - 1; low <= high;) {
			const mid = (low + high) >> 1;
			if (objects[mid].time <= time) {
				index = mid;
				low = mid + 1;
			} else high = mid - 1;
		}
		const current = objects[index];
		if (current && time <= current.endTime) return position(current, time);
		const next = objects[index + 1];
		const from = current ? position(current, current.endTime) : { x: 256, y: 192 };
		if (!next) return from;
		const to = position(next, next.time);
		const start = current ? current.endTime : next.time - 1000;
		const t = Math.max(0, Math.min(1, (time - start) / (next.time - start || 1)));
		// Eased like a player's hand: quick start, gentle arrival
		const eased = 1 - (1 - t) * (1 - t);
		return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
	}

	function position(object: HitObject, time: number) {
		if (object.kind === 'slider') return sliderBall(object, time);
		if (object.kind === 'spinner') {
			const angle = Math.max(0, time - object.time) * 0.02;
			return { x: 256 + Math.cos(angle) * 60, y: 192 + Math.sin(angle) * 60 };
		}
		return { x: object.x, y: object.y };
	}

	const trail: { x: number; y: number }[] = [];
	let lastTime = -Infinity;

	function drawCursor(time: number) {
		const at = cursorAt(time);
		// Seeking clears the trail
		if (Math.abs(time - lastTime) > 200) trail.length = 0;
		lastTime = time;
		trail.push(at);
		if (trail.length > TRAIL_LENGTH) trail.shift();
		trail.forEach((p, i) => {
			const alpha = (i / trail.length) * 0.6;
			if (!image(skin.images.cursortrail, p.x, p.y, circleScale * 1.2, alpha)) {
				ctx.globalAlpha = alpha * 0.6;
				ctx.fillStyle = 'rgb(255, 230, 120)';
				ctx.beginPath();
				ctx.arc(p.x, p.y, radius * 0.25, 0, Math.PI * 2);
				ctx.fill();
				ctx.globalAlpha = 1;
			}
		});
		if (!image(skin.images.cursor, at.x, at.y, circleScale * 1.2, 1)) {
			ctx.fillStyle = 'rgb(255, 230, 120)';
			ctx.strokeStyle = 'white';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(at.x, at.y, radius * 0.35, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
	}

	function draw(time: number) {
		const width = Math.round(canvas.clientWidth * devicePixelRatio);
		const height = Math.round(canvas.clientHeight * devicePixelRatio);
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (!width || !height) return;
		// The 512×384 playfield, as large as fits with a margin, centred
		const scale = Math.min(width / 640, height / 480);
		ctx.setTransform(scale, 0, 0, scale, (width - 512 * scale) / 2, (height - 384 * scale) / 2);

		// Visible objects; earlier ones are drawn on top, so from the last one back
		const visible: HitObject[] = [];
		for (const object of objects) {
			if (object.time - preempt > time) break;
			if (object.endTime + HIT_FADE >= time) visible.push(object);
		}
		for (let i = visible.length - 1; i >= 0; i--) {
			const object = visible[i];
			if (object.kind === 'spinner') drawSpinner(object, time);
			else if (object.kind === 'slider') drawSlider(object, time);
			else {
				drawCircle(object, object.x, object.y, time);
				drawApproach(object, object.x, object.y, time);
			}
		}
		drawCursor(time);
	}

	return { draw };
}
