import type { Mode } from './physics';
import { nativeRound } from './native-number';
const f = Math.fround;
/** bumpPlayer -> propellPlayer, ordinary pad path; blue uses the default gravity-flip flag. */
export function padVelocity(
	mode: Mode,
	kind: 'yellow' | 'pink' | 'red' | 'blue',
	mini: boolean,
	gravity: 1 | -1
) {
	let multiplier = 1;
	if (kind === 'blue') multiplier = 0.8;
	else if (kind === 'pink')
		multiplier =
			mode === 'ship'
				? 0.35
				: mode === 'ufo'
					? 0.4
					: mode === 'ball' || mode === 'spider'
						? 0.7
						: 0.65;
	else if (kind === 'red')
		multiplier =
			mode === 'ship' ? (mini ? 0.95 : 0.63) : mode === 'ufo' ? (mini ? 0.98 : 0.6) : 1.25;
	let v = nativeRound(f(f(f(gravity * f(multiplier)) * 16) * (mini ? f(0.8) : 1)));
	if (mode === 'ball' || mode === 'spider' || mode === 'swing') v *= f(0.6);
	if (kind === 'blue') v *= 0.5;
	return v * 1.8;
}
