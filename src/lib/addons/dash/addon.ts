import type { Addon } from '../types';

export default {
	id: 'dash',
	name: 'Dash',
	summary: 'Play the song as a one-button rhythm level',
	description:
		"A level made from the song's beatmap and what's heard in the song: jump, fly and flip on the beat.",
	highlights: [
		'Cube, robot, ship, ball, UFO, wave, swing and spider parts',
		'Five difficulties, from easy to demon level',
		'Practice mode with checkpoints',
		'A level for every song you have'
	],
	category: 'games',
	icon: 'icon-[mingcute--box-3-line]',
	colors: ['#84cc16', '#0d9488'],
	overlay: { load: () => import('./components/DashView.svelte'), hidesApp: true },
	gameplayTab: {
		label: 'Dash',
		description:
			'The song as a one-button rhythm level, made from this difficulty: jump, fly and flip on the beat.',
		action: 'Open Dash',
		tint: 'bg-lime-400/20 text-lime-200'
	}
} satisfies Addon;
