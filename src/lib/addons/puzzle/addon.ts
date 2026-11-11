import type { Addon } from '../types';

export default {
	id: 'puzzle',
	name: 'Puzzle',
	summary: "Put a song's background back together",
	description:
		'Against the clock while the song plays, muffled until the picture is whole, or relaxed with any picture and as many pieces as you like.',
	highlights: [
		'Jigsaw, slide and spin puzzles',
		'A daily puzzle, the same for everyone',
		'Leaderboards for every song and overall',
		'Relaxed mode with your own pictures, also in 3D'
	],
	category: 'games',
	icon: 'icon-[ri--puzzle-2-line]',
	colors: ['#a855f7', '#ec4899'],
	page: () => import('./Page.svelte')
} satisfies Addon;
