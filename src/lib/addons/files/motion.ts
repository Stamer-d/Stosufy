// How long an animation of the add-ons takes: none for whoever asked for less motion (the
// system's "reduce motion").

export function ms(duration: number) {
	const reduced =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	return reduced ? 0 : duration;
}
