import type { Addon } from '../types';

export default {
	id: 'edit',
	name: 'File editor',
	summary: 'Cut songs and videos, turn and crop pictures',
	description:
		'Open a song, a video or a picture, cut it to the part you want and fade it, turn it, make it louder, faster or smaller, and save it in any format. On your computer, in Stosufy/Edited.',
	highlights: [
		'Cut on the waveform: drag the start and the end, hear the part',
		'Fades, volume, even loudness, speed (with or without the pitch)',
		'Videos: turn, mirror, without sound, or only the sound',
		'Pictures: turn, mirror, cut to a part (square, 16:9, …), smaller',
		'Works with the file converter: "Edit" on its files'
	],
	category: 'tools',
	icon: 'icon-[mingcute--scissors-line]',
	colors: ['#8b5cf6', '#ec4899'],
	page: () => import('./Page.svelte')
} satisfies Addon;
