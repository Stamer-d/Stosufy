// Draws a play of a beatmap like osu! does: hit circles with approach circles and combo
// numbers, sliders with ticks and their ball, spinners, follow points, the 300s, 100s and
// misses, the cursor, and the HUD (score, accuracy, combo, keys, the results at the end).
// With the skin's images where it has them, simple shapes where it doesn't.

import { MOD, sliderBall, type GameplayBeatmap, type HitObject } from './beatmap';
import type { GameplaySkin, SkinImage, ElementName } from './skin';
import {
	cursorAt,
	keyCounts,
	lastAtOrBefore,
	snapshotAt,
	spinAt,
	trackingAt,
	KEY,
	type Judge,
	type Judgement,
	type ObjectState,
	type Snapshot
} from './judge';

type Colour = [number, number, number];

const DEFAULT_COLOURS: Colour[] = [
	[255, 192, 0],
	[0, 202, 0],
	[18, 124, 255],
	[242, 24, 57]
];
/** How long a hit object takes to fade out after it's hit (ms) */
const HIT_FADE = 240;
const MISS_FADE = 120;
const JUDGEMENT_TIME = 700;
/** Images not sized by the circle size: 1 pixel (at 1x) is this much of the playfield */
const PLAYFIELD_PIXEL = 480 / 768;
const FOLLOW_POINT_SPACING = 32;

