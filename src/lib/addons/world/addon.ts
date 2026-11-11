import type { Addon } from '../types';

export default {
	id: 'world',
	name: 'World center',
	summary: 'Weather, lightning, flights, quakes and space on one live map',
	description:
		"What's going on in the world right now, on a map: the weather and its radar, storms, planes, earthquakes, trains, satellites and webcams.",
	highlights: [
		'Rain radar, forecasts, warnings and live lightning',
		'Storm analysis with soundings and hodographs',
		'Flights, earthquakes, departures, the ISS and public webcams',
		'12 widgets for the home screen'
	],
	category: 'world',
	icon: 'icon-[mingcute--earth-2-line]',
	colors: ['#2563eb', '#06b6d4'],
	page: () => import('./Page.svelte'),
	widgets: {
		summary: 'Weather, rain radar, lightning, flights, earthquakes, the ISS and more',
		count: 12,
		load: () => import('./widgets')
	}
} satisfies Addon;
