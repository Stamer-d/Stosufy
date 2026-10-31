// Whether the Dash mode is open (it fills the window, like the DJ mode)

import { writable } from 'svelte/store';

export const dashOpen = writable(false);
