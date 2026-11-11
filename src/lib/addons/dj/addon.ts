import type { Addon } from '../types';

export default {
	id: 'dj',
	name: 'DJ mode',
	summary: 'Two decks, a mixer and mixes that land on the phrase',
	description:
		'Mix your songs like on real decks. What plays goes on when you open it, and back in the player when you leave.',
	highlights: [
		'Easy: big decks, one mix button and effect pads',
		'Pro: every control, hot cues, sync and the crossfader',
		'Auto DJ blends the songs on their phrases',
		'Record your mix to a file'
	],
	category: 'music',
	icon: 'icon-[mingcute--disc-line]',
	colors: ['#0ea5e9', '#f97316'],
	overlay: { load: () => import('./components/DjView.svelte') }
} satisfies Addon;
