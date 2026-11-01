import { nativeRound as q } from './native-number';
const f = Math.fround;
const SCALE = 54 / 30;

/** Ordinary Robot path from updateJump 0x1404e9b80. No slope/platformer flags.
 * Ground jump: half the speed-specific cube impulse. Holding cancels gravity
 * through two setter calls until the native 1.5 charge counter is exhausted.
 * releaseButton 0x1404f64c0 latches release; pressing again in the air cannot renew it.
 * On the ground it jumps whenever the button is down, like the cube: held through a landing it
 * jumps again at once, and a press made just before the landing isn't lost.
 */
export function robotStep(
	input: {
		vy: number;
		gravity: 1 | -1;
		mini: boolean;
		grounded: boolean;
		held: boolean;
		buffered: boolean;
		active: boolean;
		released: boolean;
		charge: number;
	},
	cube: { jump: number; gravity: number },
	seconds: number
) {
	let v = input.vy / SCALE,
		charge = input.charge,
		active = input.active,
		released = input.released;
	const jumped = input.grounded && input.held;
	if (jumped) {
		v = q(f(f(input.gravity * f(f(cube.jump / SCALE) * f(0.5))) * (input.mini ? f(0.8) : 1)));
		charge = 0;
		active = true;
		released = false;
	} else {
		const h = f(f(seconds * 60) * f(0.9));
		const g = f((cube.gravity * 30) / 54 ** 2);
		const a = f(f(f(input.gravity * h) * g) * f(0.9));
		if (active && input.held && !released && charge < 1.5) {
			charge += f(h * f(0.1));
			v = q(v + a);
		}
		v = q(v - a);
		if (input.gravity * v < f(g + g)) active = false;
	}
	return { vy: v * SCALE, charge, active, released, jumped };
}
