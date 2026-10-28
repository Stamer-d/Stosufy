// use:searchField: a search box as on the phone's own apps. iOS' autocorrect and capitals
// stay out of it (they turned artists and romaji into other words at each space), and the
// keyboard's Search key puts the keyboard away, so the results (and the tab bar) show.

export function searchField(input: HTMLInputElement) {
	input.setAttribute('autocorrect', 'off');
	input.setAttribute('autocapitalize', 'none');
	input.setAttribute('autocomplete', 'off');
	input.spellcheck = false;
	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && !event.isComposing) input.blur();
	};
	input.addEventListener('keydown', keydown);
	return {
		destroy() {
			input.removeEventListener('keydown', keydown);
		}
	};
}
