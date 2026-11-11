// The world center's widgets for the home screen

import type { WidgetDefinition } from '../../widgets';
import MacWeather from './widgets/MacWeather.svelte';
import MacRainRadar from './widgets/MacRainRadar.svelte';
import MacStormPotential from './widgets/MacStormPotential.svelte';
import MacWarnings from './widgets/MacWarnings.svelte';
import MacFlightRadar from './widgets/MacFlightRadar.svelte';
import MacLightning from './widgets/MacLightning.svelte';
import MacQuakes from './widgets/MacQuakes.svelte';
import MacAirQuality from './widgets/MacAirQuality.svelte';
import MacIss from './widgets/MacIss.svelte';
import MacDepartures from './widgets/MacDepartures.svelte';
import MacAlerts from './widgets/MacAlerts.svelte';
import MacWebcam from './widgets/MacWebcam.svelte';

export default {
	'mac-weather': {
		name: 'Weather',
		description: 'The weather in your city',
		family: 'macos',
		component: MacWeather
	},
	'mac-rain-radar': {
		name: 'Rain radar',
		description: 'The radar of the last two hours around you, as a loop',
		family: 'macos',
		component: MacRainRadar
	},
	'mac-lightning': {
		name: 'Lightning',
		description: 'Live strikes around you, how many and how close',
		family: 'macos',
		component: MacLightning
	},
	'mac-storm-potential': {
		name: 'Storm potential',
		description: 'CAPE, lifted index, wind shear and gusts for the next 24 hours',
		family: 'macos',
		component: MacStormPotential
	},
	'mac-warnings': {
		name: 'Weather warnings',
		description: 'Warnings of the German weather service (DWD) where you are',
		family: 'macos',
		component: MacWarnings
	},
	'mac-flight-radar': {
		name: 'Flight radar',
		description: 'The planes around you, live; click one for its flight',
		family: 'macos',
		component: MacFlightRadar
	},
	'mac-quakes': {
		name: 'Earthquakes',
		description: 'The quakes of the last week around you, live',
		family: 'macos',
		component: MacQuakes
	},
	'mac-alerts': {
		name: 'World alerts',
		description: 'Tsunami warnings and the big disasters going on now',
		family: 'macos',
		component: MacAlerts
	},
	'mac-air': {
		name: 'Air quality',
		description: 'The air where you are: air quality index, dust, ozone, pollen and UV',
		family: 'macos',
		component: MacAirQuality
	},
	'mac-departures': {
		name: 'Departures',
		description: 'The next buses and trains of a stop, live with their delays',
		family: 'macos',
		component: MacDepartures
	},
	'mac-iss': {
		name: 'ISS',
		description: 'The space station over the world now, and when it flies over you',
		family: 'macos',
		component: MacIss
	},
	'mac-webcam': {
		name: 'Webcam',
		description: 'The live picture of a public webcam near you (or one you pick)',
		family: 'macos',
		component: MacWebcam
	}
} satisfies Record<string, WidgetDefinition>;
