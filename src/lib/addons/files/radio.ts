// A row of buttons that work as radio buttons (role="radio"): the arrow keys go to the next or
// the one before and choose it, Home and End to the first and the last, as with the system's.
// (Only the chosen one is reached with Tab: give the others tabindex -1.)

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function radioKeys(node: HTMLElement) {
	const keydown = (event: KeyboardEvent) => {
		const radios = [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(
			(radio) => !radio.disabled
		);
		const at = radios.indexOf(document.activeElement as HTMLButtonElement);
		if (at < 0) return;
		const step = STEPS[event.key];
		const next = step
			? radios[(at + step + radios.length) % radios.length]
			: event.key === 'Home'
				? radios[0]
				: event.key === 'End'
					? radios.at(-1)
					: undefined;
		if (!next) return;
		event.preventDefault();
		event.stopPropagation();
		next.focus();
		next.click();
	};
	node.addEventListener('keydown', keydown);
	return {
		destroy() {
			node.removeEventListener('keydown', keydown);
		}
	};
}
