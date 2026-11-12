// Where a list that pops out of a button goes: under it, or above it where there's more room
// there; measured in what's seen of the page (its scrolling part, not the window: what's
// above that is cut off), and at most as high as the room there is.

/** The part of the page it's seen in (its scrolling parent's box, within the window) */
function seenIn(element: HTMLElement) {
	let top = 0;
	let bottom = window.innerHeight;
	let left = 0;
	let right = window.innerWidth;
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		const { overflowY } = getComputedStyle(parent);
		if (overflowY === 'visible') continue;
		const rect = parent.getBoundingClientRect();
		top = Math.max(top, rect.top);
		bottom = Math.min(bottom, rect.bottom);
		left = Math.max(left, rect.left);
		right = Math.min(right, rect.right);
	}
	return { top, bottom, left, right };
}

/** Above it or not, and how high it can be (px), for a list `wanted` px high */
export function place(anchor: HTMLElement, wanted: number, gap = 8) {
	const rect = anchor.getBoundingClientRect();
	const seen = seenIn(anchor);
	const below = seen.bottom - rect.bottom - gap;
	const above = rect.top - seen.top - gap;
	if (below >= wanted || below >= above) return { up: false, max: Math.max(160, below) };
	return { up: true, max: above };
}

/** A list put out from the left of its button would go past what's seen on the right */
export function pastRight(list: HTMLElement, gap = 8) {
	return list.getBoundingClientRect().right > seenIn(list).right - gap;
}
