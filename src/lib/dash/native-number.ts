/** setYVelocity rounds the fractional part, not the whole scaled number. */
export function nativeRound(value: number) {
	const integer = Math.trunc(value);
	const fraction = (value - integer) * 1000;
	return integer + (Math.sign(fraction) * Math.floor(Math.abs(fraction) + 0.5)) / 1000;
}
