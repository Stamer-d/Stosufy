// Undo and redo for an editor: what it was, kept after each change (a drag is one step, not
// each of its moves: kept when the pointer's let go), and Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y.

/** A pointer button is down (something's being dragged) */
let pressed = false;
if (typeof window !== 'undefined') {
	window.addEventListener('pointerdown', () => (pressed = true), true);
	window.addEventListener('pointerup', () => (pressed = false), true);
	window.addEventListener('pointercancel', () => (pressed = false), true);
}

export function createHistory<T>(apply: (value: T) => void) {
	let past: string[] = [];
	let future: string[] = [];
	let last: string | null = null;
	let pending: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Waiting for the pointer to be let go (once, however many moves the drag has) */
	let waiting = false;
	const state = $state({ canUndo: false, canRedo: false });

	const update = () => {
		state.canUndo = past.length > 0 || (pending !== null && pending !== last);
		state.canRedo = future.length > 0;
	};

	function settle() {
		clearTimeout(timer);
		if (pending !== null && pending !== last) {
			if (last !== null) past.push(last);
			if (past.length > 100) past.shift();
			last = pending;
			future = [];
		}
		pending = null;
		update();
	}

	function go(from: string[], to: string[]) {
		settle();
		const value = from.pop();
		if (value === undefined || last === null) return;
		to.push(last);
		last = value;
		apply(JSON.parse(value));
		update();
	}

	return {
		state,
		/** What it is now (call it on each change; the first is where it starts) */
		changed(value: T) {
			const json = JSON.stringify(value);
			if (last === null) {
				last = json;
				return;
			}
			if (json === last && pending === null) return;
			pending = json;
			clearTimeout(timer);
			// (while dragging: once it's let go; else right after this change)
			if (pressed) {
				if (!waiting) {
					waiting = true;
					const done = () => {
						window.removeEventListener('pointerup', done, true);
						window.removeEventListener('pointercancel', done, true);
						waiting = false;
						setTimeout(settle);
					};
					window.addEventListener('pointerup', done, true);
					window.addEventListener('pointercancel', done, true);
				}
			} else timer = setTimeout(settle);
			update();
		},
		/** Starts over from what it is (another file) */
		reset() {
			clearTimeout(timer);
			past = [];
			future = [];
			last = null;
			pending = null;
			update();
		},
		undo: () => go(past, future),
		redo: () => go(future, past),
		/** Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y (not in a text field); whether it was one */
		key(event: KeyboardEvent) {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest('input[type="text"], input:not([type]), textarea')
			)
				return false;
			if (!(event.ctrlKey || event.metaKey)) return false;
			const key = event.key.toLowerCase();
			if (key === 'z' && !event.shiftKey) this.undo();
			else if ((key === 'z' && event.shiftKey) || key === 'y') this.redo();
			else return false;
			event.preventDefault();
			return true;
		}
	};
}
