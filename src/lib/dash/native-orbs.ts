import type { Mode, OrbKind } from './physics';
import { nativeRound as q } from './native-number';
const f = Math.fround;

/** Native ringJump launch, ordinary gameplay flag path. Not activation eligibility. */
export function orbVelocity(
	mode: Mode,
	kind: Exclude<OrbKind, 'dash' | 'spider'>,
	mini: boolean,
	gravity: 1 | -1,
	cubeJump: number
) {
	if (kind === 'black') {
		const native =
			mode === 'spider'
				? -16.5
				: mode === 'ufo'
					? -11.2
					: mode === 'ship' || mode === 'wave' || mode === 'swing'
						? -14
						: -15;
		return q(gravity * native) * 1.8;
	}
	let jump = f(cubeJump / 1.8);
	if (kind === 'blue') jump = f(jump * f(0.8));
	else if (kind === 'green' && mode === 'ship') jump = f(jump * f(0.7));
	else if (kind === 'pink')
		jump = f(
			jump * f(mode === 'ship' ? 0.37 : mode === 'ufo' ? 0.42 : mode === 'ball' ? 0.77 : 0.72)
		);
	else if (kind === 'red') {
		const factor =
			mode === 'ship'
				? mini
					? 1.4
					: 1
				: mode === 'ufo'
					? mini
						? 1.36
						: 1.02
					: mode === 'ball' || mode === 'spider'
						? 1.34
						: mode === 'robot'
							? 1.28
							: 1.38;
		jump = f(jump * f(factor));
	}
	if (kind === 'yellow' && mode === 'robot') jump = f(jump * f(0.9));
	let native = q(f(f(gravity * jump) * (mini ? f(0.8) : 1)));
	if (mode === 'ball' || mode === 'spider') native *= f(0.7);
	else if (mode === 'swing') native *= f(0.6);
	// Blue writes velocity in the OLD jump direction, then flipGravity halves it.
	if (kind === 'blue') native *= 0.5;
	return native * 1.8;
}
