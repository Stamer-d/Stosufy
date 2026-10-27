// use:nearView={callback}: calls back when the element comes near the screen (for lists that
// show more as they're scrolled: thousands of rows at once are slow on a phone)

export function nearView(node: HTMLElement, callback: () => void) {
	let current = callback;
	const observer = new IntersectionObserver(
		(entries) => entries.some((entry) => entry.isIntersecting) && current(),
		{ rootMargin: '800px 0px' }
	);
	observer.observe(node);
	return {
		update(next: () => void) {
			current = next;
		},
		destroy() {
			observer.disconnect();
		}
	};
}