const css = ([r, g, b]: Colour, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface PlayView {
	judge: Judge;
	/** Shown at the top: "Autoplay", who's replay it is, … */
	label: string;
	/** Show the results at the end */
	results: boolean;
	/** The song is over: show the results now */
	finished?: boolean;
	/** Where the cursor is (else from the play's inputs) */
	cursor?: ((time: number) => { x: number; y: number }) | null;
}

export interface GameplayRenderer {
	draw(time: number, view: PlayView): void;
	/** A point on the canvas (CSS pixels) in the playfield's coordinates */
	toPlayfield(x: number, y: number): { x: number; y: number };
}

/** osu!'s grade of a play */
export function grade(snapshot: Snapshot, mods: number) {
	const { counts } = snapshot;
	const total = counts[300] + counts[100] + counts[50] + counts[0];
	if (!total) return 'X';
	const p300 = counts[300] / total;
	const p50 = counts[50] / total;
	const silver = !!(mods & (MOD.Hidden | MOD.Flashlight));
	if (counts[300] === total) return silver ? 'XH' : 'X';
	if (p300 > 0.9 && p50 < 0.01 && !counts[0]) return silver ? 'SH' : 'S';
	if ((p300 > 0.8 && !counts[0]) || p300 > 0.9) return 'A';
	if ((p300 > 0.7 && !counts[0]) || p300 > 0.8) return 'B';
	if (p300 > 0.6) return 'C';
	return 'D';
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
	const { objects, radius, preempt, fadeIn, windows } = beatmap;
	const hidden = !!(beatmap.mods & MOD.Hidden);
	const images = skin.images;

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
		source: SkinImage | null | undefined,
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

	const element = (name: ElementName) => images[name];

	// The hit circle images are 128 px wide at 1x for a circle of radius 64
	const circleScale = radius / 64;

	// --- Hit circles ------------------------------------------------------------------------

	/** How visible an object is before it's hit: fading in, and out with Hidden */
	function appearAlpha(object: HitObject, time: number) {
		const appear = object.time - preempt;
		let alpha = clamp01((time - appear) / fadeIn);
		if (hidden) {
			const fadeOutStart = appear + fadeIn;
			alpha *= 1 - clamp01((time - fadeOutStart) / (preempt * 0.3));
		}
		return alpha;
	}

	function drawCircle(
		object: HitObject,
		x: number,
		y: number,
		time: number,
		hitTime: number | null,
		missedAt: number | null,
		number = true
	) {
		let alpha = appearAlpha(object, time);
		let grow = 1;
		if (hitTime !== null && time >= hitTime) {
			const t = (time - hitTime) / HIT_FADE;
			alpha = 1 - t;
			grow = 1 + 0.4 * t;
		} else if (missedAt !== null && time >= missedAt) {
			alpha *= 1 - (time - missedAt) / MISS_FADE;
		}
		if (alpha <= 0) return;
		const colour = colourOf(object);
		const size = circleScale * grow;
		if (!image(element('hitcircle'), x, y, size, alpha, colour, 'hitcircle')) {
			ctx.globalAlpha = alpha;
			ctx.fillStyle = css(colour, 0.85);
			ctx.beginPath();
			ctx.arc(x, y, radius * grow * 0.92, 0, Math.PI * 2);
			ctx.fill();
		}
		if (!image(element('hitcircleoverlay'), x, y, size, alpha)) {
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = 'white';
			ctx.lineWidth = radius * 0.12 * grow;
			ctx.beginPath();
			ctx.arc(x, y, radius * grow * 0.92, 0, Math.PI * 2);
			ctx.stroke();
		}
		if (number && (hitTime === null || time < hitTime)) drawNumber(object.combo, x, y, alpha);
		ctx.globalAlpha = 1;
	}

	/** Text in a skin's font (digits and "x%.,"), else plain text; returns its width */
	function drawText(
		text: string,
		font: Record<string, SkinImage | null>,
		overlap: number,
		x: number,
		y: number,
		scale: number,
		alpha: number,
		align: 'left' | 'center' | 'right' = 'center',
		fallbackSize = 24
	) {
		const glyphs = text.split('').map((c) => font[c] ?? null);
		if (glyphs.every(Boolean)) {
			const widths = glyphs.map((g) => g!.image.width * g!.scale * scale);
			const total = widths.reduce((a, b) => a + b, 0) - overlap * scale * (widths.length - 1);
			let left = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
			glyphs.forEach((g, i) => {
				image(g!, left + widths[i] / 2, y, scale, alpha);
				left += widths[i] - overlap * scale;
			});
			return total;
		}
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.fillStyle = 'white';
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
		ctx.lineWidth = fallbackSize * 0.12;
		ctx.font = `bold ${Math.round(fallbackSize)}px sans-serif`;
		ctx.textAlign = align;
		ctx.textBaseline = 'middle';
		ctx.strokeText(text, x, y + 1);
		ctx.fillText(text, x, y + 1);
		const width = ctx.measureText(text).width;
		ctx.restore();
		return width;
	}

	function drawNumber(combo: number, x: number, y: number, alpha: number) {
		const font = Object.fromEntries(skin.numbers.map((n, i) => [String(i), n]));
		drawText(
			String(combo),
			font,
			skin.numberOverlap,
			x,
			y,
			circleScale * 0.8,
			alpha,
			'center',
			radius * 0.8
		);
	}

	function drawApproach(object: HitObject, x: number, y: number, time: number, state: ObjectState) {
		if (time > object.time || hidden) return;
		if (state.headAt !== null && state.headAt <= time) return;
		const appear = object.time - preempt;
		const progress = (time - appear) / preempt;
		const alpha = Math.min(0.9, ((time - appear) / Math.min(fadeIn * 2, preempt)) * 0.9);
		const size = circleScale * (4 - 3 * progress);
		const colour = colourOf(object);
		if (!image(element('approachcircle'), x, y, size, alpha, colour, 'approachcircle')) {
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = css(colour);
			ctx.lineWidth = radius * 0.1;
			ctx.beginPath();
			ctx.arc(x, y, radius * (4 - 3 * progress), 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	// --- Sliders --------------------------------------------------------------------------

	function drawSlider(object: HitObject, time: number, state: ObjectState) {
		const slider = object.slider!;
		let alpha = appearAlpha(object, time);
		if (hidden) {
			// The body fades over the slider's length
			const fadeOutStart = object.time - preempt + fadeIn;
			alpha =
				clamp01((time - (object.time - preempt)) / fadeIn) *
				(1 - clamp01((time - fadeOutStart) / (object.endTime - fadeOutStart || 1)));
		}
		if (time > object.endTime) alpha = 1 - (time - object.endTime) / HIT_FADE;
		const colour = colourOf(object);
		if (alpha > 0) {
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
		}

		const span = time < object.time ? 0 : Math.floor((time - object.time) / slider.spanDuration);
		const end = slider.path.at(1);
		if (time < object.endTime && alpha > 0) {
			// The ticks still to come in this span
			for (const point of slider.points) {
				if (point.kind !== 'tick' || point.time <= time) continue;
				if (Math.floor((point.time - object.time) / slider.spanDuration) !== span) continue;
				const at = slider.path.at(point.progress);
				if (!image(element('sliderscorepoint'), at.x, at.y, circleScale, alpha)) {
					ctx.globalAlpha = alpha;
					ctx.fillStyle = 'white';
					ctx.beginPath();
					ctx.arc(at.x, at.y, radius * 0.12, 0, Math.PI * 2);
					ctx.fill();
					ctx.globalAlpha = 1;
				}
			}
			// The end, and the arrow where it turns around
			drawCircle(object, end.x, end.y, Math.min(time, object.time), null, null, false);
			const remainingTurns = slider.slides - 1 - Math.max(0, span);
			if (remainingTurns > 0) {
				const atEnd = Math.max(0, span) % 2 === 0;
				const where = atEnd ? end : slider.path.at(0);
				const angle = atEnd ? slider.path.angleAt(1) + Math.PI : slider.path.angleAt(0);
				if (
					!image(
						element('reversearrow'),
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
		const headMissed = state.head === 0 ? state.headAt : null;
		drawCircle(object, object.x, object.y, time, state.hitTime, headMissed);
		drawApproach(object, object.x, object.y, time, state);
		if (time >= object.time && time <= object.endTime) {
			const ball = sliderBall(object, time);
			const sliderb = element('sliderb0') ?? element('sliderb');
			if (!image(sliderb, ball.x, ball.y, circleScale, 1)) {
				ctx.fillStyle = css(colour);
				ctx.beginPath();
				ctx.arc(ball.x, ball.y, radius * 0.85, 0, Math.PI * 2);
				ctx.fill();
			}
			if (trackingAt(state, time)) {
				const since = state.tracking.find((t) => t.start <= time && time < t.end)!.start;
				const grow = 0.6 + 0.4 * clamp01((time - since) / 150);
				if (!image(element('sliderfollowcircle'), ball.x, ball.y, circleScale * grow, 1)) {
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
					ctx.lineWidth = radius * 0.08;
					ctx.beginPath();
					ctx.arc(ball.x, ball.y, radius * 2 * grow, 0, Math.PI * 2);
					ctx.stroke();
				}
			}
		}
	}

	// --- Spinners -------------------------------------------------------------------------

	/**
	 * A spinner like osu!'s legacy ones (LegacyNewStyleSpinner / LegacyOldStyleSpinner):
	 * the old style (spinner-background, spinner-circle, metre) if the skin has a background,
	 * else the new style (spinner-bottom, -top, -middle, -middle2, -glow)
	 */
	function drawSpinner(object: HitObject, time: number, state: ObjectState, judge: Judge) {
		const duration = object.endTime - object.time || 1;
		let alpha = clamp01((time - (object.time - fadeIn)) / fadeIn);
		if (time > object.endTime) alpha = 1 - (time - object.endTime) / HIT_FADE;
		if (alpha <= 0) return;
		const { total, rpm } = spinAt(state, time);
		const spun = total / (Math.PI * 2);
		const required = object.spinner!.required;
		const progress = required ? clamp01(spun / required) : 1;
		const px = PLAYFIELD_PIXEL;
		const cx = 256;
		const cy = 192;
		const oldStyle = !!element('spinner-background');

		if (oldStyle) {
			image(element('spinner-background'), cx, cy, px, alpha);
			// The metre fills up from below in ten bars
			const metre = element('spinner-metre');
			if (metre) {
				const w = metre.image.width * metre.scale * px;
				const h = metre.image.height * metre.scale * px;
				const bars = Math.floor(progress * 10) / 10;
				ctx.save();
				ctx.globalAlpha = alpha;
				ctx.beginPath();
				ctx.rect(cx - w / 2, cy - h / 2 + h * (1 - bars), w, h * bars);
				ctx.clip();
				ctx.drawImage(metre.image, cx - w / 2, cy - h / 2, w, h);
				ctx.restore();
			}
			if (!image(element('spinner-circle'), cx, cy, px, alpha, undefined, '', total)) {
				drawPlainSpinner(total, alpha);
			}
		} else if (element('spinner-top')) {
			const scale = px * (0.8 + (1 - (1 - progress) ** 2) * 0.2);
			const hasMiddle2 = !!element('spinner-middle2');
			const top = total * (hasMiddle2 ? 0.5 : 1);
			ctx.save();
			ctx.globalCompositeOperation = 'lighter';
			image(element('spinner-glow'), cx, cy, scale, alpha * progress, [3, 151, 255], 'glow');
			ctx.restore();
			image(element('spinner-bottom'), cx, cy, scale, alpha, undefined, '', top / 3);
			image(element('spinner-top'), cx, cy, scale, alpha, undefined, '', top);
			image(element('spinner-middle2'), cx, cy, scale, alpha, undefined, '', total);
			// White, turning red over the spinner's time
			const red = clamp01((time - object.time) / duration);
			const tint: Colour = [255, Math.round(255 * (1 - red)), Math.round(255 * (1 - red))];
			image(element('spinner-middle'), cx, cy, scale, alpha, tint, `middle${Math.round(red * 20)}`);
		} else {
			drawPlainSpinner(total, alpha);
		}

		// The approach circle: not with the default skin's new-style spinner (like osu!)
		const showApproach = oldStyle || !skin.fallbackImages?.has('spinner-top');
		if (showApproach && time >= object.time) {
			const shrink = clamp01((time - object.time) / duration);
			const size = px * 1.86 * (1 - shrink * 0.95);
			if (!image(element('spinner-approachcircle'), cx, cy, size, alpha)) {
				ctx.globalAlpha = alpha;
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc(cx, cy, Math.max(4, 190 * (1 - shrink)), 0, Math.PI * 2);
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
		}

		// "Spin!" below while it spins, "Clear" above once spun enough
		const spinIn = clamp01((time - (object.time - fadeIn / 2)) / (fadeIn / 2));
		const spinOutStart = object.endTime - Math.min(400, duration);
		const spinAlpha = spinIn * (1 - clamp01((time - spinOutStart) / Math.min(400, duration)));
		// …and gone after the first full spin
		const firstSpin = state.spins.find((s) => s.total >= Math.PI * 2)?.time;
		const afterSpin = firstSpin === undefined ? 1 : 1 - clamp01((time - firstSpin) / 300);
		image(element('spinner-spin'), cx, cy + 116, px, alpha * spinAlpha * afterSpin);
		const clearedAt = state.spins.find((s) => s.total / (Math.PI * 2) >= required)?.time;
		if (required && clearedAt !== undefined && time >= clearedAt) {
			const t = time - clearedAt;
			const pop =
				t < 240 ? 2 - 1.2 * (1 - (1 - t / 240) ** 2) : t < 400 ? 0.8 + 0.2 * ((t - 240) / 160) : 1;
			const clearOut = 1 - clamp01((time - (object.endTime - 50)) / 50);
			image(element('spinner-clear'), cx, cy - 104, px * pop, alpha * clamp01(t / 400) * clearOut);
		}

		// The bonus: pops up with each bonus spin
		const bonuses = judge.sounds.filter(
			(s) => s.kind === 'spinnerbonus' && s.at >= object.time && s.at <= time
		);
		if (bonuses.length) {
			const t = time - bonuses[bonuses.length - 1].at;
			const bonusAlpha = 1 - clamp01(t / 800);
			const scale = px * (2 - 0.72 * (1 - (1 - clamp01(t / 800)) ** 2));
			if (bonusAlpha > 0)
				drawText(
					String(bonuses.length * 1000),
					skin.score,
					skin.scoreOverlap,
					cx,
					cy + 80,
					scale,
					alpha * bonusAlpha,
					'center',
					28
				);
		}

		// The spins per minute, at the bottom
		if (time >= object.time - fadeIn && time <= object.endTime + HIT_FADE) {
			image(element('spinner-rpm'), cx - 87 * px * 0.9, 384 + 8, px, alpha);
			drawText(
				`${Math.round(Math.max(0, rpm))}`,
				skin.score,
				skin.scoreOverlap,
				cx + 80 * px,
				384 + 10,
				px * 0.9 * 0.6,
				alpha,
				'right',
				14
			);
		}
	}

	function drawPlainSpinner(total: number, alpha: number) {
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.translate(256, 192);
		ctx.rotate(total);
		ctx.strokeStyle = 'white';
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.arc(0, 0, 150, 0, Math.PI * 1.6);
		ctx.stroke();
		ctx.restore();
	}

	// --- Follow points --------------------------------------------------------------------

	const followLines = objects.slice(1).flatMap((to, i) => {
		const from = objects[i];
		if (to.combo === 1 || from.kind === 'spinner' || to.kind === 'spinner') return [];
		const start = from.slider
			? from.slider.path.at(from.slider.slides % 2)
			: { x: from.x, y: from.y };
		const dx = to.x - start.x;
		const dy = to.y - start.y;
		const length = Math.hypot(dx, dy);
		if (length < FOLLOW_POINT_SPACING * 2.5) return [];
		return [{ from, to, start, dx, dy, length, angle: Math.atan2(dy, dx) }];
	});

	// By the time the line ends (its next object), for finding the visible ones
	const followTimes = followLines.map((line) => ({ time: line.to.time }));
	const longest = objects.reduce((max, o) => Math.max(max, o.endTime - o.time), 0);

	function drawFollowPoints(time: number) {
		const first = Math.max(0, lastAtOrBefore(followTimes, time - 1000));
		for (let l = first; l < followLines.length; l++) {
			const line = followLines[l];
			if (line.from.endTime - preempt > time) break;
			if (line.to.time < time) continue;
			for (
				let d = FOLLOW_POINT_SPACING * 1.5;
				d < line.length - FOLLOW_POINT_SPACING;
				d += FOLLOW_POINT_SPACING
			) {
				const fraction = d / line.length;
				const at = line.from.endTime + fraction * (line.to.time - line.from.endTime);
				const fadeInAt = at - preempt;
				if (time < fadeInAt) continue;
				const alpha = clamp01((time - fadeInAt) / 400) * (1 - clamp01((time - at) / 400));
				if (alpha <= 0) continue;
				const x = line.start.x + line.dx * fraction;
				const y = line.start.y + line.dy * fraction;
				if (
					!image(element('followpoint'), x, y, PLAYFIELD_PIXEL, alpha, undefined, '', line.angle)
				) {
					ctx.save();
					ctx.globalAlpha = alpha * 0.8;
					ctx.translate(x, y);
					ctx.rotate(line.angle);
					ctx.fillStyle = 'white';
					ctx.fillRect(-6, -1.5, 12, 3);
					ctx.restore();
				}
			}
		}
	}

	// --- Judgements -----------------------------------------------------------------------

	const JUDGEMENT_IMAGE: Record<string, ElementName> = {
		'300': 'hit300',
		'300geki': 'hit300g',
		'300katu': 'hit300k',
		'100': 'hit100',
		'100katu': 'hit100k',
		'100geki': 'hit100',
		'50': 'hit50',
		'0': 'hit0'
	};
	const JUDGEMENT_COLOUR: Record<number, string> = {
		300: 'rgb(102, 204, 255)',
		100: 'rgb(136, 255, 102)',
		50: 'rgb(255, 204, 34)',
		0: 'rgb(255, 34, 34)'
	};

	function drawJudgement(j: Judgement, time: number) {
		const age = time - j.time;
		if (age < 0 || age > JUDGEMENT_TIME) return;
		const alpha = 1 - clamp01((age - JUDGEMENT_TIME * 0.6) / (JUDGEMENT_TIME * 0.4));
		const pop = age < 80 ? 0.7 + (age / 80) * 0.45 : 1.15 - 0.15 * clamp01((age - 80) / 100);
		const small = j.sliderBreak ? 0.6 : 1;
		const miss = j.result === 0;
		const drop = miss ? 25 * clamp01(age / JUDGEMENT_TIME) ** 2 : 0;
		const rotation = miss ? 0.25 * clamp01(age / JUDGEMENT_TIME) * (j.time % 2 ? 1 : -1) : 0;
		const name = JUDGEMENT_IMAGE[`${j.result}${j.special ?? ''}`] ?? JUDGEMENT_IMAGE[j.result];
		const picture = element(name) ?? element(JUDGEMENT_IMAGE[j.result]);
		const size = circleScale * (miss ? 1 : pop) * small;
		if (!image(picture, j.x, j.y + drop, size, alpha, undefined, '', rotation)) {
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(j.x, j.y + drop);
			ctx.rotate(rotation);
			ctx.fillStyle = JUDGEMENT_COLOUR[j.result];
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
			ctx.lineWidth = 3;
			ctx.font = `bold ${Math.round((radius * 0.8 * size) / circleScale)}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const text = miss ? '✕' : String(j.result);
			ctx.strokeText(text, 0, 0);
			ctx.fillText(text, 0, 0);
			ctx.restore();
		}
	}

	// --- Cursor ---------------------------------------------------------------------------

	function drawCursor(time: number, view: PlayView) {
		const frames = view.judge.frames;
		if (!frames.length) return;
		const where = (t: number) => {
			const input = cursorAt(frames, t);
			if (!input || !view.cursor) return input;
			return { ...input, ...view.cursor(t) };
		};
		const at = where(time);
		if (!at || at.y < -100) return;
		// The trail: where it was a moment ago
		for (let i = 8; i >= 1; i--) {
			const p = where(time - i * 12);
			if (!p) continue;
			const alpha = (1 - i / 9) * 0.6;
			if (!image(element('cursortrail'), p.x, p.y, PLAYFIELD_PIXEL, alpha)) {
				ctx.globalAlpha = alpha * 0.6;
				ctx.fillStyle = 'rgb(255, 230, 120)';
				ctx.beginPath();
				ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
				ctx.fill();
				ctx.globalAlpha = 1;
			}
		}
		// Bigger while a key is held, like osu!
		const size = PLAYFIELD_PIXEL * ((at.keys & 3) !== 0 ? 1.2 : 1);
		if (!image(element('cursor'), at.x, at.y, size, 1)) {
			ctx.fillStyle = 'rgb(255, 230, 120)';
			ctx.strokeStyle = 'white';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(at.x, at.y, (10 * size) / PLAYFIELD_PIXEL, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
	}

	// --- HUD (in screen pixels) -------------------------------------------------------------

	function drawHud(time: number, view: PlayView, width: number, height: number) {
		const unit = height / 768;
		const snapshot = snapshotAt(view.judge, time);
		// Score and accuracy, top right
		const score = String(snapshot.score).padStart(8, '0');
		const margin = 12 * unit;
		// Below the view's buttons at the top
		const top = 72 * devicePixelRatio;
		const scoreHeight =
			(skin.score['0']?.image.height ?? 30) * (skin.score['0']?.scale ?? 1) * unit;
		drawText(
			score,
			skin.score,
			skin.scoreOverlap,
			width - margin,
			top + scoreHeight / 2,
			unit,
			1,
			'right',
			34 * unit
		);
		const accuracy = `${(snapshot.accuracy * 100).toFixed(2)}%`;
		drawText(
			accuracy,
			skin.score,
			skin.scoreOverlap,
			width - margin,
			top + scoreHeight + 22 * unit,
			unit * 0.6,
			1,
			'right',
			22 * unit
		);
		// Combo, bottom left
		if (snapshot.combo > 0) {
			const comboHeight =
				(skin.combo['0']?.image.height ?? 30) * (skin.combo['0']?.scale ?? 1) * unit * 1.2;
			drawText(
				`${snapshot.combo}x`,
				skin.combo,
				skin.comboOverlap,
				margin,
				height - margin - comboHeight / 2,
				unit * 1.2,
				1,
				'left',
				40 * unit
			);
		}
		// Who plays, top left
		if (view.label) {
			ctx.save();
			ctx.font = `600 ${Math.round(15 * unit)}px sans-serif`;
			ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
			ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
			ctx.shadowBlur = 4;
			ctx.textBaseline = 'top';
			ctx.fillText(view.label, margin, 48 * devicePixelRatio);
			ctx.restore();
		}
		drawKeys(time, view.judge, width, height, unit);
	}

	function drawKeys(time: number, judge: Judge, width: number, height: number, unit: number) {
		const counts = keyCounts(judge, time);
		const keys = cursorAt(judge.frames, time)?.keys ?? 0;
		const list: [number, string, boolean][] = [
			[KEY.K1, 'K1', !!(keys & KEY.K1)],
			[KEY.K2, 'K2', !!(keys & KEY.K2)],
			[KEY.M1, 'M1', !!(keys & KEY.M1) && !(keys & KEY.K1)],
			[KEY.M2, 'M2', !!(keys & KEY.M2) && !(keys & KEY.K2)]
		];
		const size = 46 * unit;
		const x = width - size / 2 - 10 * unit;
		const top = height / 2 - size * 2;
		list.forEach(([key, label, down], i) => {
			const y = top + i * size + size / 2;
			const colour: Colour = key === KEY.K1 || key === KEY.K2 ? [255, 222, 0] : [248, 0, 158];
			const scale = down ? 0.85 : 1;
			const keyImage = element('inputoverlay-key');
			if (keyImage) {
				const s = (size / (keyImage.image.width * keyImage.scale)) * scale;
				image(keyImage, x, y, s, 1, down ? colour : undefined, `key${key}`);
			} else {
				ctx.save();
				ctx.fillStyle = down ? css(colour, 0.9) : 'rgba(255, 255, 255, 0.15)';
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
				ctx.lineWidth = 2 * unit;
				const s = size * 0.82 * scale;
				ctx.beginPath();
				ctx.roundRect(x - s / 2, y - s / 2, s, s, 6 * unit);
				ctx.fill();
				ctx.stroke();
				ctx.restore();
			}
			ctx.save();
			ctx.font = `bold ${Math.round(13 * unit)}px sans-serif`;
			ctx.fillStyle = down || keyImage ? 'black' : 'white';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(counts[key] ? String(counts[key]) : label, x, y);
			ctx.restore();
		});
	}

	function drawResults(time: number, view: PlayView, width: number, height: number) {
		const lastObject = objects[objects.length - 1];
		if (!view.results || !lastObject) return;
		const shownAt = lastObject.endTime + 1200;
		if (time < shownAt && !view.finished) return;
		const alpha = view.finished ? 1 : clamp01((time - shownAt) / 400);
		const unit = height / 768;
		const snapshot = snapshotAt(view.judge, time);
		const rank = grade(snapshot, view.judge.mods);
		const w = 420 * unit;
		const h = 300 * unit;
		const x = width / 2 - w / 2;
		const y = height / 2 - h / 2;
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.fillStyle = 'rgba(10, 10, 20, 0.82)';
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, 18 * unit);
		ctx.fill();
		ctx.restore();
		const rankImage = element(`ranking-${rank}` as ElementName);
		if (rankImage) {
			const s = (150 * unit) / (rankImage.image.height * rankImage.scale);
			image(rankImage, x + w - 95 * unit, y + h / 2, s, alpha);
		} else {
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.font = `900 ${Math.round(120 * unit)}px sans-serif`;
			ctx.fillStyle = rank.startsWith('X') || rank.startsWith('S') ? 'rgb(255, 220, 90)' : 'white';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(rank.replace('X', 'SS').replace('H', ''), x + w - 95 * unit, y + h / 2);
			ctx.restore();
		}
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.fillStyle = 'white';
		ctx.textBaseline = 'top';
		ctx.font = `800 ${Math.round(34 * unit)}px sans-serif`;
		ctx.fillText(snapshot.score.toLocaleString('en-US'), x + 28 * unit, y + 26 * unit);
		ctx.font = `600 ${Math.round(16 * unit)}px sans-serif`;
		const lines = [
			`Accuracy  ${(snapshot.accuracy * 100).toFixed(2)}%`,
			`Max combo  ${snapshot.maxCombo}x`,
			`300  ${snapshot.counts[300]}    100  ${snapshot.counts[100]}`,
			`50  ${snapshot.counts[50]}    Miss  ${snapshot.counts[0]}`
		];
		lines.forEach((line, i) => ctx.fillText(line, x + 28 * unit, y + (86 + i * 30) * unit));
		ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
		ctx.font = `500 ${Math.round(13 * unit)}px sans-serif`;
		ctx.fillText(view.label, x + 28 * unit, y + h - 36 * unit);
		ctx.restore();
	}

	// --- Frame ------------------------------------------------------------------------------

	let transform = { scale: 1, x: 0, y: 0 };

	function draw(time: number, view: PlayView) {
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
		transform = { scale, x: (width - 512 * scale) / 2, y: (height - 384 * scale) / 2 };
		ctx.setTransform(scale, 0, 0, scale, transform.x, transform.y);

		drawFollowPoints(time);
		const { states } = view.judge;
		// Visible objects; earlier ones are drawn on top, so from the last one back
		const visible: HitObject[] = [];
		// Objects that started long before (more than the longest object ago) are gone
		for (
			let i = Math.max(0, lastAtOrBefore(objects, time - longest - 3000));
			i < objects.length;
			i++
		) {
			const object = objects[i];
			if (object.time - preempt > time) break;
			const state = states[object.index];
			const gone = Math.max(
				object.endTime,
				state.judgedAt ?? object.endTime + windows[50],
				state.headAt ?? 0
			);
			if (gone + HIT_FADE >= time) visible.push(object);
		}
		for (let i = visible.length - 1; i >= 0; i--) {
			const object = visible[i];
			const state = states[object.index];
			if (object.kind === 'spinner') drawSpinner(object, time, state, view.judge);
			else if (object.kind === 'slider') drawSlider(object, time, state);
			else {
				const missedAt = state.result === 0 ? state.judgedAt : null;
				drawCircle(object, object.x, object.y, time, state.hitTime, missedAt);
				drawApproach(object, object.x, object.y, time, state);
			}
		}
		const judgements = view.judge.judgements;
		for (let i = judgements.length - 1; i >= 0; i--) {
			if (judgements[i].time < time - JUDGEMENT_TIME - 2000) break;
			drawJudgement(judgements[i], time);
		}
		drawCursor(time, view);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		drawHud(time, view, width, height);
		drawResults(time, view, width, height);
	}

	function toPlayfield(x: number, y: number) {
		return {
			x: (x * devicePixelRatio - transform.x) / transform.scale,
			y: (y * devicePixelRatio - transform.y) / transform.scale
		};
	}

	return { draw, toPlayfield };
}
