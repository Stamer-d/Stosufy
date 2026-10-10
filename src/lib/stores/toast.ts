import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	message: string;
	icon?: string;
}

export const toasts = writable<Toast[]>([]);

let nextId = 0;

/** Shows a short notification at the bottom of the window */
export function showToast(message: string, icon = 'icon-[fa6-solid--check]', duration = 2500) {
	const id = nextId++;
	toasts.update((all) => [...all, { id, message, icon }]);
	setTimeout(() => {
		toasts.update((all) => all.filter((toast) => toast.id !== id));
	}, duration);
}
