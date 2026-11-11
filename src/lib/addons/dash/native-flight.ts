/** Ordinary non-platformer flight paths, reconstructed from GD 2.2091-compatible code.
 * REA: updateJump 0x1404e9b80, falling predicate 0x1404f86d0, setter 0x1404e6f50.
 * See docs/rea-status.md. Slopes, external forces and platformer flags remain outside this model.
 */
import { nativeRound as q } from './native-number';
const f = Math.fround;
const G = f(0.958199);
const scale = 54 / 30;
const mul = (...v: number[]) => v.reduce((a, b) => f(a * b));

export interface FlightInput {
	vy: number;
	gravity: 1 | -1;
	mini: boolean;
	held: boolean;
	buffered: boolean;
	boosted: boolean;
	storedGravity: number;
}

export function flightStep(mode: 'ship' | 'ufo' | 'swing', input: FlightInput, seconds: number) {
	let v = input.vy / scale;
	let gravity = input.gravity;
	let boosted = input.boosted;
	const r = input.mini ? f(0.85) : 1;
	const h = mul(f(seconds * 60), f(0.9));
	if (f(f(-6.4) / r) < gravity * v && gravity * v < f(8 / r)) boosted = false;
	// This asymmetric inverted-gravity predicate is present in the native ordinary path.
	const falling = () =>
		gravity > 0
			? v < f(f(input.storedGravity) + f(input.storedGravity))
			: v > input.storedGravity * 2;
	const jumped = mode !== 'ship' && input.buffered && input.held;
	if (mode === 'swing') {
		if (jumped) {
			const saved = f(v);
			gravity = gravity === 1 ? -1 : 1;
			v = q(mul(saved, f(0.8)));
		}
		const acceleration = mul(gravity, h, G, input.mini ? f(0.6) : f(0.4));
		v = q(v - acceleration);
	} else if (mode === 'ufo') {
		if (jumped) {
			const jump = input.mini ? mul(8, r) : 7;
			if (gravity * v < jump) v = q(gravity * jump);
		}
		const k = falling() ? f(0.8) : f(1.2);
		const acceleration = f(mul(gravity, h, G, k, f(0.5)) / r);
		v = q(v - acceleration);
	} else {
		let k = f(0.8);
		if (input.held && !boosted) k = -1;
		else {
			if (boosted && gravity * v < 0) k = -1;
			if (!input.held && !falling()) k = f(1.2);
		}
		const c = input.held && falling() ? f(0.5) : f(0.4);
		const acceleration = f(mul(gravity, h, G, k, c) / r);
		v = q(v - acceleration);
	}
	if (!boosted) {
		const capR = mode === 'swing' ? 1 : r;
		const down = mode === 'swing' ? 8 : mul(f(0.8), 8);
		const lo = gravity > 0 ? f(-down / capR) : f(-8 / capR);
		const hi = gravity > 0 ? f(8 / capR) : f(down / capR);
		v = q(Math.max(v, lo));
		v = q(Math.min(v, hi));
	}
	return { vy: v * scale, gravity, boosted, jumped };
}
